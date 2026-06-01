// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen
using System;
using System.Linq;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace Onexus
{
    [Transaction(TransactionMode.ReadOnly)]
    public class OnexusProximityLinks : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var uiapp = commandData.Application;
            var uidoc = uiapp.ActiveUIDocument;
            var doc = uidoc.Document;

            try
            {
                var selIds = uidoc.Selection.GetElementIds();
                if (selIds == null || selIds.Count == 0)
                {
                    TaskDialog.Show("ONEXUS", "Select one or more elements and run again.");
                    return Result.Cancelled;
                }

                var sel = selIds.Select(id => doc.GetElement(id)).Where(e => e != null).ToList();

                var folder = OnexusSettings.EnsureOnexusFolder();
                if (folder == null) return Result.Cancelled;

                var activeViewId = uidoc.ActiveView != null ? uidoc.ActiveView.Id : ElementId.InvalidElementId;

                var opt = new OnexusExportCore.ProximityLinksOptions();
                var graph = OnexusExportCore.BuildProximityLinksGraph(doc, activeViewId, sel, opt);

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
