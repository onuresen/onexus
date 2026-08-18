// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;
using System.Windows.Media.Imaging;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace Onexus
{
    // ══════════════════════════════════════════════════════════════════════════
    //  OnexusApplication — IExternalApplication
    //
    //  Responsibilities:
    //    • Build the ONEXUS ribbon tab with all command buttons
    //    • Keep the standalone ONEXUS viewer pointed at the active document
    // ══════════════════════════════════════════════════════════════════════════
    [Regeneration(RegenerationOption.Manual)]
    public class OnexusApplication : IExternalApplication
    {
        private const string TabName = "ONEXUS";

        public Result OnStartup(UIControlledApplication app)
        {
            try
            {
                // 1. Build the ribbon
                CreateRibbon(app);

                // 2. Track active document changes so selection sync stays correct.
                //    ViewActivated fires when the user switches views or documents, giving us
                //    a fresh UIDocument to hand to the selection bridge.
                app.ViewActivated += (s, e) =>
                {
                    try { OnexusPaneManager.UpdateActiveDocument(e.CurrentActiveView?.Document != null
                              ? new UIDocument(e.CurrentActiveView.Document)
                              : null); }
                    catch { }
                };

                // 3. Subscribe to DocumentChanged for live delta sync (Phase 5).
                //    This event fires after each committed transaction.  We collect
                //    the changed IDs here (safe: read-only access) and defer any
                //    Revit API work to the next Idling tick.
                app.ControlledApplication.DocumentChanged += OnDocumentChanged;
            }
            catch (Exception ex)
            {
                Autodesk.Revit.UI.TaskDialog.Show("ONEXUS Startup Error", ex.Message);
                return Result.Failed;
            }

            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication app)
        {
            app.ControlledApplication.DocumentChanged -= OnDocumentChanged;
            return Result.Succeeded;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  DocumentChanged — collect IDs and hand off to the pane (Phase 5)
        // ══════════════════════════════════════════════════════════════════════

        private static void OnDocumentChanged(
            object sender,
            Autodesk.Revit.DB.Events.DocumentChangedEventArgs e)
        {
            try
            {
                // Only forward deltas when the viewer has been initialised and a
                // full graph has been loaded (TrackGraph populates the cache).
                if (!OnexusPaneManager.IsAvailable) return;

                var added    = e.GetAddedElementIds()?.ToList()    ?? new System.Collections.Generic.List<ElementId>();
                var modified = e.GetModifiedElementIds()?.ToList() ?? new System.Collections.Generic.List<ElementId>();
                var deleted  = e.GetDeletedElementIds()?.ToList()  ?? new System.Collections.Generic.List<ElementId>();

                if (added.Count + modified.Count + deleted.Count == 0) return;

                OnexusPaneManager.EnqueueDelta(new DeltaEntry
                {
                    Doc      = e.GetDocument(),
                    Added    = added,
                    Modified = modified,
                    Deleted  = deleted
                });
            }
            catch { /* must not propagate — would crash Revit's transaction system */ }
        }

        // ══════════════════════════════════════════════════════════════════════
        //  Ribbon
        // ══════════════════════════════════════════════════════════════════════

        private static void CreateRibbon(UIControlledApplication app)
        {
            var asm = Assembly.GetExecutingAssembly().Location;

            // Create tab (ignore exception if it already exists from a previous session)
            try { app.CreateRibbonTab(TabName); } catch { }

            // ── Panel: Graph ──────────────────────────────────────────────────
            var graphPanel = app.CreateRibbonPanel(TabName, "Graph");

            // Load a saved graph file into the viewer
            var toggleData = new PushButtonData(
                "OnexusOpenFile", "Open\nFile", asm,
                "Onexus.OnexusOpenFile")
            {
                ToolTip = "Open a previously saved ONEXUS graph (*.json) from disk."
            };
            graphPanel.AddItem(toggleData);

            graphPanel.AddSeparator();

            // Explore Elements — generic, works on any Revit model
            var exploreData = new PushButtonData(
                "OnexusExploreElements", "Explore\nElements", asm,
                "Onexus.ExploreElementsCommand")
            {
                ToolTip =
                    "Build a Category → Type → Instance graph from the current selection.\n\n" +
                    "If nothing is selected, all visible elements in the active view are used.\n" +
                    "Works on any Revit model — no special families or MEP systems required."
            };
            graphPanel.AddItem(exploreData);

            // Rooms & Elements (spatial graph)
            var spacesData = new PushButtonData(
                "OnexusSpaces", "Room\nGraph", asm,
                "Onexus.Onexus")
            {
                ToolTip =
                    "Export architectural rooms, placed family instances, and levels to the ONEXUS viewer.\n\n" +
                    "Select elements first to limit to a subset. Also exports MEP Spaces when present."
            };
            graphPanel.AddItem(spacesData);

            // Real Revit Room solids for CDI/compatible selectable 3D viewers.
            // This is intentionally separate from Room Graph: the graph remains
            // relationship data while this command emits a neutral mesh sidecar.
            var roomGeometryData = new PushButtonData(
                "OnexusRoomGeometry", "3D\nRooms", asm,
                "Onexus.OnexusRoomGeometry")
            {
                ToolTip =
                    "Export real Revit Room solids as a selectable 3D geometry companion file.\n\n" +
                    "If Rooms are selected, only those Rooms are exported; otherwise all Rooms are checked. " +
                    "The command is read-only and reports unplaced, unenclosed, and failed Rooms."
            };
            graphPanel.AddItem(roomGeometryData);

            // Room facts (name, level, real user-entered parameters) for CDI's
            // decision graph — cdi-revit-onexus-export-v1. Separate from both
            // Room Graph (ONEXUS viewer relationships) and 3D Rooms (mesh
            // geometry): Model Derivative's 3D translation cannot carry Room
            // elements at all, so CDI needs this Revit-side export to get real
            // Room parameters instead of an empty stub.
            var roomCdiExportData = new PushButtonData(
                "OnexusRoomCdiExport", "CDI\nRooms", asm,
                "Onexus.OnexusRoomCdiExport")
            {
                ToolTip =
                    "Export Rooms (identity, level, and whatever real parameters are filled in) " +
                    "as cdi-revit-onexus-export-v1, for Construction Decision Intelligence.\n\n" +
                    "If Rooms are selected, only those Rooms are exported; otherwise all Rooms " +
                    "with enclosed area are checked. Read-only."
            };
            graphPanel.AddItem(roomCdiExportData);

            // ── Panel: Views ──────────────────────────────────────────────────
            var viewsPanel = app.CreateRibbonPanel(TabName, "Views");

            var doorsData = new PushButtonData(
                "OnexusDoors", "Door\nTypes", asm,
                "Onexus.OnexusDoors")
            {
                ToolTip = "Export door type hierarchy and subcomponents."
            };
            viewsPanel.AddItem(doorsData);

            var proximityLinksData = new PushButtonData(
                "OnexusProximityLinks", "Proximity\nLinks", asm,
                "Onexus.OnexusProximityLinks")
            {
                ToolTip = "Find elements near the selected elements of the same category and show proximity relationships.\n\nWorks on any element type — select any elements and run."
            };
            viewsPanel.AddItem(proximityLinksData);

            var paramsData = new PushButtonData(
                "OnexusParameters", "Param-\neters", asm,
                "Onexus.OnexusParameters")
            {
                ToolTip = "Export parameter bindings (scoped to selection when elements are selected)."
            };
            viewsPanel.AddItem(paramsData);

            // ── Panel: MEP ─────────────────────────────────────────────────────
            var mepPanel = app.CreateRibbonPanel(TabName, "MEP");

            var mepData = new PushButtonData(
                "OnexusMEP", "MEP\nSystems", asm,
                "Onexus.OnexusMEP")
            {
                ToolTip =
                    "Export all MEP systems (Mechanical, Electrical, Piping) and their " +
                    "connected equipment, terminals and fixtures to the ONEXUS viewer window.\n\n" +
                    "Works best on MEP or combined models."
            };
            mepPanel.AddItem(mepData);

            // ── Panel: Documentation ───────────────────────────────────────────
            var docsPanel = app.CreateRibbonPanel(TabName, "Documentation");

            var sheetsData = new PushButtonData(
                "OnexusSheets", "Sheets\n& Views", asm,
                "Onexus.OnexusSheets")
            {
                ToolTip =
                    "Export all drawing sheets, the views placed on them, and the rooms " +
                    "visible in each floor-plan view.\n\n" +
                    "Shows which sheets document which spaces."
            };
            docsPanel.AddItem(sheetsData);

            // ── Panel: Settings ───────────────────────────────────────────────
            var settingsPanel = app.CreateRibbonPanel(TabName, "Settings");

            var setFolderData = new PushButtonData(
                "OnexusSetFolder", "Set\nFolder", asm,
                "Onexus.OnexusSetFolder")
            {
                ToolTip = "Choose the ONEXUS folder (the folder containing index.html)."
            };
            settingsPanel.AddItem(setFolderData);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  OnexusOpenFile — loads a saved ONEXUS graph JSON file into the viewer
    // ══════════════════════════════════════════════════════════════════════════
    [Transaction(TransactionMode.ReadOnly)]
    public class OnexusOpenFile : IExternalCommand
    {
        public Result Execute(
            ExternalCommandData commandData,
            ref string message,
            ElementSet elements)
        {
            var folder = OnexusSettings.EnsureOnexusFolder();
            if (folder == null) return Result.Cancelled;

            var dlg = new OpenFileDialog
            {
                Title = "Open ONEXUS Graph",
                Filter = "ONEXUS JSON (*.json)|*.json|All files (*.*)|*.*",
                CheckFileExists = true
            };
            if (dlg.ShowDialog() != DialogResult.OK) return Result.Cancelled;

            OnexusViewer.ShowFromFile(commandData.Application, folder, dlg.FileName);
            return Result.Succeeded;
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  OnexusSetFolder — lets the user re-point the addin to a different
    //                    Onexus installation without editing a config file
    // ══════════════════════════════════════════════════════════════════════════
    [Transaction(TransactionMode.ReadOnly)]
    public class OnexusSetFolder : IExternalCommand
    {
        public Result Execute(
            ExternalCommandData commandData,
            ref string message,
            ElementSet elements)
        {
            // Reset the cached setting so EnsureOnexusFolder() prompts again
            OnexusSettings.ResetOnexusFolder();
            var folder = OnexusSettings.EnsureOnexusFolder();

            if (folder == null)
                return Result.Cancelled;

            Autodesk.Revit.UI.TaskDialog.Show("ONEXUS",
                $"Onexus folder set to:\n{folder}\n\n" +
                "Run any graph command to reload the viewer window.");
            return Result.Succeeded;
        }
    }
}
