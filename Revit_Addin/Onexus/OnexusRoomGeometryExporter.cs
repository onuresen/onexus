// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Newtonsoft.Json;

namespace Onexus
{
    /// <summary>
    /// Extracts real Revit Room solids without creating or changing elements.
    /// One calculator is reused for the complete pass so Revit can reuse its
    /// spatial-geometry cache.
    /// </summary>
    public static class OnexusRoomGeometryExporter
    {
        private const double VertexQuantization = 1_000_000.0;

        public static CdiRoomGeometryPackage BuildPackage(
            Document doc,
            ICollection<ElementId> selectionOrNull)
        {
            if (doc == null) throw new ArgumentNullException(nameof(doc));

            var selectedRooms = (selectionOrNull ?? Array.Empty<ElementId>())
                .Select(id => doc.GetElement(id))
                .OfType<Room>()
                .ToList();
            var selectionScoped = selectedRooms.Count > 0;
            var rooms = selectionScoped
                ? selectedRooms
                : new FilteredElementCollector(doc)
                    .OfCategory(BuiltInCategory.OST_Rooms)
                    .WhereElementIsNotElementType()
                    .Cast<Room>()
                    .ToList();

            var package = new CdiRoomGeometryPackage
            {
                export = new CdiRoomGeometryExport
                {
                    exportedAt = DateTime.UtcNow.ToString("O"),
                    selectionScope = selectionScoped ? "selected-rooms" : "all-rooms"
                },
                model = new CdiRoomGeometryModel
                {
                    documentId = doc.ProjectInformation?.UniqueId ?? doc.Title,
                    documentName = doc.Title,
                    applicationVersion = doc.Application?.VersionNumber ?? ""
                }
            };

            var boundaryOptions = new SpatialElementBoundaryOptions
            {
                SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish,
                StoreFreeBoundaryFaces = true
            };

            using (var calculator = new SpatialElementGeometryCalculator(doc, boundaryOptions))
            {
                foreach (var room in rooms.OrderBy(r => r.Number).ThenBy(r => r.Name))
                    package.rooms.Add(BuildRoomRecord(doc, calculator, room));
            }

            package.summary = Summarize(package.rooms);
            return package;
        }

        public static string SaveWithDialog(CdiRoomGeometryPackage package, string documentTitle)
        {
            if (package == null) throw new ArgumentNullException(nameof(package));

            using (var dialog = new System.Windows.Forms.SaveFileDialog())
            {
                dialog.Title = "Export selectable 3D Rooms for CDI";
                dialog.Filter = "CDI Room geometry (*.json)|*.json";
                dialog.FileName = "cdi-room-geometry.json";
                dialog.DefaultExt = "json";
                dialog.AddExtension = true;
                if (!string.IsNullOrWhiteSpace(OnexusSettings.RoomGeometryFolder) &&
                    Directory.Exists(OnexusSettings.RoomGeometryFolder))
                    dialog.InitialDirectory = OnexusSettings.RoomGeometryFolder;

                if (dialog.ShowDialog() != System.Windows.Forms.DialogResult.OK)
                    return null;

                var folder = Path.GetDirectoryName(dialog.FileName);
                if (!string.IsNullOrWhiteSpace(folder))
                    OnexusSettings.RoomGeometryFolder = folder;
                File.WriteAllText(
                    dialog.FileName,
                    JsonConvert.SerializeObject(package, Formatting.Indented),
                    new UTF8Encoding(false));
                return dialog.FileName;
            }
        }

        private static CdiRoomGeometryRecord BuildRoomRecord(
            Document doc,
            SpatialElementGeometryCalculator calculator,
            Room room)
        {
            var record = new CdiRoomGeometryRecord
            {
                externalId = room.UniqueId,
                elementId = room.Id.Value,
                number = room.Number ?? "",
                name = room.Name ?? room.Number ?? "Room",
                level = room.Level?.Name ?? "",
                phase = PhaseName(doc, room),
                geometryStatus = "failed",
                message = "Room geometry was not calculated."
            };

            if (room.Location == null)
            {
                record.geometryStatus = "unplaced";
                record.message = "Room is not placed in the model.";
                return record;
            }
            if (room.Area <= 0)
            {
                record.geometryStatus = "unenclosed";
                record.message = "Room has no enclosed area.";
                return record;
            }

            try
            {
                var solid = calculator.CalculateSpatialElementGeometry(room).GetGeometry();
                if (solid == null || solid.Volume <= 0 || solid.Faces.IsEmpty)
                {
                    record.geometryStatus = "unenclosed";
                    record.message = "Revit returned no positive-volume Room solid.";
                    return record;
                }

                var mesh = Triangulate(solid);
                if (mesh.indices.Count < 3)
                {
                    record.message = "Revit returned a Room solid without drawable triangles.";
                    return record;
                }

                record.mesh = mesh;
                record.geometryStatus = "valid";
                record.message = "Real Room solid calculated by Revit.";
                return record;
            }
            catch (Exception ex)
            {
                record.message = ex.Message;
                return record;
            }
        }

        private static CdiRoomMesh Triangulate(Solid solid)
        {
            var result = new CdiRoomMesh();
            var vertexIndices = new Dictionary<VertexKey, int>();
            double minX = double.PositiveInfinity, minY = double.PositiveInfinity, minZ = double.PositiveInfinity;
            double maxX = double.NegativeInfinity, maxY = double.NegativeInfinity, maxZ = double.NegativeInfinity;

            foreach (Face face in solid.Faces)
            {
                var faceMesh = face.Triangulate();
                for (var triangleIndex = 0; triangleIndex < faceMesh.NumTriangles; triangleIndex++)
                {
                    var triangle = faceMesh.get_Triangle(triangleIndex);
                    for (var corner = 0; corner < 3; corner++)
                    {
                        var point = triangle.get_Vertex(corner);
                        var key = new VertexKey(point);
                        if (!vertexIndices.TryGetValue(key, out var index))
                        {
                            index = result.vertices.Count / 3;
                            vertexIndices.Add(key, index);
                            result.vertices.Add(point.X);
                            result.vertices.Add(point.Y);
                            result.vertices.Add(point.Z);
                            minX = Math.Min(minX, point.X); minY = Math.Min(minY, point.Y); minZ = Math.Min(minZ, point.Z);
                            maxX = Math.Max(maxX, point.X); maxY = Math.Max(maxY, point.Y); maxZ = Math.Max(maxZ, point.Z);
                        }
                        result.indices.Add(index);
                    }
                }
            }

            if (result.vertices.Count > 0)
            {
                result.bounds = new CdiRoomBounds
                {
                    min = new CdiRoomPoint { x = minX, y = minY, z = minZ },
                    max = new CdiRoomPoint { x = maxX, y = maxY, z = maxZ }
                };
            }
            return result;
        }

        private static CdiRoomGeometrySummary Summarize(IEnumerable<CdiRoomGeometryRecord> rooms)
        {
            var records = rooms.ToList();
            return new CdiRoomGeometrySummary
            {
                roomCount = records.Count,
                validGeometryCount = records.Count(item => item.geometryStatus == "valid"),
                unplacedCount = records.Count(item => item.geometryStatus == "unplaced"),
                unenclosedCount = records.Count(item => item.geometryStatus == "unenclosed"),
                failedCount = records.Count(item => item.geometryStatus == "failed"),
                triangleCount = records.Sum(item => (item.mesh?.indices.Count ?? 0) / 3)
            };
        }

        private static string PhaseName(Document doc, Room room)
        {
            try
            {
                var phaseId = room.get_Parameter(BuiltInParameter.ROOM_PHASE_ID)?.AsElementId();
                return phaseId == null || phaseId == ElementId.InvalidElementId
                    ? ""
                    : doc.GetElement(phaseId)?.Name ?? "";
            }
            catch { return ""; }
        }

        private readonly struct VertexKey : IEquatable<VertexKey>
        {
            private readonly long _x;
            private readonly long _y;
            private readonly long _z;

            public VertexKey(XYZ point)
            {
                _x = (long)Math.Round(point.X * VertexQuantization);
                _y = (long)Math.Round(point.Y * VertexQuantization);
                _z = (long)Math.Round(point.Z * VertexQuantization);
            }

            public bool Equals(VertexKey other) => _x == other._x && _y == other._y && _z == other._z;
            public override bool Equals(object obj) => obj is VertexKey other && Equals(other);
            public override int GetHashCode() => HashCode.Combine(_x, _y, _z);
        }
    }
}
