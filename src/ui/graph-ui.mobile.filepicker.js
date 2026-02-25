/* =========================================================
 ONEXUS – Android File Picker Compatibility
 Fix:
 - On Android Chrome, remove file input "accept" filtering
   because it can force media-only pickers and grey-out files.
 - Validate extensions after selection (soft reject with toast).
========================================================= */
(function () {
    const isAndroid = /Android/i.test(navigator.userAgent || "");
    const isChrome = /Chrome\/\d+/i.test(navigator.userAgent || "");

    function normalizeName(name) {
        return String(name || "").trim();
    }
    function extOf(name) {
        const s = normalizeName(name).toLowerCase();
        const i = s.lastIndexOf(".");
        return i >= 0 ? s.slice(i) : "";
    }

    // Allowed by ONEXUS today (matches your UI accept + IFC zip variant)
    const ALLOWED = new Set([".json", ".csv", ".ifc", ".ifczip"]);

    function patchFileInput() {
        const input = document.getElementById("fileInput");
        if (!input) return;

        // Android: remove accept to avoid picker filtering bugs
        if (isAndroid && isChrome) {
            input.removeAttribute("accept");
            // Keep hint text in dataset (optional)
            if (!input.dataset.onxAccept) input.dataset.onxAccept = ".json,.csv,.ifc,.ifczip";
        }

        // Soft validation after selection (don’t block picker)
        if (!input.__onxPatched) {
            input.__onxPatched = true;
            input.addEventListener("change", () => {
                const files = Array.from(input.files || []);
                if (!files.length) return;

                const bad = files.filter(f => !ALLOWED.has(extOf(f.name)));
                if (bad.length) {
                    const names = bad.map(f => f.name).slice(0, 4).join(", ");
                    window.showTransientMessage?.(
                        `Some files look unsupported and may not import: ${names}`,
                        2600
                    );
                }
            });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", patchFileInput);
    } else {
        setTimeout(patchFileInput, 0);
    }
})();