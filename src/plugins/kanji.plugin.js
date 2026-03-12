/* =========================================================
 ONEXUS Plugin — Kanji Graph (JLPT + nodeType styling)
 - Adds a color mode: "kanji_jlpt"
 - Uses data.level (N1..N5) for Kanji nodes
 - Gives Radicals/Phonetics stable colors

 SET E PATCH:
 - Register color mode ONLY via ONEXUS.style.registerColorMode (no monkey patch).
========================================================= */
(function () {
    const ONX = window.ONEXUS;
    if (!ONX || typeof ONX.registerPlugin !== "function") return;

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

    const TYPE_COLORS = {
        Radical: "#0EA5E9",
        Phonetic: "#64748B",
        Kanji: null
    };

    function nodeColorFn(ele, ctx) {
        const d = ele.data?.() ?? {};
        const nt = String(d.nodeType ?? "").trim();
        if (nt === "Kanji") {
            const lvl = normLevel(d.level);
            return JLPT_COLORS[lvl] ?? JLPT_COLORS[""];
        }
        if (nt === "Radical") return TYPE_COLORS.Radical;
        if (nt === "Phonetic") return TYPE_COLORS.Phonetic;
        return null; // fall back to base
    }

    ONX.registerPlugin({
        id: "kanji",
        title: "Kanji Graph Tools",
        register(api) {
            // Register color mode in the global registry
            window.ONEXUS?.style?.registerColorMode?.("kanji_jlpt", {
                label: "Kanji: JLPT levels",
                nodeColorFn: (ele, ctx) => nodeColorFn(ele, ctx) ?? ctx.base
            });

            // Ensure dropdown gets updated
            try { window.ONEXUS?.style?.syncColorModeSelect?.(); } catch { }

            // Edge labels (i18n)
            api.registerEdgeTypeLabels("has_radical", { en: "Has radical", jp: "部首" });
            api.registerEdgeTypeLabels("has_phonetic", { en: "Has phonetic", jp: "音符" });
        }
    });
})();