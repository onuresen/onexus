/* =========================================================
   ONEXUS Plugin — Kanji Graph (JLPT + nodeType styling)
   - Adds a color mode: "kanji_jlpt"
   - Uses data.level (N1..N5) for Kanji nodes (sample uses "N2") [1](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/onexus_kanji_n2_20.json)
   - Gives Radicals/Phonetics stable colors
========================================================= */
(function () {
    const ONX = window.ONEXUS;
    if (!ONX || typeof ONX.registerPlugin !== "function") return;

    // ---- helpers ----
    function normLevel(v) {
        const s = String(v ?? "").trim().toUpperCase();
        const m = s.match(/N?([1-5])/);
        return m ? ("N" + m[1]) : "";
    }

    const JLPT_COLORS = {
        N1: "#EF4444",
        N2: "#F59E0B",
        N3: "#10B981",
        N4: "#3B82F6",
        N5: "#8B5CF6",
        "": "#94A3B8"
    };

    // Stable fallback palette for non-kanji structural nodes
    const TYPE_COLORS = {
        Radical: "#0EA5E9",
        Phonetic: "#64748B",
        Kanji: null
    };

    function nodeColorFn(ele) {
        const d = ele.data?.() ?? {};
        const nt = String(d.nodeType ?? "").trim();

        if (nt === "Kanji") {
            const lvl = normLevel(d.level); // sample: "N2" [1](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/onexus_kanji_n2_20.json)
            return JLPT_COLORS[lvl] ?? JLPT_COLORS[""];
        }
        if (nt === "Radical") return TYPE_COLORS.Radical;
        if (nt === "Phonetic") return TYPE_COLORS.Phonetic;

        // fallback to whatever core would do (return null -> ctx.base)
        return null;
    }

    function ensureUiOption() {
        const sel = document.getElementById("colorModeSelect");
        if (!sel) return;
        if ([...sel.options].some(o => o.value === "kanji_jlpt")) return;

        const opt = document.createElement("option");
        opt.value = "kanji_jlpt";
        opt.textContent = "Kanji: JLPT levels";
        sel.appendChild(opt);
    }

    ONX.registerPlugin({
        id: "kanji",
        title: "Kanji Graph Tools",
        register(api) {
            // If you implemented the color mode registry wrapper earlier, prefer it.
            // Otherwise, just use style hooks directly (works with current core). [3](https://obayashig-my.sharepoint.com/personal/u52119_obayashi_co_jp/Documents/Microsoft%20Copilot%20%E3%83%81%E3%83%A3%E3%83%83%E3%83%88%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/graph-ui.bindings.js)
            if (ONX.style?.registerColorMode) {
                ONX.style.registerColorMode("kanji_jlpt", {
                    label: "Kanji: JLPT levels",
                    nodeColorFn
                });
            } else {
                // fallback: patch applyColorMode behavior minimally (only for this mode)
                const orig = window.applyColorMode;
                window.applyColorMode = function (mode) {
                    const m = String(mode ?? "").trim();
                    if (m === "kanji_jlpt") {
                        window.setStyleHooks?.({
                            nodeColorFn: (ele, ctx) => nodeColorFn(ele) || ctx.base
                        });
                        // keep core state consistent
                        try { orig?.(m); } catch { }
                        return;
                    }
                    // switching away: clear plugin override and let core do its thing
                    window.setStyleHooks?.({ nodeColorFn: null });
                    return orig?.(m);
                };
            }

            // Add to UI
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", () => setTimeout(ensureUiOption, 0));
            } else {
                setTimeout(ensureUiOption, 0);
            }

            api.registerEdgeTypeLabels("has_radical", { en: "Has radical", jp: "部首" });
            api.registerEdgeTypeLabels("has_phonetic", { en: "Has phonetic", jp: "音符" });
        }
    });
})();