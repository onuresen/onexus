// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Newtonsoft.Json;

namespace Onexus
{
    /// <summary>
    /// Exports Room elements as `cdi-revit-onexus-export-v1`
    /// (Construction_Decision_Intelligence/Spatial_Decision_Graph docs/28 and
    /// docs/51). Model Derivative's 3D translation never carries Room elements
    /// — they have no 3D solid to tessellate, confirmed against two real
    /// republishes — so this reads Room facts straight through the Revit API,
    /// which does not have that limitation.
    ///
    /// Deliberately separate from OnexusRoomGeometryExporter
    /// (`cdi-room-geometry-v1`, the "3D Rooms" ribbon command): that command
    /// triangulates real Room solids for the selectable-mesh viewer companion.
    /// This one emits Room identity, level, and whatever real parameters the
    /// user has actually filled in — for CDI's decision graph, not the viewer.
    /// </summary>
    public static class OnexusRoomCdiExporter
    {
        // Matches the default exclude convention used by OnexusParameters —
        // filters internal/IFC/AEC noise, not real project data.
        private static readonly Regex ExcludeParamNames =
            new Regex(@"^(_|IFC|AEC)", RegexOptions.IgnoreCase);

        public static CdiRevitExportPackage BuildPackage(Document doc, ICollection<ElementId> selectionOrNull)
        {
            if (doc == null) throw new ArgumentNullException(nameof(doc));

            var selectedRooms = (selectionOrNull ?? Array.Empty<ElementId>())
                .Select(id => doc.GetElement(id))
                .OfType<Room>()
                .ToList();

            var rooms = selectedRooms.Count > 0
                ? selectedRooms
                : new FilteredElementCollector(doc)
                    .OfCategory(BuiltInCategory.OST_Rooms)
                    .WhereElementIsNotElementType()
                    .Cast<Room>()
                    .Where(r => r.Area > 0)
                    .ToList();

            var modelId = SanitizeModelId(doc.Title);
            var documentId = doc.ProjectInformation?.UniqueId ?? doc.Title;

            var package = new CdiRevitExportPackage
            {
                export = new CdiRevitExportInfo
                {
                    exportedAt = DateTime.UtcNow.ToString("O"),
                    documentId = documentId,
                    documentName = doc.Title
                }
            };

            package.models.Add(new CdiRevitExportModel
            {
                modelId = modelId,
                name = doc.Title,
                sourceDocumentId = documentId
            });

            foreach (var room in rooms.OrderBy(r => r.Number).ThenBy(r => r.Name))
                package.elements.Add(BuildRoomElement(doc, room, modelId));

            return package;
        }

        public static string SaveWithDialog(CdiRevitExportPackage package)
        {
            if (package == null) throw new ArgumentNullException(nameof(package));

            using (var dialog = new System.Windows.Forms.SaveFileDialog())
            {
                dialog.Title = "Export Rooms for CDI";
                dialog.Filter = "CDI Revit/ONEXUS export (*.json)|*.json";
                dialog.FileName = "cdi-revit-onexus-export.json";
                dialog.DefaultExt = "json";
                dialog.AddExtension = true;
                if (!string.IsNullOrWhiteSpace(OnexusSettings.RoomCdiExportFolder) &&
                    Directory.Exists(OnexusSettings.RoomCdiExportFolder))
                    dialog.InitialDirectory = OnexusSettings.RoomCdiExportFolder;

                if (dialog.ShowDialog() != System.Windows.Forms.DialogResult.OK)
                    return null;

                var folder = Path.GetDirectoryName(dialog.FileName);
                if (!string.IsNullOrWhiteSpace(folder))
                    OnexusSettings.RoomCdiExportFolder = folder;

                File.WriteAllText(
                    dialog.FileName,
                    JsonConvert.SerializeObject(package, Formatting.Indented),
                    new UTF8Encoding(false));
                return dialog.FileName;
            }
        }

        private static CdiRevitExportElement BuildRoomElement(Document doc, Room room, string modelId)
        {
            return new CdiRevitExportElement
            {
                modelId = modelId,
                // Room.UniqueId is Revit's own permanently-stable identity (the
                // same value Autodesk Platform Services calls "externalId") —
                // used for both fields so downstream tools can always resolve
                // this Room back to the live Revit element.
                externalId = room.UniqueId,
                uniqueId = room.UniqueId,
                name = !string.IsNullOrWhiteSpace(room.Name) ? room.Name : (room.Number ?? "Room"),
                kind = "Room",
                category = room.Category?.Name ?? "Rooms",
                level = room.Level?.Name ?? "",
                semantics = new CdiRevitExportSemantics { mark = room.Number ?? "" },
                localSpatial = BuildLocalSpatial(room),
                parameters = ReadParameters(doc, room)
            };
        }

        private static CdiRevitExportLocalSpatial BuildLocalSpatial(Room room)
        {
            var spatial = new CdiRevitExportLocalSpatial();

            try
            {
                if (room.Location is LocationPoint lp)
                    spatial.anchor = new CdiRevitExportPoint { x = lp.Point.X, y = lp.Point.Y, z = lp.Point.Z };
            }
            catch { /* anchor is optional — safe-fail */ }

            try
            {
                var bb = room.get_BoundingBox(null);
                if (bb != null)
                {
                    spatial.bounds = new CdiRevitExportBounds
                    {
                        min = new CdiRevitExportPoint { x = bb.Min.X, y = bb.Min.Y, z = bb.Min.Z },
                        max = new CdiRevitExportPoint { x = bb.Max.X, y = bb.Max.Y, z = bb.Max.Z }
                    };
                }
            }
            catch { /* bounds are optional — safe-fail */ }

            return spatial;
        }

        // Reads whatever the Room instance's parameters actually hold — not the
        // suggested field list (Room Use, Department, Occupant Load, Fire
        // Compartment, Wet Room, Floor/Wall/Ceiling Finish, Area). Those were
        // only suggested to the project owner and may not be what was actually
        // typed in (docs/51, "Deliberately not done yet").
        private static Dictionary<string, string> ReadParameters(Document doc, Room room)
        {
            var values = new Dictionary<string, string>(StringComparer.Ordinal);

            foreach (Parameter p in room.Parameters)
            {
                try
                {
                    if (p?.Definition == null || !p.HasValue) continue;

                    var name = p.Definition.Name;
                    if (string.IsNullOrEmpty(name) || ExcludeParamNames.IsMatch(name)) continue;

                    string value = null;
                    switch (p.StorageType)
                    {
                        case StorageType.String:
                            value = p.AsString();
                            break;
                        case StorageType.Double:
                            value = p.AsValueString() ?? p.AsDouble().ToString("G6");
                            break;
                        case StorageType.Integer:
                            value = p.AsValueString() ?? p.AsInteger().ToString();
                            break;
                        case StorageType.ElementId:
                            var refEl = doc.GetElement(p.AsElementId());
                            value = refEl?.Name;
                            break;
                    }

                    if (string.IsNullOrEmpty(value)) continue;

                    // A Room can carry both an instance and (rarely) a duplicate
                    // definition name; last-write-wins is fine — same as the
                    // dictionary this schema's `parameters` field models.
                    values[name] = value;
                }
                catch { /* safe-fail per parameter */ }
            }

            return values;
        }

        private static string SanitizeModelId(string title)
        {
            if (string.IsNullOrWhiteSpace(title)) return "revit-model";

            var sb = new StringBuilder();
            foreach (var ch in title)
                sb.Append(char.IsLetterOrDigit(ch) || ch == '.' || ch == '_' || ch == '-' ? ch : '-');

            var slug = sb.ToString().Trim('-');
            if (!char.IsLetterOrDigit(slug.Length > 0 ? slug[0] : ' ')) slug = "m-" + slug;
            // Schema requires at least 2 characters (first char + 1-63 more).
            if (slug.Length < 2) return "revit-model";

            return slug.Length > 64 ? slug.Substring(0, 64) : slug;
        }
    }
}
