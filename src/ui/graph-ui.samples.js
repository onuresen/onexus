/* =========================================================
 ONEXUS – Samples Loader (manifest-based) — Compact + Toast
 - Reads: ./samples/manifest.json
 - Toolbar UI: [select][Load] only (no description label)
 - Description shown via transient toast instead
 - Loads JSON and calls window.onexusLoadGraph(sampleObj)
========================================================= */
(function () {
    const DEFAULT_MANIFEST = "./samples/manifest.json";

    async function fetchJson(url) {
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.json();
    }

    function ensureHost() {
        // If you have the mobile popover slot, use it; otherwise toolbar
        const slot = document.getElementById("onx-samples-slot");
        if (slot) return slot;

        const toolbar = document.getElementById("toolbar");
        if (!toolbar) return null;

        let wrap = document.getElementById("onx-samples-wrap");
        if (wrap) return wrap;

        wrap = document.createElement("div");
        wrap.id = "onx-samples-wrap";
        toolbar.appendChild(wrap);
        return wrap;
    }

    function ensureCssOnce() {
        if (document.getElementById("onx-samples-css")) return;
        const st = document.createElement("style");
        st.id = "onx-samples-css";
        st.textContent = `
      .onx-samples-row{
        display:inline-flex;
        align-items:center;
        gap:8px;
        flex-wrap:nowrap;
        min-width:0;
      }
      .onx-samples-select{
        height: 32px;
        padding: 0 10px;
        border-radius: 10px;
        border: 1px solid var(--stroke);
        background: transparent;
        color: var(--text-main);
        font-size: 13px;
        font-weight: 700;
        min-width: 220px;
        max-width: 420px;
      }
      .onx-samples-btn{
        height: 32px;
        padding: 0 10px;
        border-radius: 10px;
        border: 1px solid var(--stroke);
        background: var(--btn-bg);
        color: var(--text-main);
        font-size: 12px;
        font-weight: 900;
        cursor: pointer;
        user-select:none;
        white-space: nowrap;
      }
      .onx-samples-btn:hover{ background: var(--btn-bg-hover); }
      @media (max-width: 900px){
        .onx-samples-select{ min-width: 180px; max-width: 44vw; }
      }
      @media (pointer: coarse), (max-width: 820px){
        .onx-samples-select{ min-width: 160px; max-width: 60vw; }
      }
    `;
        document.head.appendChild(st);
    }

    function toast(text, ms = 1800) {
        try { window.showTransientMessage?.(String(text), ms); } catch { }
    }

    function renderUi(host, manifest) {
        ensureCssOnce();
        const list = Array.isArray(manifest?.samples) ? manifest.samples : [];
        host.innerHTML = "";

        const row = document.createElement("div");
        row.className = "onx-samples-row";

        const sel = document.createElement("select");
        sel.className = "onx-samples-select";
        sel.id = "onx-samples-select";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Samples…";
        sel.appendChild(placeholder);
        list.forEach(s => {
            const option = document.createElement("option");
            option.value = String(s.id);
            option.textContent = String(s.label ?? s.id);
            sel.appendChild(option);
        });

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "onx-samples-btn";
        btn.textContent = "Load";
        btn.disabled = true;

        function getItem() {
            const id = sel.value;
            return list.find(x => String(x.id) === String(id)) || null;
        }

        function onPick() {
            const item = getItem();
            btn.disabled = !item;
            if (item?.description) toast(item.description, 1800);
        }

        sel.addEventListener("change", onPick);

        async function loadItem(item, options = {}) {
            if (!item?.path) return;
            try {
                toast("Loading sample…", 900);
                const graph = await fetchJson(item.path);
                window.onexusLoadGraph?.(graph);
                toast(`Loaded: ${item.label ?? item.id}`, 1600);
                if (item.description) toast(item.description, 2000);
                if (options.scenario) {
                    setTimeout(() => window.ONEXUS_SCENARIOS?.start(options.scenario), 700);
                }
            } catch (e) {
                console.error("[ONEXUS samples] load failed", e);
                alert("Failed to load sample: " + (e?.message ?? e));
            }
        }

        btn.addEventListener("click", async () => {
            await loadItem(getItem());
        });

        row.appendChild(sel);
        row.appendChild(btn);
        host.appendChild(row);

        window.ONEXUS_SAMPLES = {
            loadById(id, options = {}) {
                const item = list.find(x => String(x.id) === String(id));
                if (!item) return false;
                sel.value = String(item.id);
                onPick();
                loadItem(item, options);
                return true;
            },
            shareUrl(id, scenario = "") {
                const url = new URL(window.location.href);
                url.searchParams.set("sample", id);
                if (scenario) url.searchParams.set("scenario", scenario);
                else url.searchParams.delete("scenario");
                return url.toString();
            }
        };

        const params = new URLSearchParams(window.location.search);
        const requestedSample = params.get("sample");
        if (requestedSample) {
            window.ONEXUS_SAMPLES.loadById(requestedSample, {
                scenario: params.get("scenario") || ""
            });
        }
    }

    async function boot() {
        const host = ensureHost();
        if (!host) return;

        const manifestUrl = window.ONEXUS_SAMPLE_MANIFEST || DEFAULT_MANIFEST;
        try {
            const manifest = await fetchJson(manifestUrl);
            renderUi(host, manifest);
        } catch (e) {
            console.warn("[ONEXUS samples] manifest load failed", e);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
    } else {
        setTimeout(boot, 0);
    }
})();
