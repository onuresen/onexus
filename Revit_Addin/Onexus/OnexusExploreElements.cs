// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System;
using System.Collections.Generic;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace Onexus
{
    // ══════════════════════════════════════════════════════════════════════════
    //  ExploreElementsCommand
    //
    //  Generic one-click graph builder that works on ANY Revit model.
    //
    //  Selection logic (smart defaults — no dialog):
    //    1. If elements are currently selected → use them.
    //    2. Otherwise              → collect all visible elements in the active view.
    //
    //  Graph shape: Category → Type → Instance, with optional edges to
    //  Levels, Rooms (doors/windows) and host elements (nested families).
    // ══════════════════════════════════════════════════════════════════════════
    [Transaction(TransactionMode.ReadOnly)]
    public class ExploreElementsCommand : IExternalCommand
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
                // --- Resolve element source ---
                var selIds = uidoc.Selection.GetElementIds();

                ICollection<ElementId> ids;
                if (selIds.Count > 0)
                {
                    ids = selIds;
                }
                else
                {
                    // Fall back to everything visible in the active view.
                    // WhereElementIsNotElementType keeps instances only.
                    ids = new FilteredElementCollector(doc, doc.ActiveView.Id)
                        .WhereElementIsNotElementType()
                        .ToElementIds();
                }

                if (ids.Count == 0)
                {
                    TaskDialog.Show("ONEXUS – Explore Elements",
                        "No elements found.\n\n" +
                        "Select elements in Revit, or open a view that contains model elements.");
                    return Result.Cancelled;
                }

                // --- Build & post graph ---
                var graph = OnexusExportCore.BuildGenericElementGraph(doc, ids);
                OnexusPaneManager.ShowGraph(uiapp, graph);

                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.ToString();
                return Result.Failed;
            }
        }
    }
}
