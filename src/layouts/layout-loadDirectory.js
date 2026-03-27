(function () {
    const rail = document.getElementById("leftRail");
    if (!rail) return;

    // Avoid double injection
    if (document.getElementById("onx-load-directory-btn")) return;

    // Create rail button
    const btn = document.createElement("div");
    btn.id = "onx-load-directory-btn";
    btn.className = "rail-btn";
    btn.title = "Load Directory";
    btn.textContent = "📁";

    // Click handler
    btn.addEventListener("click", async (e) => {
        e.stopPropagation();

        if (typeof window.showDirectoryPicker !== "function") {
            alert("Directory picker is not supported in this browser.");
            return;
        }

        try {
            const dirHandle = await window.showDirectoryPicker();

            // Delegate to ONEXUS importer system
            const importerAPI = window.ONEXUS?.import;
            if (importerAPI?.importDirectory) {
                await importerAPI.importDirectory(dirHandle);
            } else {
                alert("No directory importer is registered.");
            }
        } catch (err) {
            // User cancelled picker → ignore silently
            if (err?.name !== "AbortError") {
                console.error("[ONEXUS] Load Directory failed", err);
                alert("Failed to load directory.");
            }
        }
    });

    // Insert AFTER existing panel buttons
    rail.appendChild(btn);
})();