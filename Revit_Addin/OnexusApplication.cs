// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System;
using System.Reflection;
using System.Windows.Media.Imaging;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace ONES
{
    // ══════════════════════════════════════════════════════════════════════════
    //  OnexusApplication — IExternalApplication
    //
    //  Responsibilities:
    //    • Register the dockable pane with Revit at startup
    //    • Build the ONEXUS ribbon tab with all command buttons
    //    • Subscribe to document events for active-document tracking
    // ══════════════════════════════════════════════════════════════════════════
    [Regeneration(RegenerationOption.Manual)]
    public class OnexusApplication : IExternalApplication
    {
        private const string TabName = "ONEXUS";

        public Result OnStartup(UIControlledApplication app)
        {
            try
            {
                // 1. Register the dockable pane
                //    Revit calls SetupDockablePane() on our provider which creates
                //    the OnexusPaneContent UserControl and stores it in PaneManager.
                app.RegisterDockablePane(
                    OnexusPaneManager.PaneId,
                    "ONEXUS",
                    new OnexusDockablePane());

                // 2. Build the ribbon
                CreateRibbon(app);

                // 3. Track active document changes so selection sync stays correct.
                //    ViewActivated fires when the user switches views or documents, giving us
                //    a fresh UIDocument to hand to the selection bridge.
                app.ViewActivated += (s, e) =>
                {
                    try { OnexusPaneManager.UpdateActiveDocument(e.CurrentActiveView?.Document != null
                              ? new UIDocument(e.CurrentActiveView.Document)
                              : null); }
                    catch { }
                };
            }
            catch (Exception ex)
            {
                TaskDialog.Show("ONEXUS Startup Error", ex.Message);
                return Result.Failed;
            }

            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication app)
        {
            return Result.Succeeded;
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

            // Toggle Panel button
            var toggleData = new PushButtonData(
                "OnexusTogglePanel", "Toggle\nPanel", asm,
                "ONES.OnexusTogglePanel")
            {
                ToolTip = "Show or hide the ONEXUS docked panel."
            };
            graphPanel.AddItem(toggleData);

            graphPanel.AddSeparator();

            // Spaces & Elements (spatial graph)
            var spacesData = new PushButtonData(
                "OnexusSpaces", "Sync\nSpaces", asm,
                "ONES.Onexus")
            {
                ToolTip = "Export rooms, elements, and levels to the ONEXUS panel."
            };
            graphPanel.AddItem(spacesData);

            // ── Panel: Views ──────────────────────────────────────────────────
            var viewsPanel = app.CreateRibbonPanel(TabName, "Views");

            var doorsData = new PushButtonData(
                "OnexusDoors", "Door\nTypes", asm,
                "ONES.OnexusDoors")
            {
                ToolTip = "Export door type hierarchy and subcomponents."
            };
            viewsPanel.AddItem(doorsData);

            var masterKeyData = new PushButtonData(
                "OnexusMasterKey", "Master\nKey", asm,
                "ONES.OnexusMasterKey")
            {
                ToolTip = "Export selected doors, access devices, and key numbers."
            };
            viewsPanel.AddItem(masterKeyData);

            var paramsData = new PushButtonData(
                "OnexusParameters", "Param-\neters", asm,
                "ONES.OnexusParameters")
            {
                ToolTip = "Export parameter bindings (scoped to selection when elements are selected)."
            };
            viewsPanel.AddItem(paramsData);

            // ── Panel: Settings ───────────────────────────────────────────────
            var settingsPanel = app.CreateRibbonPanel(TabName, "Settings");

            var setFolderData = new PushButtonData(
                "OnexusSetFolder", "Set\nFolder", asm,
                "ONES.OnexusSetFolder")
            {
                ToolTip = "Choose the ONEXUS folder (the folder containing index.html)."
            };
            settingsPanel.AddItem(setFolderData);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  OnexusTogglePanel — hides / shows the dockable pane
    // ══════════════════════════════════════════════════════════════════════════
    [Transaction(TransactionMode.ReadOnly)]
    public class OnexusTogglePanel : IExternalCommand
    {
        public Result Execute(
            ExternalCommandData commandData,
            ref string message,
            ElementSet elements)
        {
            OnexusPaneManager.Toggle(commandData.Application);
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

            TaskDialog.Show("ONEXUS",
                $"Onexus folder set to:\n{folder}\n\n" +
                "Run any graph command to reload the panel.");
            return Result.Succeeded;
        }
    }
}
