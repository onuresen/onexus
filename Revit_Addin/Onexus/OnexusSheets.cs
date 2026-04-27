// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace Onexus
{
    // ══════════════════════════════════════════════════════════════════════════
    //  OnexusSheets — Phase 4 command
    //
    //  Exports every drawing sheet, the views placed on each sheet, and the
    //  rooms visible in plan-type views to the ONEXUS docked panel.
    //
    //  The resulting graph answers questions such as:
    //    • Which sheets show Room 101?       (Space → ShowsSpace ← View → ContainedIn → Sheet)
    //    • What views are on Sheet A-101?    (Sheet ← ContainedIn ← View)
    //    • Which rooms appear on this floor plan?
    //
    //  Works on any Revit project that has sheets.
    // ══════════════════════════════════════════════════════════════════════════
    [Transaction(TransactionMode.ReadOnly)]
    public class OnexusSheets : IExternalCommand
    {
        public Result Execute(
            ExternalCommandData commandData,
            ref string message,
            ElementSet elements)
        {
            var uiapp = commandData.Application;
            var uidoc = uiapp.ActiveUIDocument;
            var doc   = uidoc.Document;

            try
            {
                var graph = OnexusExportCore.BuildSheetsAndViewsGraph(doc);

                if (graph.elements.nodes.Count == 0)
                {
                    TaskDialog.Show(
                        "ONEXUS — Sheets & Views",
                        "No drawing sheets were found in this document.\n\n" +
                        "Create at least one sheet in the Project Browser and run this command again.");
                    return Result.Cancelled;
                }

                OnexusPaneManager.ShowGraph(uiapp, graph);

                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.Message;
                return Result.Failed;
            }
        }
    }
}
