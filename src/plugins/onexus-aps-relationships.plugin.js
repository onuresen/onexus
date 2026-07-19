/* ONEXUS Plugin – Autodesk APS Relationships feasibility adapter
   Read-first: maps saved API responses or an injected authenticated fetcher.
   Never stores OAuth tokens and never assumes relationship pairs are writable. */
(function () {
    const API = {};
    const asString = (value, fallback = "") => String(value ?? fallback).trim() || fallback;
    const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

    function payloadItems(payload) {
        if (Array.isArray(payload)) return payload;
        for (const key of ["results", "relationships", "data", "items"]) {
            if (Array.isArray(payload?.[key])) return payload[key];
        }
        return [];
    }

    function entitiesOf(record) {
        const candidates = record?.entities ?? record?.relationship?.entities ?? record?.data?.entities;
        if (Array.isArray(candidates)) return candidates;
        if (isObject(candidates)) return Object.values(candidates).filter(isObject);
        const left = record?.from ?? record?.sourceEntity ?? record?.data?.from;
        const right = record?.to ?? record?.targetEntity ?? record?.data?.to;
        return [left, right].filter(isObject);
    }

    function entityParts(entity) {
        const domain = asString(entity?.domain ?? entity?.namespace, "unknown-domain");
        const type = asString(entity?.type ?? entity?.entityType, "entity");
        const id = asString(entity?.id ?? entity?.entityId ?? entity?.urn, "");
        return { domain, type, id };
    }

    function entityNodeId(entity) {
        const { domain, type, id } = entityParts(entity);
        return `aps:${domain}:${type}:${id}`;
    }

    function titleFor(entity, titles) {
        const parts = entityParts(entity);
        const key = `${parts.domain}:${parts.type}:${parts.id}`;
        return asString(titles?.[key] ?? titles?.[parts.id] ?? entity?.displayName ?? entity?.name ?? entity?.title, parts.id || key);
    }

    function sourceUrl(entity) {
        return asString(entity?.url ?? entity?.webView ?? entity?.links?.webView ?? entity?.links?.self?.href, "");
    }

    function isDeleted(record) {
        return record?.deleted === true || record?.isDeleted === true || record?.status === "deleted" || !!record?.deletedAt;
    }

    function recordId(record, index) {
        return asString(record?.id ?? record?.relationshipId ?? record?.data?.id, `relationship-${index + 1}`);
    }

    function recordTimestamp(record) {
        return asString(record?.createdAt ?? record?.createdOn ?? record?.created ?? record?.data?.createdAt, "");
    }

    function mapPayload(payload, options = {}) {
        const nodes = new Map();
        const edges = [];
        const warnings = [];
        const titles = isObject(options.entityTitles) ? options.entityTitles : {};
        const projectId = asString(options.projectId ?? payload?.projectId ?? payload?.containerId, "");

        payloadItems(payload).forEach((record, index) => {
            const entities = entitiesOf(record).filter(entity => entityParts(entity).id);
            if (entities.length < 2) {
                warnings.push(`Relationship ${recordId(record, index)} has fewer than two usable entities.`);
                return;
            }
            if (entities.length > 2) warnings.push(`Relationship ${recordId(record, index)} has ${entities.length} entities; mapped as a fan from the first entity.`);

            entities.forEach(entity => {
                const parts = entityParts(entity);
                const id = entityNodeId(entity);
                if (!nodes.has(id)) {
                    nodes.set(id, { data: {
                        id,
                        nodeType: "ExternalEntity",
                        category: parts.type,
                        label: { en: titleFor(entity, titles), jp: titleFor(entity, titles) },
                        apsEntity: parts,
                        source: { system: "Autodesk APS", recordId: parts.id, url: sourceUrl(entity) },
                    } });
                }
            });

            const head = entities[0];
            entities.slice(1).forEach((tail, pairIndex) => {
                const deleted = isDeleted(record);
                const timestamp = recordTimestamp(record);
                const id = recordId(record, index);
                edges.push({ data: {
                    id: `aps-rel:${id}${pairIndex ? `:${pairIndex + 1}` : ""}`,
                    source: entityNodeId(head),
                    target: entityNodeId(tail),
                    type: asString(record?.type ?? record?.relationshipType ?? record?.data?.type, "References"),
                    dimension: "ExternalReference",
                    directional: false,
                    confidence: "Explicit",
                    deletedReference: deleted,
                    relationship: {
                        contract: "onexus.relationship.v1",
                        truthClass: deleted ? "historical" : "source-native",
                        source: { system: "Autodesk APS Relationships API", recordId: id, url: asString(record?.url ?? record?.links?.self?.href, "") },
                        provenance: { method: "API", evidenceIds: [], observedAt: timestamp },
                        confidence: "Explicit",
                        validity: { from: timestamp, to: asString(record?.deletedAt, ""), status: deleted ? "historical" : "active" },
                        review: { status: "unreviewed", reviewedBy: "", reviewedAt: "" },
                        lifecycle: { deleted, deletedAt: asString(record?.deletedAt, "") },
                    },
                } });
            });
        });

        const pagination = payload?.pagination ?? payload?.page ?? {};
        const syncToken = asString(payload?.syncToken ?? payload?.synchronizationToken ?? pagination?.syncToken, "");
        return {
            meta: {
                schema: "onexus-1.1",
                project: asString(options.projectName, "Autodesk APS Relationship Graph"),
                importer: "autodesk-aps-relationships",
                sourceKind: "api-export",
                sourceSystem: "Autodesk APS",
                projectId,
                aps: { syncToken, pageCount: Number(options.pageCount) || 1, warnings },
            },
            elements: { nodes: [...nodes.values()], edges },
        };
    }

    function mergeGraphs(graphs, options = {}) {
        const nodes = new Map();
        const edges = new Map();
        const warnings = [];
        let syncToken = "";
        graphs.forEach(graph => {
            graph.elements.nodes.forEach(node => nodes.set(node.data.id, node));
            graph.elements.edges.forEach(edge => edges.set(edge.data.id, edge));
            warnings.push(...(graph.meta?.aps?.warnings || []));
            syncToken = graph.meta?.aps?.syncToken || syncToken;
        });
        return {
            meta: {
                schema: "onexus-1.1",
                project: asString(options.projectName, "Autodesk APS Relationship Graph"),
                importer: "autodesk-aps-relationships",
                sourceKind: "api",
                sourceSystem: "Autodesk APS",
                projectId: asString(options.projectId, ""),
                aps: { syncToken, pageCount: graphs.length, warnings },
            },
            elements: { nodes: [...nodes.values()], edges: [...edges.values()] },
        };
    }

    async function fetchAll(options = {}) {
        const fetchImpl = options.fetchImpl;
        if (typeof fetchImpl !== "function") throw new Error("APS fetch requires an authenticated fetchImpl supplied by a trusted backend boundary.");
        let url = asString(options.url, "");
        if (!url) throw new Error("APS relationships endpoint URL is required.");
        const pages = [];
        const seen = new Set();
        while (url) {
            if (seen.has(url)) throw new Error("APS pagination loop detected.");
            seen.add(url);
            const response = await fetchImpl(url);
            if (!response?.ok) throw new Error(`APS request failed (${response?.status ?? "unknown"}).`);
            const payload = await response.json();
            pages.push(mapPayload(payload, { ...options, pageCount: pages.length + 1 }));
            const next = payload?.pagination?.nextUrl ?? payload?.links?.next?.href ?? payload?.next;
            url = asString(next, "");
        }
        return mergeGraphs(pages, options);
    }

    function canHandleText(text) {
        try {
            const payload = JSON.parse(text);
            const first = payloadItems(payload)[0];
            return entitiesOf(first).length >= 2 && entitiesOf(first).every(entity => entityParts(entity).domain !== "unknown-domain");
        } catch { return false; }
    }

    async function importFiles(files) {
        const file = Array.from(files || [])[0];
        if (!file) throw new Error("No APS Relationships JSON file provided.");
        let payload;
        try { payload = JSON.parse(await file.text()); }
        catch (error) { throw new Error(`Invalid APS Relationships JSON: ${error.message}`); }
        const graph = mapPayload(payload, { projectName: file.name });
        window.onexusLoadGraph?.(graph);
    }

    Object.assign(API, { payloadItems, entitiesOf, entityParts, entityNodeId, mapPayload, mergeGraphs, fetchAll, canHandleText });
    window.ONEXUS_APS_RELATIONSHIPS = API;

    const ONX = window.ONEXUS;
    if (!ONX || typeof ONX.registerPlugin !== "function") return;
    ONX.registerPlugin({
        id: "autodesk-aps-relationships",
        title: "Autodesk APS Relationships Adapter",
        register(api) {
            api.registerImporter({
                id: "autodesk-aps-relationships",
                label: "Autodesk APS Relationships JSON",
                priority: 110,
                extensions: ["json"],
                acceptMultiple: false,
                canHandleText,
                importFiles,
            });
        },
    });
})();
