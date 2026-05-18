// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System;
using Autodesk.Revit.UI;
using Newtonsoft.Json;

namespace Onexus
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
    //  Commands call OnexusPaneManager.ShowGraph(uiapp, graph). The primary
    //  experience is now a standalone WebView2 WPF window so ONEXUS has enough
    //  canvas space for graph navigation. The old dockable pane remains only as
    //  a compatibility fallback for any older Revit sessions that ask for it.
    // ══════════════════════════════════════════════════════════════════════════
    public static class OnexusPaneManager
    {
        // Stable GUID — do not change once the addin is deployed
        public static readonly DockablePaneId PaneId =
            new DockablePaneId(new Guid("B9C7A6D5-E4F3-4210-9876-FEDCBA098765"));

        private static OnexusPaneContent _content;
        private static OnexusViewerWindow _window;

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

        public static bool IsAvailable => _window != null || _content != null;

        /// <summary>
        /// Serialises <paramref name="graph"/>, shows the standalone viewer, and
        /// injects the graph into the ONEXUS web app.
        /// Also rebuilds the element-ID cache used by live delta tracking.
        /// </summary>
        public static void ShowGraph(UIApplication uiapp, OnexusGraph graph)
        {
            if (graph == null) return;

            var json = JsonConvert.SerializeObject(graph, Formatting.Indented);
            ShowGraph(uiapp, json,
                      graph.elements.nodes.Count,
                      graph.elements.edges.Count);
        }

        /// <summary>
        /// Shows the standalone viewer and injects pre-serialised JSON.
        /// </summary>
        public static void ShowGraph(
            UIApplication uiapp,
            string json,
            int nodeCount = 0,
            int edgeCount = 0)
        {
            if (uiapp == null || string.IsNullOrWhiteSpace(json)) return;

            try
            {
                var folder = OnexusSettings.EnsureOnexusFolder();
                if (folder == null) return;

                if (_window == null)
                {
                    _window = OnexusViewerWindow.CreateFromGraphJson(folder, json);
                    _window.Closed += (s, e) => _window = null;
                    _window.EnableRevitSelectionBridge(uiapp);
                    _window.Show();
                }
                else
                {
                    _window.EnableRevitSelectionBridge(uiapp);
                    _window.LoadGraphJson(json);
                }

                if (_window.WindowState == System.Windows.WindowState.Minimized)
                    _window.WindowState = System.Windows.WindowState.Normal;

                _window.Activate();
                _window.Focus();
            }
            catch (Exception ex)
            {
                Autodesk.Revit.UI.TaskDialog.Show("ONEXUS", ex.Message);
            }
        }

        /// <summary>
        /// Toggles the panel visibility.  Called by the Toggle ribbon button.
        /// </summary>
        public static void Toggle(UIApplication uiapp)
        {
            try
            {
                var folder = OnexusSettings.EnsureOnexusFolder();
                if (folder == null) return;

                if (_window == null)
                {
                    _window = OnexusViewerWindow.CreateFromGraphJson(folder, "{}");
                    _window.Closed += (s, e) => _window = null;
                    _window.EnableRevitSelectionBridge(uiapp);
                    _window.Show();
                }

                if (_window.WindowState == System.Windows.WindowState.Minimized)
                    _window.WindowState = System.Windows.WindowState.Normal;

                _window.Activate();
                _window.Focus();
            }
            catch { }
        }

        /// <summary>
        /// Notifies the pane that the active document changed (keeps selection
        /// sync pointing at the right UIDocument).
        /// </summary>
        public static void UpdateActiveDocument(UIDocument uidoc)
        {
            try { _window?.UpdateDocument(uidoc); } catch { }
            try { _content?.UpdateDocument(uidoc); } catch { }
        }

        // ── Delta sync (Phase 5) ───────────────────────────────────────────────

        /// <summary>
        /// Enqueues a document-change delta for processing on the next Idling tick.
        /// Called from the DocumentChanged event handler in OnexusApplication.
        /// </summary>
        public static void EnqueueDelta(DeltaEntry entry)
        {
            try { _content?.EnqueueDelta(entry); } catch { }
        }
    }
}
