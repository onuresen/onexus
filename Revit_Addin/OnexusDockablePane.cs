// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System;
using Autodesk.Revit.UI;
using Newtonsoft.Json;

namespace ONES
{
    // ══════════════════════════════════════════════════════════════════════════
    //  OnexusDockablePane — IDockablePaneProvider
    //
    //  Revit calls SetupDockablePane() once during startup to get the WPF
    //  FrameworkElement that fills the panel.  We hand it our UserControl.
    // ══════════════════════════════════════════════════════════════════════════
    public class OnexusDockablePane : IDockablePaneProvider
    {
        public void SetupDockablePane(DockablePaneProviderData data)
        {
            // Create (or reuse) the UserControl that hosts WebView2
            data.FrameworkElement = OnexusPaneManager.CreateContent();

            // Open tabbed next to Project Browser by default
            data.InitialState = new DockablePaneState
            {
                DockPosition = DockPosition.Tabbed,
                TabBehind = DockablePanes.BuiltInDockablePanes.ProjectBrowser
            };
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  OnexusPaneManager — static façade used by all commands
    //
    //  Commands call OnexusPaneManager.ShowGraph(uiapp, graph) and this class
    //  takes care of wiring the bridge, showing the pane, and injecting the JSON.
    // ══════════════════════════════════════════════════════════════════════════
    public static class OnexusPaneManager
    {
        // Stable GUID — do not change once the addin is deployed
        public static readonly DockablePaneId PaneId =
            new DockablePaneId(new Guid("B9C7A6D5-E4F3-4210-9876-FEDCBA098765"));

        private static OnexusPaneContent _content;

        // ── Called by IDockablePaneProvider ────────────────────────────────────

        /// <summary>
        /// Creates (or returns the existing) UserControl.  Called once by
        /// <see cref="OnexusDockablePane.SetupDockablePane"/>.
        /// </summary>
        public static OnexusPaneContent CreateContent()
        {
            if (_content == null)
                _content = new OnexusPaneContent();
            return _content;
        }

        // ── Called by commands ─────────────────────────────────────────────────

        public static bool IsAvailable => _content != null;

        /// <summary>
        /// Serialises <paramref name="graph"/>, shows the docked panel, and
        /// injects the graph into the Onexus web app.
        /// </summary>
        public static void ShowGraph(UIApplication uiapp, OnexusGraph graph)
        {
            if (graph == null || _content == null) return;

            var json = JsonConvert.SerializeObject(graph, Formatting.Indented);
            ShowGraph(uiapp, json,
                      graph.elements.nodes.Count,
                      graph.elements.edges.Count);
        }

        /// <summary>
        /// Shows the docked panel and injects pre-serialised JSON.
        /// </summary>
        public static void ShowGraph(
            UIApplication uiapp,
            string json,
            int nodeCount = 0,
            int edgeCount = 0)
        {
            if (_content == null || uiapp == null) return;

            // Wire the Revit↔JS bridge (idempotent)
            _content.EnsureBridge(uiapp);

            // Bring the pane into view
            try
            {
                var pane = uiapp.GetDockablePane(PaneId);
                if (pane != null && !pane.IsShown())
                    pane.Show();
            }
            catch { /* non-fatal */ }

            // Push graph JSON into WebView2
            _content.LoadGraph(json, nodeCount, edgeCount);
        }

        /// <summary>
        /// Toggles the panel visibility.  Called by the Toggle ribbon button.
        /// </summary>
        public static void Toggle(UIApplication uiapp)
        {
            try
            {
                var pane = uiapp.GetDockablePane(PaneId);
                if (pane == null) return;
                if (pane.IsShown()) pane.Hide();
                else pane.Show();
            }
            catch { }
        }

        /// <summary>
        /// Notifies the pane that the active document changed (keeps selection
        /// sync pointing at the right UIDocument).
        /// </summary>
        public static void UpdateActiveDocument(UIDocument uidoc)
        {
            try { _content?.UpdateDocument(uidoc); } catch { }
        }
    }
}
