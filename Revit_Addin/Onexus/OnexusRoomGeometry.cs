// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
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
    public class OnexusRoomGeometry : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc?.Document == null)
            {
                message = "Open a Revit project before exporting 3D Rooms.";
                return Result.Failed;
            }

            try
            {
                var package = OnexusRoomGeometryExporter.BuildPackage(
                    uidoc.Document,
                    uidoc.Selection.GetElementIds());
                var path = OnexusRoomGeometryExporter.SaveWithDialog(package, uidoc.Document.Title);
                if (path == null) return Result.Cancelled;

                var summary = package.summary;
                TaskDialog.Show(
                    "ONEXUS — 3D Rooms",
                    $"Saved {summary.validGeometryCount} selectable Room solid(s).\n\n" +
                    $"Rooms checked: {summary.roomCount}\n" +
                    $"Triangles: {summary.triangleCount}\n" +
                    $"Unplaced: {summary.unplacedCount}\n" +
                    $"Unenclosed: {summary.unenclosedCount}\n" +
                    $"Failed: {summary.failedCount}\n\n" +
                    $"File: {path}\n\n" +
                    "Place this file in the registered CDI project folder and reconnect the model to load it automatically.");
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
