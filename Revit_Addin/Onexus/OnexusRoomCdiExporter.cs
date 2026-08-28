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
using Autodesk.Revit.DB.Mechanical;
using Newtonsoft.Json;

namespace Onexus
{
    /// <summary>
    /// Exports Rooms, Doors, Windows, and (when selected) Room/Space-associated
    /// equipment as `cdi-revit-onexus-export-v1`
    /// (Construction_Decision_Intelligence/Spatial_Decision_Graph docs/28,
    /// docs/51, and docs/71 "Group B — Revit-native context export"). Model
    /// Derivative's 3D translation never carries Room elements — they have no
    /// 3D solid to tessellate, confirmed against two real republishes — so
    /// this reads facts straight through the Revit API, which does not have
    /// that limitation.
    ///
    /// This generalises the original Room-only "CDI Rooms" exporter into a
    /// geometry-light model-context export while keeping the same read-only
    /// command and file contract: it now also records Family Type identity
    /// (kept apart from instance identity), Door FromRoom/ToRoom and
    /// Door/Window Host as stable UniqueId references (not just labels), and
    /// source-native relationships (hostedBy, connectsTo, installedIn,
    /// belongsToSystem) with stable endpoints. It never infers `controls` or
    /// any other functional relationship from proximity — every relationship
    /// emitted here traces back to a real Revit API fact.
    ///
    /// Deliberately separate from OnexusRoomGeometryExporter
    /// (`cdi-room-geometry-v1`, the "3D Rooms" ribbon command): that command
    /// triangulates real Room solids for the selectable-mesh viewer companion.
    /// This one emits element identity, level, real parameters, and stable
    /// relationships for CDI's decision graph, not the viewer.
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

            var phase = ResolveLastPhase(doc);

            var selected = (selectionOrNull ?? Array.Empty<ElementId>())
                .Select(id => doc.GetElement(id))
                .Where(e => e != null && !(e is ElementType))
                .ToList();

            var selectedRooms = selected.OfType<Room>().ToList();
            var selectedFamilyInstances = selected.OfType<FamilyInstance>().ToList();
            var selectedDoors = selectedFamilyInstances.Where(IsDoor).ToList();
            var selectedWindows = selectedFamilyInstances.Where(IsWindow).ToList();
            var selectedEquipment = selectedFamilyInstances.Where(fi => !IsDoor(fi) && !IsWindow(fi)).ToList();

            var hasExplicitSelection =
                selectedRooms.Count + selectedDoors.Count + selectedWindows.Count + selectedEquipment.Count > 0;

            List<Room> rooms;
            List<FamilyInstance> doors;
            List<FamilyInstance> windows;
            List<FamilyInstance> equipment;

            if (hasExplicitSelection)
            {
                rooms = selectedRooms;
                doors = selectedDoors;
                windows = selectedWindows;
                equipment = selectedEquipment;
            }
            else
            {
                rooms = new FilteredElementCollector(doc)
                    .OfCategory(BuiltInCategory.OST_Rooms)
                    .WhereElementIsNotElementType()
                    .Cast<Room>()
                    .Where(r => r.Area > 0)
                    .ToList();

                doors = new FilteredElementCollector(doc)
                    .OfCategory(BuiltInCategory.OST_Doors)
                    .WhereElementIsNotElementType()
                    .Cast<FamilyInstance>()
                    .ToList();

                windows = new FilteredElementCollector(doc)
                    .OfCategory(BuiltInCategory.OST_Windows)
                    .WhereElementIsNotElementType()
                    .Cast<FamilyInstance>()
                    .ToList();

                // Equipment (card readers and similar Room/Space-associated
                // FamilyInstances) is scanned only when explicitly selected —
                // an unscoped model-wide FamilyInstance sweep would stop being
                // "geometry-light" and would sweep in unrelated furniture/MEP
                // noise that nobody asked to export.
                equipment = new List<FamilyInstance>();
            }

            var modelId = SanitizeModelId(doc.Title);
            var documentId = doc.ProjectInformation?.UniqueId ?? doc.Title;

            var package = new CdiRevitExportPackage
            {
                export = new CdiRevitExportInfo
                {
                    exportedAt = DateTime.UtcNow.ToString("O"),
                    documentId = documentId,
                    documentName = doc.Title,
                    phase = phase?.Name ?? ""
                }
            };

            package.models.Add(new CdiRevitExportModel
            {
                modelId = modelId,
                name = doc.Title,
                sourceDocumentId = documentId
            });

            var elementsByUniqueId = new Dictionary<string, CdiRevitExportElement>(StringComparer.Ordinal);

            CdiRevitExportElement EnsureElement(Element el)
            {
                if (el == null) return null;
                if (elementsByUniqueId.TryGetValue(el.UniqueId, out var existing)) return existing;

                var built = BuildGenericElement(doc, el, modelId);
                elementsByUniqueId[el.UniqueId] = built;
                package.elements.Add(built);
                return built;
            }

            void AddRelationship(string sourceUniqueId, string targetUniqueId, string type, string evidence)
            {
                package.relationships.Add(new CdiRevitExportRelationship
                {
                    sourceModelId = modelId,
                    sourceExternalId = sourceUniqueId,
                    targetModelId = modelId,
                    targetExternalId = targetUniqueId,
                    type = type,
                    method = "native",
                    evidence = new List<string> { evidence }
                });
            }

            void LinkHost(FamilyInstance fi, CdiRevitExportElement el)
            {
                Element host = null;
                try { host = fi.Host; } catch { /* not every family instance is hosted — safe-fail */ }
                if (host == null) return;

                EnsureElement(host);
                el.semantics.host = DisplayName(host);
                el.semantics.hostId = host.UniqueId;
                AddRelationship(el.uniqueId, host.UniqueId, "hostedBy",
                    "Revit Host property (FamilyInstance.Host).");
            }

            void LinkSystems(FamilyInstance fi, CdiRevitExportElement el)
            {
                List<MEPSystem> systems;
                try
                {
                    systems = new FilteredElementCollector(doc)
                        .OfClass(typeof(MEPSystem))
                        .Cast<MEPSystem>()
                        .ToList();
                }
                catch { return; /* not every model exposes MEP systems — safe-fail */ }

                string firstName = null;
                var systemIds = new List<string>();

                foreach (var sys in systems)
                {
                    var isMember = false;
                    try
                    {
                        foreach (Element member in sys.Elements)
                        {
                            if (member != null && member.Id == fi.Id) { isMember = true; break; }
                        }
                    }
                    catch { continue; /* corrupt/partial system — safe-fail */ }

                    if (!isMember) continue;

                    EnsureElement(sys);
                    systemIds.Add(sys.UniqueId);
                    firstName ??= sys.Name;
                    AddRelationship(el.uniqueId, sys.UniqueId, "belongsToSystem",
                        "Revit MEPSystem membership (System.Elements).");
                }

                if (systemIds.Count == 0) return;
                el.semantics.system = firstName ?? "";
                el.semantics.systemIds = systemIds;
            }

            foreach (var room in rooms.OrderBy(r => r.Number).ThenBy(r => r.Name))
                EnsureElement(room);

            foreach (var door in doors)
            {
                var el = EnsureElement(door);
                if (el == null) continue;

                // The parameterless FromRoom/ToRoom properties resolve against
                // the last phase of the document (recorded in export.phase) —
                // see CdiRevitExportInfo.phase for why an explicit phase
                // parameter is not used here.
                Room fromRoom = null, toRoom = null;
                try { fromRoom = door.FromRoom; } catch { /* safe-fail */ }
                try { toRoom = door.ToRoom; } catch { /* safe-fail */ }

                if (fromRoom != null && fromRoom.Area > 0)
                {
                    EnsureElement(fromRoom);
                    el.semantics.fromRoom = DisplayName(fromRoom);
                    el.semantics.fromRoomId = fromRoom.UniqueId;
                    AddRelationship(el.uniqueId, fromRoom.UniqueId, "connectsTo",
                        $"Revit Door FromRoom (phase: {phase?.Name ?? "unknown"}).");
                }

                if (toRoom != null && toRoom.Area > 0)
                {
                    EnsureElement(toRoom);
                    el.semantics.toRoom = DisplayName(toRoom);
                    el.semantics.toRoomId = toRoom.UniqueId;
                    AddRelationship(el.uniqueId, toRoom.UniqueId, "connectsTo",
                        $"Revit Door ToRoom (phase: {phase?.Name ?? "unknown"}).");
                }

                LinkHost(door, el);
            }

            foreach (var window in windows)
            {
                var el = EnsureElement(window);
                if (el == null) continue;

                LinkHost(window, el);
            }

            foreach (var equip in equipment)
            {
                var el = EnsureElement(equip);
                if (el == null) continue;

                Room room = null;
                try { room = equip.Room; } catch { /* safe-fail */ }

                if (room != null && room.Area > 0)
                {
                    EnsureElement(room);
                    el.semantics.room = DisplayName(room);
                    el.semantics.roomId = room.UniqueId;
                    AddRelationship(el.uniqueId, room.UniqueId, "installedIn",
                        "Revit Room property (FamilyInstance.Room).");
                }
                else
                {
                    Space space = null;
                    try { space = equip.Space; } catch { /* not every model has MEP Spaces — safe-fail */ }
                    if (space != null)
                    {
                        EnsureElement(space);
                        el.semantics.space = DisplayName(space);
                        el.semantics.spaceId = space.UniqueId;
                        AddRelationship(el.uniqueId, space.UniqueId, "installedIn",
                            "Revit Space property (FamilyInstance.Space).");
                    }
                }

                LinkHost(equip, el);
                LinkSystems(equip, el);
            }

            return package;
        }

        public static string SaveWithDialog(CdiRevitExportPackage package)
        {
            if (package == null) throw new ArgumentNullException(nameof(package));

            using (var dialog = new System.Windows.Forms.SaveFileDialog())
            {
                dialog.Title = "Export Model Context for CDI";
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

        private static bool IsDoor(FamilyInstance fi) =>
            fi.Category?.Id.Value == (long)BuiltInCategory.OST_Doors;

        private static bool IsWindow(FamilyInstance fi) =>
            fi.Category?.Id.Value == (long)BuiltInCategory.OST_Windows;

        private static CdiRevitExportElement BuildGenericElement(Document doc, Element el, string modelId)
        {
            var fi = el as FamilyInstance;

            return new CdiRevitExportElement
            {
                modelId = modelId,
                // UniqueId is Revit's own permanently-stable identity (the
                // same value Autodesk Platform Services calls "externalId") —
                // used for both fields so downstream tools can always resolve
                // this element back to the live Revit element. ElementId is
                // carried too, but only as a session-scoped diagnostic value.
                externalId = el.UniqueId,
                uniqueId = el.UniqueId,
                elementId = el.Id.Value,
                name = DisplayName(el),
                kind = MapKind(el),
                category = el.Category?.Name ?? "",
                level = TryGetLevel(el, doc)?.Name ?? "",
                family = fi?.Symbol?.Family?.Name ?? "",
                type = fi?.Symbol?.Name ?? "",
                typeIdentity = BuildTypeIdentity(doc, el),
                semantics = new CdiRevitExportSemantics { mark = MarkOf(el) },
                localSpatial = BuildLocalSpatial(el),
                parameters = ReadParameters(doc, el)
            };
        }

        private static CdiRevitExportTypeIdentity BuildTypeIdentity(Document doc, Element el)
        {
            try
            {
                var typeId = el.GetTypeId();
                if (typeId == null || typeId == ElementId.InvalidElementId)
                    return new CdiRevitExportTypeIdentity();

                var typeEl = doc.GetElement(typeId);
                if (typeEl == null) return new CdiRevitExportTypeIdentity();

                return new CdiRevitExportTypeIdentity
                {
                    typeId = typeId.Value.ToString(),
                    typeUniqueId = typeEl.UniqueId,
                    typeName = typeEl.Name ?? ""
                };
            }
            catch
            {
                // Family Type identity is optional context — safe-fail.
                return new CdiRevitExportTypeIdentity();
            }
        }

        private static string DisplayName(Element el)
        {
            if (el is Room room)
                return !string.IsNullOrWhiteSpace(room.Name) ? room.Name : (room.Number ?? "Room");

            if (el is FamilyInstance fi)
            {
                var fam = fi.Symbol?.Family?.Name;
                var typ = fi.Symbol?.Name;
                if (!string.IsNullOrWhiteSpace(fam) && !string.IsNullOrWhiteSpace(typ))
                    return $"{fam} : {typ}";
                return fam ?? typ ?? (fi.Name ?? "Element");
            }

            return !string.IsNullOrWhiteSpace(el.Name) ? el.Name : (el.Category?.Name ?? "Element");
        }

        private static string MapKind(Element el)
        {
            if (el is Room) return "Room";
            if (el is Space) return "Space";
            if (el is MEPSystem) return "System";

            var bic = el.Category?.Id.Value;
            if (bic == (long)BuiltInCategory.OST_Doors) return "Door";
            if (bic == (long)BuiltInCategory.OST_Windows) return "Window";
            if (bic == (long)BuiltInCategory.OST_Walls) return "Wall";
            if (bic == (long)BuiltInCategory.OST_Floors) return "Floor";
            if (bic == (long)BuiltInCategory.OST_Ceilings) return "Ceiling";
            if (el is FamilyInstance) return "Equipment";
            return "Other";
        }

        private static string MarkOf(Element el)
        {
            try
            {
                if (el is Room room) return room.Number ?? "";

                var p = el.get_Parameter(BuiltInParameter.ALL_MODEL_MARK);
                if (p != null && p.HasValue) return p.AsString() ?? "";
            }
            catch { /* mark is optional — safe-fail */ }

            return "";
        }

        private static Level TryGetLevel(Element el, Document doc)
        {
            try
            {
                if (el is Room room) return room.Level;
                if (el is Space space) return space.Level;
            }
            catch { /* safe-fail */ }

            try
            {
                if (el.LevelId != null && el.LevelId != ElementId.InvalidElementId)
                    return doc.GetElement(el.LevelId) as Level;
            }
            catch { /* safe-fail */ }

            try
            {
                var p = el.get_Parameter(BuiltInParameter.LEVEL_PARAM);
                if (p != null && p.StorageType == StorageType.ElementId)
                {
                    var id = p.AsElementId();
                    if (id != ElementId.InvalidElementId)
                        return doc.GetElement(id) as Level;
                }
            }
            catch { /* safe-fail */ }

            return null;
        }

        private static Phase ResolveLastPhase(Document doc)
        {
            try
            {
                var phases = doc.Phases;
                if (phases != null && phases.Size > 0)
                    return phases.get_Item(phases.Size - 1);
            }
            catch { /* documents without phasing — safe-fail */ }

            return null;
        }

        private static CdiRevitExportLocalSpatial BuildLocalSpatial(Element el)
        {
            var spatial = new CdiRevitExportLocalSpatial();

            try
            {
                if (el.Location is LocationPoint lp)
                {
                    spatial.anchor = new CdiRevitExportPoint { x = lp.Point.X, y = lp.Point.Y, z = lp.Point.Z };
                }
                else if (el.Location is LocationCurve lc)
                {
                    var mid = lc.Curve?.Evaluate(0.5, true);
                    if (mid != null)
                        spatial.anchor = new CdiRevitExportPoint { x = mid.X, y = mid.Y, z = mid.Z };
                }
            }
            catch { /* anchor is optional — safe-fail */ }

            try
            {
                var bb = el.get_BoundingBox(null);
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

        // Reads whatever the instance's parameters actually hold — not a
        // suggested field list. Those are only ever suggestions to the
        // project owner and may not be what was actually typed in (docs/51,
        // "Deliberately not done yet").
        private static Dictionary<string, string> ReadParameters(Document doc, Element el)
        {
            var values = new Dictionary<string, string>(StringComparer.Ordinal);

            foreach (Parameter p in el.Parameters)
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

                    // An element can carry both an instance and (rarely) a
                    // duplicate definition name; last-write-wins is fine —
                    // same as the dictionary this schema's `parameters` field
                    // models.
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
