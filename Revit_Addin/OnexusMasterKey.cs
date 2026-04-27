// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen
// (C) ONES — Selection-based Master Key Exporter
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Newtonsoft.Json;

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

                var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                var filePath = Path.Combine(desktop, "onexus_master_key.json");
                File.WriteAllText(filePath, JsonConvert.SerializeObject(graph, Formatting.Indented));

                TaskDialog.Show("ONEXUS Export",
                  $"Master Key graph exported to:\n{filePath}\n\nNodes: {graph.elements.nodes.Count}, Edges: {graph.elements.edges.Count}");

                // open in ONEXUS (same way as OnexusDoors)
                string onexusFolder = @"D:\VS\onexus";
                OnexusViewer.ShowFromFile(uiapp, onexusFolder, filePath);
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
