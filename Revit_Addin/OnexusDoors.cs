// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System;
using System.Diagnostics;
using System.IO;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Newtonsoft.Json;

namespace ONES
{
    [Transaction(TransactionMode.Manual)]
    public class OnexusDoors : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var uiapp = commandData.Application;
            var uidoc = uiapp.ActiveUIDocument;
            var doc = uidoc.Document;

            var sw = new Stopwatch();
            sw.Start();

            try
            {
                // Build graph: doors (type nodes) + subcomponents (type nodes) + PartOfSystem edges
                var graph = OnexusExportCore.BuildDoorTypeAndSubcomponentsGraph(doc);

                // Save to Desktop with a stable name (kept behavior), or use dialog if preferred
                var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                var filePath = Path.Combine(desktop, "onexus_doors.json");
                File.WriteAllText(filePath, JsonConvert.SerializeObject(graph, Formatting.Indented));

                TaskDialog.Show("ONEXUS Export",
                    $"Door type graph exported to:\n{filePath}\n\nNodes: {graph.elements.nodes.Count}, Edges: {graph.elements.edges.Count}");

                string onexusFolder = @"D:\VS\onexus"; // folder that contains index.html and /src/*
                OnexusViewer.ShowFromFile(uiapp, onexusFolder, filePath);

                sw.Stop();
                UtilsMisc.ONESLogs(uidoc, ToString(), sw); // preserves your original logging
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                sw.Stop();
                message = ex.Message;
                return Result.Failed;
            }
        }
    }
}
