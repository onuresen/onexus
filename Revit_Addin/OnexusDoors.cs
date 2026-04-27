// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System;
using System.Diagnostics;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

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

                // Push to the docked panel
                OnexusPaneManager.ShowGraph(uiapp, graph);

                sw.Stop();
                UtilsMisc.ONESLogs(uidoc, ToString(), sw);
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
