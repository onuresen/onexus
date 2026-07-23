/* =========================================================
 ONEXUS – Reusable Scenario Stories
 - Loads declarative story definitions from JSON.
 - Registers their steps with the generic guided-tour engine.
 - Provides the flagship story chooser and shareable URL state.
========================================================= */
(function () {
    const DEFAULT_MANIFEST = "./samples/scenarios/smart-access.json";
    const state = { manifest: null, stories: new Map(), ready: null, diagnostics: null };

    function fetchJson(url) {
        return fetch(url, { cache: "no-cache" }).then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
            return res.json();
        });
    }

    function graphNode(id) {
        const node = window.cy?.getElementById?.(String(id ?? ""));
        return node?.nonempty?.() ? node : null;
    }

    function focusNodes(ids) {
        const cy = window.cy;
        if (!cy) return;
        const nodes = (Array.isArray(ids) ? ids : [])
            .map(graphNode)
            .filter(Boolean);
        if (!nodes.length) return;
        cy.nodes().unselect();
        nodes.forEach(node => node.select());
        const collection = nodes.reduce((all, node) => all.union(node), cy.collection());
        try { cy.animate({ fit: { eles: collection, padding: 100 }, duration: 350 }); } catch { }
    }

    function compileStep(raw) {
        return {
            id: String(raw?.id ?? "step"),
            title: String(raw?.title ?? ""),
            body: String(raw?.body ?? ""),
            target: () => {
                if (raw?.targetNodeId) {
                    const node = graphNode(raw.targetNodeId);
                    if (node) return { kind: "cyNode", node };
                }
                if (raw?.targetSelector) {
                    const el = document.querySelector(raw.targetSelector);
                    if (el) return el;
                }
                return document.getElementById("cy");
            },
            onEnter: () => {
                if (raw?.fitAll) {
                    try {
                        window.cy?.nodes?.().unselect();
                        window.cy?.fit?.(undefined, 60);
                    } catch { }
                    return;
                }
                focusNodes(raw?.focusNodeIds);
            },
            skipIfMissing: false
        };
    }

    function validateManifest(manifest) {
        const errors = [];
        const warnings = [];
        const stories = Array.isArray(manifest?.stories) ? manifest.stories : [];
        if (!manifest || typeof manifest !== "object") errors.push("Scenario manifest must be an object.");
        if (!Array.isArray(manifest?.stories)) errors.push("`stories` must be an array.");
        const storyIds = new Set();
        stories.forEach((story, storyIndex) => {
            const prefix = `stories[${storyIndex}]`;
            if (!story?.id || typeof story.id !== "string") errors.push(`${prefix}.id is required`);
            else if (storyIds.has(story.id)) errors.push(`${prefix}.id "${story.id}" is duplicated`);
            else storyIds.add(story.id);
            if (!story?.title || typeof story.title !== "string") errors.push(`${prefix}.title is required`);
            if (!Array.isArray(story?.steps) || !story.steps.length) {
                errors.push(`${prefix}.steps must be a non-empty array`);
                return;
            }
            const stepIds = new Set();
            story.steps.forEach((step, stepIndex) => {
                const stepPrefix = `${prefix}.steps[${stepIndex}]`;
                if (!step?.id || typeof step.id !== "string") errors.push(`${stepPrefix}.id is required`);
                else if (stepIds.has(step.id)) errors.push(`${stepPrefix}.id "${step.id}" is duplicated within story "${story.id}"`);
                else stepIds.add(step.id);
                if (!step?.title) warnings.push(`${stepPrefix} has no title`);
                const hasTarget = step?.targetNodeId || step?.targetSelector || step?.fitAll;
                if (!hasTarget) warnings.push(`${stepPrefix} has no explicit target and will fall back to the graph canvas`);
            });
        });
        return { valid: errors.length === 0, errors, warnings, storyCount: stories.length };
    }

    function validateGraphReferences() {
        const missing = [];
        state.stories.forEach(story => story.steps.forEach(step => {
            const ids = [step.targetNodeId, ...(Array.isArray(step.focusNodeIds) ? step.focusNodeIds : [])]
                .filter(Boolean);
            ids.forEach(id => {
                if (!graphNode(id)) missing.push(`${story.id}/${step.id}: node "${id}" was not found`);
            });
        }));
        return missing;
    }

    async function load() {
        const url = window.ONEXUS_SCENARIO_MANIFEST || DEFAULT_MANIFEST;
        const manifest = await fetchJson(url);
        const stories = Array.isArray(manifest?.stories) ? manifest.stories : [];
        const diagnostics = validateManifest(manifest);
        state.diagnostics = diagnostics;
        if (!diagnostics.valid) throw new Error(`Invalid scenario manifest:\n${diagnostics.errors.join("\n")}`);
        if (diagnostics.warnings.length) console.warn("[ONEXUS scenarios]", ...diagnostics.warnings);
        state.manifest = manifest;
        state.stories.clear();
        stories.forEach(story => {
            state.stories.set(story.id, story);
            window.ONEXUS_TOUR?.register?.(story.id, story.steps.map(compileStep));
        });
        return manifest;
    }

    function ensureCss() {
        if (document.getElementById("onx-story-chooser-css")) return;
        const style = document.createElement("style");
        style.id = "onx-story-chooser-css";
        style.textContent = `
      #onx-story-chooser{position:fixed;inset:0;z-index:10020;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.58);backdrop-filter:blur(5px)}
      #onx-story-dialog{width:min(920px,100%);max-height:calc(100vh - 48px);overflow:auto;background:var(--bg-main,#fff);color:var(--text-main,#111827);border:1px solid var(--stroke,#d1d5db);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.32);padding:22px}
      .onx-story-head{display:flex;align-items:flex-start;gap:16px;margin-bottom:17px}.onx-story-head-copy{flex:1;min-width:0}.onx-story-eyebrow{font:700 10px/1.2 var(--font-mono,monospace);letter-spacing:.11em;text-transform:uppercase;color:var(--accent,#2563eb)}
      .onx-story-head h2{margin:5px 0 4px;font-size:clamp(21px,2.4vw,28px);line-height:1.15}.onx-story-head p{margin:0;color:var(--text-muted,#64748b);font-size:13px;line-height:1.45}.onx-story-close{flex:0 0 auto;border:1px solid var(--stroke,#d1d5db);background:transparent;color:inherit;border-radius:9px;padding:6px 9px;cursor:pointer;font-size:12px}
      .onx-story-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.onx-story-card{display:flex;flex-direction:column;text-align:left;min-height:218px;padding:15px;border:1px solid var(--stroke,#d1d5db);border-top:3px solid var(--story-accent,#2563eb);border-radius:12px;background:var(--bg-soft,#f8fafc);color:inherit;cursor:pointer;font-size:12px;transition:transform .14s ease,box-shadow .14s ease}
      .onx-story-card:hover,.onx-story-card:focus-visible{transform:translateY(-2px);box-shadow:0 10px 22px rgba(15,23,42,.14);outline:none}.onx-story-kicker{font:700 9px/1.25 var(--font-mono,monospace);letter-spacing:.075em;text-transform:uppercase;color:var(--story-accent,#2563eb)}
      .onx-story-card h3{font-size:16px;line-height:1.18;margin:10px 0 7px}.onx-story-question{font-weight:700;font-size:12px;line-height:1.38;margin-bottom:8px}.onx-story-summary{color:var(--text-muted,#64748b);font-size:12px;line-height:1.42;margin-bottom:14px}.onx-story-start{margin-top:auto;font-size:12px;font-weight:800;color:var(--story-accent,#2563eb)}
      #btnStories{width:34px;min-width:34px;padding:0;overflow:hidden}
      @media(max-width:760px){#onx-story-chooser{padding:12px;align-items:flex-start}#onx-story-dialog{padding:16px}.onx-story-grid{grid-template-columns:1fr}.onx-story-card{min-height:0}.onx-story-head{margin-bottom:14px}.onx-story-head p{font-size:12px}}
    `;
        document.head.appendChild(style);
    }

    function ensureChooser() {
        ensureCss();
        let chooser = document.getElementById("onx-story-chooser");
        if (chooser) return chooser;
        chooser = document.createElement("div");
        chooser.id = "onx-story-chooser";
        chooser.setAttribute("role", "dialog");
        chooser.setAttribute("aria-modal", "true");
        chooser.setAttribute("aria-labelledby", "onx-story-heading");

        const dialog = document.createElement("div");
        dialog.id = "onx-story-dialog";
        const head = document.createElement("div");
        head.className = "onx-story-head";
        const copy = document.createElement("div");
        copy.className = "onx-story-head-copy";
        const eyebrow = document.createElement("div");
        eyebrow.className = "onx-story-eyebrow";
        eyebrow.textContent = "ONEXUS Flagship";
        const heading = document.createElement("h2");
        heading.id = "onx-story-heading";
        heading.textContent = "Choose a story";
        const intro = document.createElement("p");
        intro.textContent = "One connected project. Three ways to understand what is connected, what is affected, and why it was decided.";
        copy.append(eyebrow, heading, intro);
        const close = document.createElement("button");
        close.type = "button";
        close.className = "onx-story-close";
        close.setAttribute("aria-label", "Close story chooser");
        close.textContent = "Explore freely";
        close.addEventListener("click", hideChooser);
        head.append(copy, close);
        const grid = document.createElement("div");
        grid.className = "onx-story-grid";
        grid.id = "onx-story-grid";
        dialog.append(head, grid);
        chooser.appendChild(dialog);
        chooser.addEventListener("click", event => {
            if (event.target === chooser) hideChooser();
        });
        document.body.appendChild(chooser);
        return chooser;
    }

    function renderCards() {
        const grid = document.getElementById("onx-story-grid");
        if (!grid) return;
        grid.replaceChildren();
        state.stories.forEach(story => {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "onx-story-card";
            card.dataset.scenario = story.id;
            card.style.setProperty("--story-accent", story.accent || "#2563eb");
            const kicker = document.createElement("span");
            kicker.className = "onx-story-kicker";
            kicker.textContent = story.kicker || "Flagship story";
            const title = document.createElement("h3");
            title.textContent = story.title;
            const question = document.createElement("span");
            question.className = "onx-story-question";
            question.textContent = story.question || "";
            const summary = document.createElement("span");
            summary.className = "onx-story-summary";
            summary.textContent = story.summary || "";
            const startLabel = document.createElement("span");
            startLabel.className = "onx-story-start";
            startLabel.textContent = "Start story →";
            card.append(kicker, title, question, summary, startLabel);
            card.addEventListener("click", () => start(story.id, { updateUrl: true }));
            grid.appendChild(card);
        });
    }

    async function showChooser() {
        await state.ready;
        if (!state.stories.size) return false;
        const chooser = ensureChooser();
        renderCards();
        chooser.style.display = "flex";
        document.getElementById("onx-story-grid")?.querySelector("button")?.focus();
        return true;
    }

    function hideChooser() {
        const chooser = document.getElementById("onx-story-chooser");
        if (chooser) chooser.style.display = "none";
    }

    async function start(id, options = {}) {
        await state.ready;
        const story = state.stories.get(String(id));
        if (!story) return false;
        hideChooser();
        if (options.updateUrl) {
            const url = new URL(window.location.href);
            url.searchParams.set("sample", state.manifest?.sampleId || "smart-access-connected-door");
            url.searchParams.set("scenario", story.id);
            window.history.replaceState({}, "", url);
        }
        window.ONEXUS_TOUR?.start?.(story.id);
        return true;
    }

    function ensureStoriesButton() {
        if (document.getElementById("btnStories")) return;
        const iconbar = document.querySelector("#toolbar .iconbar");
        if (!iconbar) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "icon-btn";
        button.id = "btnStories";
        button.title = "Flagship stories";
        button.setAttribute("aria-label", "Flagship stories");
        button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z"/><path d="m8 8 2 1.5L8 11z"/></svg>`;
        button.addEventListener("click", showChooser);
        iconbar.appendChild(button);
    }

    state.ready = load().catch(error => {
        console.error("[ONEXUS scenarios] failed to load", error);
        return null;
    });

    window.ONEXUS_SCENARIOS = {
        ready: () => state.ready,
        start,
        showChooser,
        hideChooser,
        get: id => state.stories.get(String(id)) || null,
        list: () => [...state.stories.values()],
        validate: validateManifest,
        diagnostics: () => ({
            ...(state.diagnostics || { valid: false, errors: ["Scenario manifest has not loaded."], warnings: [] }),
            missingGraphReferences: validateGraphReferences(),
        }),
        shareUrl(id) {
            const url = new URL(window.location.href);
            url.searchParams.set("sample", state.manifest?.sampleId || "smart-access-connected-door");
            url.searchParams.set("scenario", String(id));
            return url.toString();
        }
    };

    // The flagship story chooser auto-opens only on a visitor's FIRST flagship
    // load (onboarding). After that it's remembered so it doesn't pop up every
    // time — the persistent "Stories" button reopens it on demand. A direct
    // ?scenario=... link never triggers it (it starts that story straight away).
    const CHOOSER_SEEN_KEY = "onexus.storyChooser.seen";
    function chooserSeen() {
        try { return localStorage.getItem(CHOOSER_SEEN_KEY) === "1"; }
        catch { return false; }
    }
    function markChooserSeen() {
        try { localStorage.setItem(CHOOSER_SEEN_KEY, "1"); }
        catch { /* localStorage unavailable — chooser may show again next time */ }
    }

    document.addEventListener("DOMContentLoaded", () => {
        ensureStoriesButton();
        window.ONEXUS?.bus?.on?.("graphLoaded", payload => {
            const missingReferences = validateGraphReferences();
            if (payload?.meta?.flagship && missingReferences.length) {
                console.warn("[ONEXUS scenarios] missing graph references", ...missingReferences);
            }
            const params = new URLSearchParams(window.location.search);
            if (payload?.meta?.flagship && !params.get("scenario") && !chooserSeen()) {
                markChooserSeen();
                setTimeout(showChooser, 550);
            }
        });
    });
    setTimeout(ensureStoriesButton, 150);
})();
