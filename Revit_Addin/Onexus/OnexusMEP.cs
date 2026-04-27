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
    // ══════════════════════════════════════════════════════════════════════════
    //  OnexusMEP — Phase 3 command
    //
    //  Exports all MEP systems in the active document to the ONEXUS docked
    //  panel as a graph.
    //
    //  Node types produced:
    //    MechanicalSystem, ElectricalSystem, PipingSystem
    //    MepEquipment, MepTerminal, MepFixture, MepLighting, MepDevice
    //
    //  Edge types produced:
    //    SuppliedBy  (System → BaseEquipment, dimension: MEP)
    //    ConnectedTo (Terminal/Fixture → System,  dimension: MEP)
    //
    //  Works best on MEP or combined (architectural + MEP) Revit models.
    //  Shows a friendly message when no MEP systems are found.
    // ══════════════════════════════════════════════════════════════════════════
    [Transaction(TransactionMode.ReadOnly)]
    public class OnexusMEP : IExternalCommand
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
                var graph = OnexusExportCore.BuildMEPSystemsGraph(doc);

                if (graph.elements.nodes.Count == 0)
                {
                    TaskDialog.Show(
                        "ONEXUS — MEP Systems",
                        "No MEP systems or connected equipment were found in this document.\n\n" +
                        "This command works with MEP and combined (Architectural + MEP) Revit models.\n\n" +
                        "Tip: Open or link an MEP model, then run this command again.");
                    return Result.Cancelled;
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
