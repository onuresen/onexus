// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System.Diagnostics;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace ONES
{
    [Transaction(TransactionMode.Manual)]
    public class Onexus : IExternalCommand
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
                var selIds = uidoc.Selection.GetElementIds();
                var graph = OnexusExportCore.BuildRoomsAndElementsSpatialGraph(doc, selIds);

                OnexusExportCore.SaveGraphWithDialog(
                    graph,
                    $"{System.IO.Path.GetFileNameWithoutExtension(doc.Title)}-onexus.json");

                TaskDialog.Show("ONEXUS Export",
                    $"Exported {graph.elements.nodes.Count} nodes and {graph.elements.edges.Count} edges.");

                sw.Stop();
                UtilsMisc.ONESLogs(uidoc, ToString(), sw); // preserves your original logging
                return Result.Succeeded;
            }
            catch (System.Exception ex)
            {
                sw.Stop();
                message = ex.ToString();
                return Result.Failed;
            }
        }
    }
}
