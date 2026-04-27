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
    [Transaction(TransactionMode.Manual)]
    public class OnexusParameters : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var uiapp = commandData.Application;
            var uidoc = uiapp.ActiveUIDocument;
            var doc = uidoc.Document;

            try
            {
                var selection = uidoc.Selection.GetElementIds();

                var opt = new OnexusExportCore.ParamExportOptions
                {
                    OnlyAffectingSelection = selection != null && selection.Count > 0,
                    IncludeNameRegex = null,
                    ExcludeNameRegex = @"^(_|IFC|AEC)",
                    MaxTypesPerCategory = 40,
                    MaxParameters = 800
                };

                OnexusGraph graph = OnexusExportCore.BuildParameterBindingGraphScoped(doc, selection, opt);

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
