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

                OnexusGraph graph;

                if (selection != null && selection.Count > 0)
                {
                    // Elements selected: show actual parameter values on those elements
                    // (includes built-in parameters, shared params, and project params)
                    graph = OnexusExportCore.BuildElementParameterValueGraph(doc, selection, opt);
                }
                else
                {
                    // Nothing selected: show the project-level parameter binding schema
                    TaskDialog.Show("ONEXUS — Parameters",
                        "No elements selected.\n\n" +
                        "Select one or more elements first to see their actual parameter values.\n\n" +
                        "Showing project-level parameter schema instead.");
                    graph = OnexusExportCore.BuildParameterBindingGraphScoped(doc, selection, opt);
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
