// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen
// (C) ONES — Selection-based Master Key Exporter
using System;
using System.Diagnostics;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace ONES
{
    [Transaction(TransactionMode.Manual)]
    public class OnexusMasterKey : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var uiapp = commandData.Application;
            var uidoc = uiapp.ActiveUIDocument;
            var doc = uidoc.Document;

            try
            {
                var sel = uidoc.Selection.GetElementIds();
                if (sel == null || sel.Count == 0)
                {
                    TaskDialog.Show("ONEXUS", "Please select one or more Doors and run again.");
                    return Result.Cancelled;
                }

                // Options: default InferDeviceLinks = true (500 mm)
                var opt = new OnexusExportCore.MasterKeyOptions
                {
                    InferDeviceLinks = true,
                    ProximityMM = 500.0,
                    IncludeVendors = true,
                    IncludeRooms = true
                };

                var activeViewId = uidoc.ActiveView != null ? uidoc.ActiveView.Id : ElementId.InvalidElementId;

                var graph = OnexusExportCore.BuildMasterKeySelectionGraph(doc, activeViewId, sel, opt);

                // Push to the docked panel
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
