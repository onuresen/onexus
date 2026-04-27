// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

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
    public class OnexusParameters : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var uiapp = commandData.Application;
            var uidoc = uiapp.ActiveUIDocument;
            var doc = uidoc.Document;

            var sw = new Stopwatch(); sw.Start();
            try
            {
                var selection = uidoc.Selection.GetElementIds();

                // Configure scope (adjust defaults as you like)
                var opt = new OnexusExportCore.ParamExportOptions
                {
                    OnlyAffectingSelection = selection != null && selection.Count > 0, // if nothing selected, export is model-wide but still bounded
                                                                                       // CategoryWhitelist = new HashSet<BuiltInCategory> { BuiltInCategory.OST_Doors },
                    IncludeNameRegex = null,                     // e.g., "^(Fire|Door|Hardware)"
                    ExcludeNameRegex = @"^(_|IFC|AEC)",         // skip “_hidden”, IFC, AEC prefixed parameters
                    MaxTypesPerCategory = 40,
                    MaxParameters = 800
                };

                OnexusGraph graph = OnexusExportCore.BuildParameterBindingGraphScoped(doc, selection, opt);

                var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                var suffix = doc.IsFamilyDocument ? "family_parameters" :
                               (opt.OnlyAffectingSelection ? "sel_parameters" : "parameters");
                var filePath = Path.Combine(desktop, $"onexus_{suffix}.json");

                File.WriteAllText(filePath, JsonConvert.SerializeObject(graph, Formatting.Indented));

                TaskDialog.Show("ONEXUS Export",
                  $"Parameter graph exported to:\n{filePath}\n\nNodes: {graph.elements.nodes.Count}, Edges: {graph.elements.edges.Count}");

                string onexusFolder = @"D:\VS\onexus";  // same as your Door command
                OnexusViewer.ShowFromFile(uiapp, onexusFolder, filePath);

                sw.Stop();
                UtilsMisc.ONESLogs(uidoc, ToString(), sw); // your logger
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
