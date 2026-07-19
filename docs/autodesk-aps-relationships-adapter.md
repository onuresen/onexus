# Autodesk APS Relationships Adapter

Status: feasibility adapter, read-first.

ONEXUS can import a saved Autodesk APS Relationships API JSON response through `src/plugins/onexus-aps-relationships.plugin.js`. The adapter maps each APS entity (`domain`, `type`, `id`) to a stable node and each relationship to the canonical `onexus.relationship.v1` envelope.

## Why the boundary is deliberately narrow

Autodesk documents that the Relationships API requires three-legged authorization, is not used by every ACC/Forma module, supports paged reads and synchronization tokens, soft-deletes relationships, and permits writes only for supported entity pairs discoverable through the writable-relationships utility.

Sources: [APS Relationships API overview](https://aps.autodesk.com/blog/bim-360acc-relationships-api) and [reference querying/create/delete guidance](https://aps.autodesk.com/blog/getcreatedelete-references-acc-entities-relationship-api).

ONEXUS therefore does not request, store, or refresh APS OAuth tokens. Production authentication belongs in a trusted backend or organization-managed connector. The browser adapter accepts either a saved response or an injected authenticated `fetchImpl` supplied by that boundary.

## Saved-response import

Use the normal ONEXUS file picker and select a JSON response containing `results`, `relationships`, `data`, or `items`. Each relationship must expose two or more entities with `domain`, `type`/`entityType`, and `id`/`entityId`.

See `samples/json/autodesk-aps-relationships-feasibility.json` for a small active + soft-deleted example.

## Programmatic mapping

```js
const graph = ONEXUS_APS_RELATIONSHIPS.mapPayload(payload, {
  projectId: "b.project-id",
  projectName: "ACC Relationship Graph",
  entityTitles: {
    "autodesk-bim360-issues:issue:ISSUE-128": "Escape-route interference"
  }
});

onexusLoadGraph(graph);
```

## Authenticated pagination boundary

```js
const graph = await ONEXUS_APS_RELATIONSHIPS.fetchAll({
  url: trustedProxyFirstPageUrl,
  projectId: "b.project-id",
  fetchImpl: url => trustedBackendFetch(url)
});
```

`fetchAll` follows explicit `pagination.nextUrl`, `links.next.href`, or `next` values returned by the service. It rejects pagination loops and failed responses. It does not construct undocumented endpoint URLs or accept/store OAuth tokens.

## Honest limitations

- Entity titles usually require calls to the owning module API. Without an enrichment map, ONEXUS displays the entity ID.
- The feasibility adapter does not create or delete APS relationships.
- Multi-entity records are represented as a fan from the first entity and produce a diagnostic warning.
- A real project export is still required to verify the exact payload variants used by the enabled ACC modules and tenant.
- Deep links depend on URLs supplied by the response or enrichment layer.
