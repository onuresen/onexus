/* =========================================================
 ONEXUS – Samples Loader (manifest-based) — Compact UI
 - Reads: ./samples/manifest.json
 - Renders compact row: [select][Load]
 - Optional description: small inline text
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
        // Preferred: mobile "More" popover slot
        const slot = document.getElementById("onx-samples-slot");
        if (slot) return slot;

        // Fallback: toolbar placement (desktop / if you injected it there)
        const toolbar = document.getElementById("toolbar");
        if (!toolbar) return null;

        let wrap = document.getElementById("onx-samples-wrap");
        if (wrap) return wrap;

        wrap = document.createElement("div");
        wrap.id = "onx-samples-wrap";
        // Make it behave like a compact inline group in toolbar
        Object.assign(wrap.style, {
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            flex: "0 0 auto",
            minWidth: "0",
        });
        toolbar.appendChild(wrap);
        return wrap;
    }

    function ensureCssOnce() {
        if (document.getElementById("onx-samples-css")) return;
        const st = document.createElement("style");
        st.id = "onx-samples-css";
        st.textContent = `
      /* Compact samples UI */
      .onx-samples-row{
        display:flex;
        align-items:center;
        gap:8px;
        flex-wrap:nowrap;
        min-width:0;
      }
      .onx-samples-select{
        height: 36px;
        padding: 0 10px;
        border-radius: 10px;
        border: 1px solid var(--stroke);
        background: transparent;
        color: var(--text-main);
        font-size: 13px;
        font-weight: 700;
        min-width: 220px;
        max-width: 380px;
      }
      /* When inside toolbar, keep it from dominating */
      #toolbar .onx-samples-select{
        min-width: 200px;
        max-width: 32vw;
      }

      .onx-samples-btn{
        height: 36px;
        padding: 0 12px;
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

      .onx-samples-desc{
        font-size: 12px;
        color: var(--text-muted);
        line-height: 1.2;
        margin-left: 6px;
        max-width: 220px;
        overflow:hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Popover slot can be wider */
      #onx-toolbar-more .onx-samples-select{
        max-width: 60vw;
      }

      /* Very narrow screens: allow wrapping inside popover, but keep button aligned */
      @media (max-width: 480px){
        #onx-toolbar-more .onx-samples-row{
          flex-wrap: wrap;
        }
        #onx-toolbar-more .onx-samples-select{
          width: 100%;
          max-width: none;
        }
        #onx-toolbar-more .onx-samples-desc{
          width: 100%;
          max-width: none;
          white-space: normal;
        }
      }
    `;
        document.head.appendChild(st);
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
        sel.innerHTML =
            `<option value="">Samples…</option>` +
            list
                .map(
                    (s) =>
                        `<option value="${String(s.id)}">${String(s.label ?? s.id)}</option>`
                )
                .join("");

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "onx-samples-btn";
        btn.textContent = "Load";
        btn.disabled = true;

        const desc = document.createElement("div");
        desc.className = "onx-samples-desc";
        desc.textContent = "";

        function syncDesc() {
            const id = sel.value;
            const item = list.find((x) => String(x.id) === String(id));
            desc.textContent = item?.description ? String(item.description) : "";
            btn.disabled = !item;
        }

        sel.addEventListener("change", syncDesc);
        syncDesc();

        btn.addEventListener("click", async () => {
            const id = sel.value;
            if (!id) return;
            const item = list.find((x) => String(x.id) === String(id));
            if (!item?.path) return;

            try {
                window.showTransientMessage?.("Loading sample…", 1100);
                const graph = await fetchJson(item.path);
                window.onexusLoadGraph?.(graph);
                window.showTransientMessage?.(`Loaded: ${item.label ?? item.id}`, 1500);
            } catch (e) {
                console.error("[ONEXUS samples] load failed", e);
                alert("Failed to load sample: " + (e?.message ?? e));
            }
        });

        row.appendChild(sel);
        row.appendChild(btn);
        row.appendChild(desc);

        host.appendChild(row);
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
            // non-blocking
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
    } else {
        setTimeout(boot, 0);
    }
})();