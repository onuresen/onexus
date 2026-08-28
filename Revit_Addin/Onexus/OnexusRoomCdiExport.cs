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
    [Transaction(TransactionMode.ReadOnly)]
    public class OnexusRoomCdiExport : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc?.Document == null)
            {
                message = "Open a Revit project before exporting Rooms for CDI.";
                return Result.Failed;
            }

            try
            {
                var package = OnexusRoomCdiExporter.BuildPackage(uidoc.Document, uidoc.Selection.GetElementIds());
                if (package.elements.Count == 0)
                {
                    TaskDialog.Show("ONEXUS — Model Context Export (CDI)",
                        "No Rooms, Doors, or Windows were found to export.\n\n" +
                        "Select one or more Rooms/Doors/Windows/equipment first, or place/enclose Rooms " +
                        "in the model.");
                    return Result.Cancelled;
                }

                var path = OnexusRoomCdiExporter.SaveWithDialog(package);
                if (path == null) return Result.Cancelled;

                TaskDialog.Show("ONEXUS — Model Context Export (CDI)",
                    $"Exported {package.elements.Count} element(s) and {package.relationships.Count} " +
                    $"relationship(s) as cdi-revit-onexus-export-v1.\n\n" +
                    $"File: {path}\n\n" +
                    "Convert with convert_revit_onexus_snapshot.py, then merge into the live CDI " +
                    "snapshot with merge_onexus_rooms.py (Spatial_Decision_Graph/source-adapters).");
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                message = ex.ToString();
                return Result.Failed;
            }
        }
    }
}
