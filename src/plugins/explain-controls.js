/* Example plugin: explanation templates for edges */
(function () {
    const ONX = window.ONEXUS;
    if (!ONX || typeof ONX.registerPlugin !== "function") return;

    ONX.registerPlugin({
        id: "explain-controls",
        register(api) {

            // Edge type == key => auto-match edges with data.type === "Controls"
            api.registerExplanationTemplate("Controls", {
                label: "Why this is a Controls relation",
                order: 10,
                appliesTo: "edge",
                render: ({ data }) => {
                    const src = escapeHtml(data.source);
                    const tgt = escapeHtml(data.target);
                    return `
            <div><b>${src}</b> is expected to control <b>${tgt}</b>.</div>
            <ul style="margin:6px 0 0 18px;">
              <li>Check signal/command path exists</li>
              <li>Verify responsibility ownership (Owner field)</li>
              <li>Confirm phase timing for commissioning</li>
            </ul>
          `;
                }
            });

            // Helper local
            function escapeHtml(s) {
                return String(s ?? "").replace(/[&<>"']/g, m => ({
                    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
                }[m]));
            }
        }
    });
})();