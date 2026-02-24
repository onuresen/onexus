/* ONEXUS boot sanity check (safe, no side-effects) */
(function () {
    const required = [
        ['cy', () => window.cy && typeof window.cy.nodes === 'function'],
        ['NEXUS_STYLE', () => !!window.NEXUS_STYLE],
        ['applyLayout', () => typeof window.applyLayout === 'function'],
        ['buildRelationshipLegend', () => typeof window.buildRelationshipLegend === 'function'],
        ['updateMetrics', () => typeof window.updateMetrics === 'function'],
        ['handleUnifiedLoad', () => typeof window.handleUnifiedLoad === 'function'],
        ['setLayerMode', () => typeof window.setLayerMode === 'function'],
        ['__onexus_state.layerMode', () => !!window.__onexus_state?.layerMode],
        ['getLayerMode', () => typeof window.getLayerMode === 'function'],
        ['setLayerMode', () => typeof window.setLayerMode === 'function'],
        ['registerLayerMode', () => typeof window.registerLayerMode === 'function'],
    ];

    const missing = required.filter(([, ok]) => !ok()).map(([name]) => name);

    // DOM ids used by core/UI
    const ids = ['cy', 'canvas-wrap', 'toolbar', 'languageSelect', 'layoutSelect', 'themeSelect', 'fileInput'];
    const missingIds = ids.filter(id => !document.getElementById(id));

    if (missing.length || missingIds.length) {
        console.error('[ONEXUS bootcheck] Missing globals:', missing);
        console.error('[ONEXUS bootcheck] Missing DOM ids:', missingIds);
        // Non-blocking, but loud.
        alert(
            'ONEXUS bootcheck failed.\n\nMissing globals:\n- ' + (missing.join('\n- ') || '(none)') +
            '\n\nMissing DOM ids:\n- ' + (missingIds.join('\n- ') || '(none)')
        );
    } else {
        console.debug('[ONEXUS bootcheck] OK');
    }
})();