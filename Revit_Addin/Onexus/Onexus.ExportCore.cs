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
using System.Windows.Forms;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
using View = Autodesk.Revit.DB.View;

namespace Onexus
{
    public static class OnexusExportCore
    {
        // --- Public entrypoints ------------------------------------------------

        // Rooms + Elements (+ Levels) + Spatial edges (selection or whole model)
        public static OnexusGraph BuildRoomsAndElementsSpatialGraph(Document doc, ICollection<ElementId> selectionOrNull)
        {
            var graph = NewGraph(doc);

            var nodeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var edgeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var referencedLevels = new HashSet<ElementId>();

            // Rooms
            var rooms = new FilteredElementCollector(doc)
                .OfCategory(BuiltInCategory.OST_Rooms)
                .WhereElementIsNotElementType()
                .Cast<Room>()
                .Where(r => r.Area > 0)
                .ToList();

            foreach (var room in rooms)
            {
                var roomId = room.UniqueId;
                if (nodeSeen.Add(roomId))
                {
                    var level = room.Level;
                    if (level != null) referencedLevels.Add(level.Id);

                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id = roomId,
                            nodeType = "Space",
                            category = "Room",
                            label = new Dictionary<string, string>
                            {
                                ["en"] = MakeRoomLabel(room),
                                ["jp"] = MakeRoomLabel(room)
                            },
                            revitCategory = "Rooms",
                            level = level?.Name,
                            area  = room.Area,
                            mark  = room.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString(),
                            revitInstanceIds = new List<long> { room.Id.Value },
                            revitInstanceUids = new List<string> { room.UniqueId }
                        }
                    });

                    if (level != null)
                        AddEdge(graph, edgeSeen, "OnLevel", "Spatial", roomId, level.UniqueId, directional: true);
                }
            }

            // Elements (FamilyInstances)
            IEnumerable<FamilyInstance> fis = (selectionOrNull != null && selectionOrNull.Count > 0)
                ? selectionOrNull.Select(id => doc.GetElement(id)).OfType<FamilyInstance>()
                : new FilteredElementCollector(doc)
                    .WhereElementIsNotElementType()
                    .OfClass(typeof(FamilyInstance))
                    .Cast<FamilyInstance>();

            foreach (var fi in fis)
            {
                var id = fi.UniqueId;
                if (nodeSeen.Add(id))
                {
                    var lvl = TryGetLevel(fi, doc);
                    if (lvl != null) referencedLevels.Add(lvl.Id);

                    var cat = fi.Category?.Name ?? "Element";
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id = id,
                            nodeType = "Element",
                            category = cat,
                            label = new Dictionary<string, string>
                            {
                                ["en"] = MakeElementLabel(fi),
                                ["jp"] = MakeElementLabel(fi)
                            },
                            revitCategory = cat,
                            level = lvl?.Name,
                            // Phase 2: populate so Onexus→Revit selection resolves the element
                            revitInstanceIds = new List<long> { fi.Id.Value },
                            revitInstanceUids = new List<string> { fi.UniqueId }
                        }
                    });

                    if (lvl != null)
                        AddEdge(graph, edgeSeen, "OnLevel", "Spatial", id, lvl.UniqueId, directional: true);

                    // LocatedIn edges:
                    var isDoor = fi.Category?.Id.Value == (int)BuiltInCategory.OST_Doors;
                    var isWindow = fi.Category?.Id.Value == (int)BuiltInCategory.OST_Windows;

                    if (isDoor || isWindow)
                    {
                        var fr = fi.FromRoom;
                        var tr = fi.ToRoom;
                        if (fr != null && fr.Area > 0) AddEdge(graph, edgeSeen, "LocatedIn", "Spatial", id, fr.UniqueId, directional: true);
                        if (tr != null && tr.Area > 0) AddEdge(graph, edgeSeen, "LocatedIn", "Spatial", id, tr.UniqueId, directional: true);
                    }
                    else
                    {
                        var r = fi.Room;
                        if (r != null && r.Area > 0) AddEdge(graph, edgeSeen, "LocatedIn", "Spatial", id, r.UniqueId, directional: true);
                    }
                }
            }

            // Room adjacency via doors/windows: Door.FromRoom ↔ Door.ToRoom
            // Emits undirected AdjacentTo edges between rooms sharing an opening.
            foreach (var fi in fis)
            {
                try
                {
                    var isDoor   = fi.Category?.Id.Value == (long)BuiltInCategory.OST_Doors;
                    var isWindow = fi.Category?.Id.Value == (long)BuiltInCategory.OST_Windows;
                    if (!isDoor && !isWindow) continue;

                    var fr = fi.FromRoom;
                    var tr = fi.ToRoom;
                    if (fr != null && fr.Area > 0 && tr != null && tr.Area > 0)
                        AddEdge(graph, edgeSeen, "AdjacentTo", "Spatial",
                                fr.UniqueId, tr.UniqueId, directional: false, confidence: "Explicit");
                }
                catch { }
            }

            // MEP Spaces (only when present — architectural models typically have none)
            try
            {
                var mepSpaces = new FilteredElementCollector(doc)
                    .OfCategory(BuiltInCategory.OST_MEPSpaces)
                    .WhereElementIsNotElementType()
                    .Cast<Autodesk.Revit.DB.Mechanical.Space>()
                    .Where(s => s.Area > 0)
                    .ToList();

                foreach (var space in mepSpaces)
                {
                    var spaceId = space.UniqueId;
                    if (nodeSeen.Add(spaceId))
                    {
                        var lvl = space.Level;
                        if (lvl != null) referencedLevels.Add(lvl.Id);
                        var spaceLabel = (!string.IsNullOrWhiteSpace(space.Number) && !string.IsNullOrWhiteSpace(space.Name))
                            ? $"{space.Number} {space.Name}" : (space.Name ?? space.Number ?? "Space");

                        graph.elements.nodes.Add(new OnexusNode
                        {
                            data = new NodeData
                            {
                                id                = spaceId,
                                nodeType          = "Space",
                                category          = "MEPSpace",
                                label             = MakeBilingualLabel(spaceLabel),
                                revitCategory     = "Spaces",
                                level             = lvl?.Name,
                                area              = space.Area,
                                revitInstanceIds  = new List<long>   { space.Id.Value },
                                revitInstanceUids = new List<string> { spaceId }
                            }
                        });

                        if (lvl != null)
                            AddEdge(graph, edgeSeen, "OnLevel", "Spatial", spaceId, lvl.UniqueId, directional: true);
                    }
                }
            }
            catch { /* MEP Spaces not available in all model types — safe-fail */ }

            // Levels (only referenced)
            var levels = new FilteredElementCollector(doc)
                .OfClass(typeof(Level))
                .Cast<Level>()
                .Where(l => referencedLevels.Contains(l.Id));

            foreach (var lvl in levels)
            {
                var lvlId = lvl.UniqueId;
                if (nodeSeen.Add(lvlId))
                {
                    var label = lvl.Name ?? "Level";
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id = lvlId,
                            nodeType = "Level",
                            category = "Level",
                            label = new Dictionary<string, string>
                            {
                                ["en"] = label,
                                ["jp"] = label
                            },
                            revitCategory = "Levels",
                            level = label,
                            revitInstanceIds = new List<long> { lvl.Id.Value },
                            revitInstanceUids = new List<string> { lvl.UniqueId }
                        }
                    });
                }
            }

            return graph;
        }

        // ── Generic: Category → Type → Instance (works on any element collection) ─
        //
        // Source: any ICollection<ElementId> — typically the current selection, or
        // the active-view collector when nothing is selected.
        //
        // Graph shape
        //   Category node ──[InCategory]──► Type node ──[HasType]──► Instance node
        //                                                               ├─[OnLevel]──► Level
        //                                                               ├─[LocatedIn]──► Room (doors/windows)
        //                                                               └─[SubComponentOf]──► Host (hosted families)
        public static OnexusGraph BuildGenericElementGraph(Document doc, ICollection<ElementId> elementIds)
        {
            const int MaxInstances = 400;

            var graph    = NewGraph(doc);
            var nodeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var edgeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var referencedLevels = new HashSet<ElementId>();

            // Pre-build a set of all incoming ElementId values so we can detect
            // host→subcomponent relationships within the export set.
            var inputIdSet = new HashSet<long>();
            foreach (var eid in elementIds) inputIdSet.Add(eid.Value);

            int instanceCount = 0;
            bool truncated    = false;

            foreach (var eid in elementIds)
            {
                if (instanceCount >= MaxInstances) { truncated = true; break; }

                var el = doc.GetElement(eid);
                if (el == null) continue;
                if (el is ElementType) continue;       // skip type elements

                var cat = el.Category;
                if (cat == null) continue;             // skip elements with no user category

                instanceCount++;
                var catName   = cat.Name;
                var catNodeId = $"CAT-{cat.Id.Value}";

                // ── Category node ──────────────────────────────────────────────
                if (nodeSeen.Add(catNodeId))
                {
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id           = catNodeId,
                            nodeType     = "Category",
                            category     = catName,
                            label        = new Dictionary<string, string> { ["en"] = catName, ["jp"] = catName },
                            revitCategory = catName
                        }
                    });
                }

                // ── Type node ──────────────────────────────────────────────────
                string typeNodeId;
                string typeLabel;
                long   typeRevitId = 0;

                if (el is FamilyInstance fiType && fiType.Symbol != null)
                {
                    typeNodeId  = $"TYP-{fiType.Symbol.Id.Value}";
                    typeLabel   = $"{fiType.Symbol.FamilyName} : {fiType.Symbol.Name}";
                    typeRevitId = fiType.Symbol.Id.Value;
                }
                else
                {
                    var typeId = el.GetTypeId();
                    if (typeId != null && typeId != ElementId.InvalidElementId)
                    {
                        var elType = doc.GetElement(typeId);
                        typeNodeId  = $"TYP-{typeId.Value}";
                        typeLabel   = elType?.Name ?? catName;
                        typeRevitId = typeId.Value;
                    }
                    else
                    {
                        typeNodeId = $"TYP-NOTYPE-{cat.Id.Value}";
                        typeLabel  = catName;
                    }
                }

                if (nodeSeen.Add(typeNodeId))
                {
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id            = typeNodeId,
                            nodeType      = "FamilyType",
                            category      = catName,
                            label         = new Dictionary<string, string> { ["en"] = typeLabel, ["jp"] = typeLabel },
                            revitCategory = catName,
                            revitInstanceIds = typeRevitId > 0 ? new List<long> { typeRevitId } : null
                        }
                    });
                }

                // Type → Category
                AddEdge(graph, edgeSeen, "InCategory", "Metadata", typeNodeId, catNodeId, directional: true);

                // ── Instance node ──────────────────────────────────────────────
                var instId    = el.UniqueId;
                var instLabel = el is FamilyInstance fiLbl
                    ? MakeElementLabel(fiLbl)
                    : (el.Name ?? catName);
                var lvl = TryGetLevel(el, doc);
                if (lvl != null) referencedLevels.Add(lvl.Id);

                if (nodeSeen.Add(instId))
                {
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id               = instId,
                            nodeType         = "Element",
                            category         = catName,
                            label            = new Dictionary<string, string> { ["en"] = instLabel, ["jp"] = instLabel },
                            revitCategory    = catName,
                            level            = lvl?.Name,
                            revitInstanceIds = new List<long>   { el.Id.Value },
                            revitInstanceUids = new List<string> { el.UniqueId }
                        }
                    });
                }

                // Instance → Type, Instance → Level
                AddEdge(graph, edgeSeen, "HasType", "Metadata", instId, typeNodeId, directional: true);
                if (lvl != null)
                    AddEdge(graph, edgeSeen, "OnLevel", "Spatial", instId, lvl.UniqueId, directional: true);

                // ── Room connections (FamilyInstance only) ─────────────────────
                if (el is FamilyInstance fi)
                {
                    try
                    {
                        var isDoor   = cat.Id.Value == (long)BuiltInCategory.OST_Doors;
                        var isWindow = cat.Id.Value == (long)BuiltInCategory.OST_Windows;

                        if (isDoor || isWindow)
                        {
                            var fromRoom = fi.FromRoom;
                            var toRoom   = fi.ToRoom;
                            if (fromRoom != null && fromRoom.Area > 0)
                            {
                                EnsureRoomNode(graph, nodeSeen, fromRoom);
                                AddEdge(graph, edgeSeen, "LocatedIn", "Spatial", instId, fromRoom.UniqueId, directional: true);
                            }
                            if (toRoom != null && toRoom.Area > 0)
                            {
                                EnsureRoomNode(graph, nodeSeen, toRoom);
                                AddEdge(graph, edgeSeen, "LocatedIn", "Spatial", instId, toRoom.UniqueId, directional: true);
                            }
                        }
                        else
                        {
                            var room = fi.Room;
                            if (room != null && room.Area > 0)
                            {
                                EnsureRoomNode(graph, nodeSeen, room);
                                AddEdge(graph, edgeSeen, "LocatedIn", "Spatial", instId, room.UniqueId, directional: true);
                            }
                        }
                    }
                    catch { /* room lookup optional — safe-fail */ }

                    // ── SubComponentOf: host within the same export set ────────
                    try
                    {
                        var host = fi.Host;
                        if (host != null && inputIdSet.Contains(host.Id.Value))
                            AddEdge(graph, edgeSeen, "SubComponentOf", "System", instId, host.UniqueId, directional: true);
                    }
                    catch { }
                }
            }

            // ── Level nodes (only those referenced by instances) ───────────────
            var allLevels = new FilteredElementCollector(doc)
                .OfClass(typeof(Level))
                .Cast<Level>()
                .Where(l => referencedLevels.Contains(l.Id));

            foreach (var lvl in allLevels)
            {
                var lvlId = lvl.UniqueId;
                if (nodeSeen.Add(lvlId))
                {
                    var lbl = lvl.Name ?? "Level";
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id               = lvlId,
                            nodeType         = "Level",
                            category         = "Level",
                            label            = new Dictionary<string, string> { ["en"] = lbl, ["jp"] = lbl },
                            revitCategory    = "Levels",
                            level            = lbl,
                            revitInstanceIds = new List<long>   { lvl.Id.Value },
                            revitInstanceUids = new List<string> { lvl.UniqueId }
                        }
                    });
                }
            }

            if (truncated)
            {
                Autodesk.Revit.UI.TaskDialog.Show("ONEXUS – Explore Elements",
                    $"Only the first {MaxInstances} elements are shown.\n\n" +
                    "Tip: select a smaller set of elements, or open a less-populated view " +
                    "and run Explore Elements again.");
            }

            return graph;
        }

        // ── Ensures a Room node exists in the graph (helper for BuildGenericElementGraph) ─
        private static void EnsureRoomNode(OnexusGraph graph, HashSet<string> nodeSeen, Room room)
        {
            var roomId = room.UniqueId;
            if (!nodeSeen.Add(roomId)) return;

            graph.elements.nodes.Add(new OnexusNode
            {
                data = new NodeData
                {
                    id               = roomId,
                    nodeType         = "Space",
                    category         = "Room",
                    label            = new Dictionary<string, string>
                    {
                        ["en"] = MakeRoomLabel(room),
                        ["jp"] = MakeRoomLabel(room)
                    },
                    revitCategory    = "Rooms",
                    level            = room.Level?.Name,
                    revitInstanceIds = new List<long>   { room.Id.Value },
                    revitInstanceUids = new List<string> { room.UniqueId }
                }
            });
        }

        // Doors (type-level) + nested subcomponents (type-level) + System edges
        public static OnexusGraph BuildDoorTypeAndSubcomponentsGraph(Document doc, Func<FamilyInstance, bool> doorFilter = null)
        {
            var graph = NewGraph(doc);

            var nodesByKey = new Dictionary<string, OnexusNode>(StringComparer.OrdinalIgnoreCase);
            var edgeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // default door filter keeps family names starting with "_", matching the original command
            bool DefaultDoorFilter(FamilyInstance fi) =>
                fi.Symbol != null &&
                fi.Category?.Id.Value == (int)BuiltInCategory.OST_Doors &&
                fi.Symbol.FamilyName.StartsWith("_", StringComparison.Ordinal);

            var filter = doorFilter ?? DefaultDoorFilter;

            // Collect door instances (we'll dedupe by Symbol.Id for type-level nodes)
            var doors = new FilteredElementCollector(doc)
                .WhereElementIsNotElementType()
                .OfCategory(BuiltInCategory.OST_Doors)
                .Cast<FamilyInstance>()
                .Where(fi => fi.Symbol != null && filter(fi))
                .ToList();

            var processedDoorSymbols = new HashSet<ElementId>();
            foreach (var d in doors)
            {
                var symId = d.Symbol.Id;
                if (!processedDoorSymbols.Add(symId)) continue;

                var doorNode = EnsureTypeNodeForFamilyInstance(graph, nodesByKey, d, prefix: "DOOR", defaultCategory: "Door");

                // recurse subcomponents (type-level, but Revit exposes instance subcomponent graph;
                // we map each subcomponent instance's Symbol to a type-level node for ONEXUS)
                AddSubcomponentTree(doc, d, doorNode.data.id, graph, nodesByKey, edgeSeen);
            }

            return graph;
        }

        // Merge two graphs (keeps unique nodes/edges by id)
        public static OnexusGraph Merge(OnexusGraph a, OnexusGraph b)
        {
            var g = NewGraph();
            g.meta = a.meta ?? g.meta;

            var nodes = new Dictionary<string, OnexusNode>(StringComparer.OrdinalIgnoreCase);
            foreach (var n in a.elements.nodes) nodes[n.data.id] = n;
            foreach (var n in b.elements.nodes) nodes[n.data.id] = n;
            g.elements.nodes = nodes.Values.ToList();

            var edges = new Dictionary<string, OnexusEdge>(StringComparer.OrdinalIgnoreCase);
            foreach (var e in a.elements.edges) edges[e.data.id] = e;
            foreach (var e in b.elements.edges) edges[e.data.id] = e;
            g.elements.edges = edges.Values.ToList();

            return g;
        }

        // Save helper (with dialog)
        public static void SaveGraphWithDialog(OnexusGraph graph, string suggestedFileName)
        {
            using (var sfd = new SaveFileDialog())
            {
                sfd.Filter = "JSON Files (*.json)|*.json";
                sfd.FileName = MakeSafeFileName(suggestedFileName);
                if (sfd.ShowDialog() == DialogResult.OK)
                {
                    File.WriteAllText(sfd.FileName, JsonConvert.SerializeObject(graph, Formatting.Indented), new UTF8Encoding(false));
                }
            }
        }

        // --- Internal helpers --------------------------------------------------

        private static OnexusGraph NewGraph(Document doc = null) => new OnexusGraph
        {
            meta = new OnexusMeta
            {
                project = doc?.Title,
                languageDefault = "en",
                schema = "onexus-1.1",
                phases = new List<string>() // optional fill later
            }
        };

        private static OnexusNode EnsureTypeNodeForFamilyInstance(
            OnexusGraph graph,
            Dictionary<string, OnexusNode> nodesByKey,
            FamilyInstance fi,
            string prefix,
            string defaultCategory)
        {
            var symId = fi.Symbol.Id.Value;
            var key = $"{prefix}-{symId}";
            if (nodesByKey.TryGetValue(key, out var existing)) return existing;

            var cat = defaultCategory ?? (fi.Category?.Name ?? "Element");
            var node = new OnexusNode
            {
                data = new NodeData
                {
                    id = key,
                    nodeType = "Element",
                    category = cat,
                    label = new Dictionary<string, string>
                    {
                        ["en"] = $"{fi.Symbol.FamilyName}: {fi.Name}"
                    },
                    revitCategory = fi.Category?.Name,
                    familyName = fi.Symbol.FamilyName,
                    typeName = fi.Name
                }
            };

            nodesByKey[key] = node;
            graph.elements.nodes.Add(node);
            return node;
        }

        private static OnexusNode EnsureTypeNodeForSubcomponent(
            OnexusGraph graph,
            Dictionary<string, OnexusNode> nodesByKey,
            FamilyInstance sub)
        {
            var symId = sub.Symbol.Id.Value;
            var key = $"COMP-{symId}";
            if (nodesByKey.TryGetValue(key, out var existing)) return existing;

            var cat = sub.Category?.Name ?? "SubComponent";
            var node = new OnexusNode
            {
                data = new NodeData
                {
                    id = key,
                    nodeType = "Element",
                    category = cat,
                    label = new Dictionary<string, string>
                    {
                        ["en"] = $"{sub.Symbol.FamilyName}: {sub.Name}"
                    },
                    revitCategory = sub.Category?.Name,
                    familyName = sub.Symbol.FamilyName,
                    typeName = sub.Name
                }
            };

            nodesByKey[key] = node;
            graph.elements.nodes.Add(node);
            return node;
        }

        private static void AddSubcomponentTree(
            Document doc,
            FamilyInstance parentInstance,
            string parentNodeId,
            OnexusGraph graph,
            Dictionary<string, OnexusNode> nodesByKey,
            HashSet<string> edgeSeen)
        {
            var subIds = parentInstance.GetSubComponentIds();
            if (subIds == null || subIds.Count == 0) return;

            foreach (var subId in subIds)
            {
                var sub = doc.GetElement(subId) as FamilyInstance;
                if (sub == null || sub.Symbol == null) continue;

                var subNode = EnsureTypeNodeForSubcomponent(graph, nodesByKey, sub);

                // PartOfSystem (System dimension), undirected (set directional=false)
                AddEdge(graph, edgeSeen, "PartOfSystem", "System", subNode.data.id, parentNodeId, directional: false, confidence: "Explicit");

                // recurse
                AddSubcomponentTree(doc, sub, subNode.data.id, graph, nodesByKey, edgeSeen);
            }
        }

        private static void AddEdge(
            OnexusGraph graph,
            HashSet<string> edgeSeen,
            string type,
            string dimension,
            string source,
            string target,
            bool directional,
            string confidence = null)
        {
            // Stable ID by semantic tuple
            var id = $"E-{type}-{San(source)}-{San(target)}";
            var key = $"{type}|{dimension}|{source}|{target}";

            if (edgeSeen.Add(key))
            {
                graph.elements.edges.Add(new OnexusEdge
                {
                    data = new EdgeData
                    {
                        id = id,
                        type = type,
                        dimension = dimension,
                        directional = directional,
                        source = source,
                        target = target,
                        confidence = confidence
                    }
                });
            }
        }

        private static string MakeRoomLabel(Room room)
        {
            var num = room.Number;
            var name = room.Name;
            if (!string.IsNullOrWhiteSpace(num) && !string.IsNullOrWhiteSpace(name))
                return $"{num} {name}";
            return name ?? num ?? "Room";
        }

        private static string MakeElementLabel(FamilyInstance fi)
        {
            var fam = fi.Symbol?.FamilyName;
            var typ = fi.Symbol?.Name ?? fi.Name;
            if (!string.IsNullOrWhiteSpace(fam) && !string.IsNullOrWhiteSpace(typ))
                return $"{fam} : {typ}";
            return fam ?? typ ?? (fi.Name ?? "Element");
        }

        private static Level TryGetLevel(Element e, Document doc)
        {
            if (e.LevelId != ElementId.InvalidElementId)
                return doc.GetElement(e.LevelId) as Level;

            var p = e.get_Parameter(BuiltInParameter.LEVEL_PARAM);
            if (p != null && p.StorageType == StorageType.ElementId)
            {
                var id = p.AsElementId();
                if (id != ElementId.InvalidElementId)
                    return doc.GetElement(id) as Level;
            }
            return null;
        }

        private static string San(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var sb = new StringBuilder(s.Length);
            foreach (var ch in s)
                sb.Append(char.IsLetterOrDigit(ch) ? ch : '-');
            return sb.ToString();
        }

        private static string MakeSafeFileName(string s)
        {
            foreach (var c in Path.GetInvalidFileNameChars())
                s = s.Replace(c, '_');
            return s;
        }

        public static OnexusGraph BuildParameterBindingGraph(
            Document doc,
            bool linkTypes = true,
            int maxTypesPerCategory = 60)
        {
            var graph = NewGraph(doc);
            var nodeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var edgeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // Project node (for DeclaredIn edges)
            var prjId = $"PRJ-{San(doc.Title)}";
            if (nodeSeen.Add(prjId))
            {
                graph.elements.nodes.Add(new OnexusNode
                {
                    data = new NodeData
                    {
                        id = prjId,
                        nodeType = "Project",
                        category = "Project",
                        label = new Dictionary<string, string> { ["en"] = doc.Title, ["jp"] = doc.Title }
                    }
                });
            }

            // Caches
            var catCache = new Dictionary<int, string>();              // Category.Id -> nodeId
            var typeCache = new Dictionary<string, OnexusNode>();      // "TYPE-<id>" -> node

            // Iterate ParameterBindings (Project & Shared)
            var map = doc.ParameterBindings;
            var it = map.ForwardIterator();
            it.Reset();

            while (it.MoveNext())
            {
                var def = it.Key as Definition;
                var bind = it.Current as Autodesk.Revit.DB.Binding;
                var ebind = it.Current as ElementBinding; // cast for Categories
                if (def == null || bind == null || ebind == null) continue;

                var defName = def.Name ?? "(unnamed)";
                var pNodeId = $"PAR-{San(defName)}";
                // Parameter node
                if (nodeSeen.Add(pNodeId))
                {
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id = pNodeId,
                            nodeType = "Parameter",
                            category = "Parameter",
                            label = new Dictionary<string, string> { ["en"] = defName, ["jp"] = defName }
                        }
                    });
                }

                // DeclaredIn -> Project
                AddEdge(graph, edgeSeen, "DeclaredIn", "Metadata", pNodeId, prjId, directional: true, confidence: "Explicit");

                // Group node + InGroup edge
                string grpName = "Other";

                var gtid = def.GetGroupTypeId(); // ForgeTypeId
                if (gtid != null) grpName = LabelUtils.GetLabelForGroup(gtid);

                var grpId = $"PG-{San(grpName)}";
                if (nodeSeen.Add(grpId))
                {
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id = grpId,
                            nodeType = "ParameterGroup",
                            category = "ParameterGroup",
                            label = new Dictionary<string, string> { ["en"] = grpName, ["jp"] = grpName }
                        }
                    });
                }
                AddEdge(graph, edgeSeen, "InGroup", "Metadata", pNodeId, grpId, directional: true, confidence: "Explicit");

                // Categories bound to this parameter
                var catset = ebind.Categories;
                if (catset == null) continue;

                foreach (Category cat in catset)
                {
                    if (cat == null || !cat.AllowsBoundParameters) continue;

                    var catNodeId = EnsureCategoryNode(graph, nodeSeen, catCache, cat);
                    // Parameter -> Category
                    AddEdge(graph, edgeSeen, "BindsToCategory", "Metadata", pNodeId, catNodeId, directional: true, confidence: "Explicit");

                    if (!linkTypes) continue;

                    // Collect a bounded set of ElementTypes under this category
                    try
                    {
                        var bic = (BuiltInCategory)cat.Id.Value;
                        var types = new FilteredElementCollector(doc)
                            .OfCategory(bic)
                            .WhereElementIsElementType()
                            .Take(maxTypesPerCategory)
                            .Cast<ElementType>()
                            .ToList();

                        foreach (var t in types)
                        {
                            var tNode = EnsureTypeNodeForElementType(graph, typeCache, t, cat.Name);
                            // Category -> Type
                            AddEdge(graph, edgeSeen, "HasType", "Metadata", catNodeId, tNode.data.id, directional: true);

                            // Only add Parameter -> Type if the type actually exposes the parameter
                            var hasParam = t.LookupParameter(defName);
                            if (hasParam != null)
                            {
                                AddEdge(graph, edgeSeen, "BindsToType", "Metadata", pNodeId, tNode.data.id, directional: true);
                            }
                        }
                    }
                    catch
                    {
                        // some categories may not map cleanly to BuiltInCategory; skip gracefully
                    }
                }
            }

            return graph;
        }

        // Ensure Category node (CAT-<int>)
        private static string EnsureCategoryNode(
            OnexusGraph graph,
            HashSet<string> nodeSeen,
            Dictionary<int, string> cache,
            Category cat)
        {
            var key = (Int32)cat.Id.Value;
            if (cache.TryGetValue(key, out var nodeId)) return nodeId;

            nodeId = $"CAT-{key}";
            if (nodeSeen.Add(nodeId))
            {
                var name = cat.Name ?? "Category";
                graph.elements.nodes.Add(new OnexusNode
                {
                    data = new NodeData
                    {
                        id = nodeId,
                        nodeType = "Category",
                        category = "Category",
                        label = new Dictionary<string, string> { ["en"] = name, ["jp"] = name },
                        revitCategory = name
                    }
                });
            }
            cache[key] = nodeId;
            return nodeId;
        }

        // Ensure Type node for ElementType (TYPE-<int>)
        private static OnexusNode EnsureTypeNodeForElementType(
            OnexusGraph graph,
            Dictionary<string, OnexusNode> typeCache,
            ElementType t,
            string catName)
        {
            var key = "TYPE-" + t.Id.Value.ToString();
            OnexusNode existing;
            if (typeCache.TryGetValue(key, out existing)) return existing;

            string fam = null;
            var fs = t as FamilySymbol;
            if (fs != null) fam = fs.FamilyName; // works for most component categories

            var disp = (!string.IsNullOrEmpty(fam)) ? (fam + " : " + t.Name) : t.Name;

            var node = new OnexusNode
            {
                data = new NodeData
                {
                    id = key,
                    nodeType = "FamilyType",
                    category = "FamilyType",
                    label = new Dictionary<string, string> { ["en"] = disp, ["jp"] = disp },
                    revitCategory = catName,
                    familyName = fam,
                    typeName = t.Name
                }
            };
            typeCache[key] = node;
            graph.elements.nodes.Add(node);
            return node;
        }

        // =======================
        // Scoped Parameter Graph Builder
        // =======================
        public class ParamExportOptions
        {
            public bool OnlyAffectingSelection { get; set; } = true;
            public ISet<BuiltInCategory> CategoryWhitelist { get; set; } = null; // null => all
            public string IncludeNameRegex { get; set; } = null;  // e.g. "^(Fire|Door|Hardware)"
            public string ExcludeNameRegex { get; set; } = null;  // e.g. "^(IFC|AEC|_)"
            public int MaxTypesPerCategory { get; set; } = 50;
            public int MaxParameters { get; set; } = 1000;        // hard cap for safety
        }

        public static OnexusGraph BuildParameterBindingGraphScoped(
            Document doc,
            ICollection<ElementId> currentSelection,
            ParamExportOptions opt = null)
        {
            if (opt == null) opt = new ParamExportOptions(); // C# 7.3 safe

            if (doc.IsFamilyDocument)
                return BuildFamilyEditorParameterGraph(doc, opt);

            var selectedEls = (currentSelection != null && currentSelection.Count > 0)
                ? currentSelection.Select(id => doc.GetElement(id)).Where(e => e != null).ToList()
                : new List<Element>();

            // Build set of selected category ids (no LINQ ToHashSet for max compatibility)
            HashSet<int> catIdsFromSelection = null;
            HashSet<string> typeParamPresence = null;

            if (opt.OnlyAffectingSelection && selectedEls.Count > 0)
            {
                catIdsFromSelection = new HashSet<int>();
                foreach (var e in selectedEls)
                    if (e.Category != null) catIdsFromSelection.Add((Int32)e.Category.Id.Value);

                // Presence set: "<TypeId>::<ParamName>"
                typeParamPresence = new HashSet<string>(StringComparer.Ordinal);
                var typeIds = selectedEls
                    .Select(e => (e is FamilyInstance fi) ? fi.Symbol != null ? fi.Symbol.Id : ElementId.InvalidElementId : e.GetTypeId())
                    .Where(id => id != null && id != ElementId.InvalidElementId)
                    .Distinct()
                    .ToList();

                foreach (var tid in typeIds)
                {
                    var typ = doc.GetElement(tid) as ElementType;
                    if (typ == null) continue;
                    foreach (Parameter p in typ.Parameters)
                    {
                        if (p == null) continue;
                        var name = p.Definition != null ? p.Definition.Name : null;
                        if (!string.IsNullOrEmpty(name))
                            typeParamPresence.Add(tid.Value.ToString() + "::" + name);
                    }
                }
            }

            // Regex filters
            System.Text.RegularExpressions.Regex reInclude = null, reExclude = null;
            if (!string.IsNullOrWhiteSpace(opt.IncludeNameRegex))
                reInclude = new System.Text.RegularExpressions.Regex(opt.IncludeNameRegex, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (!string.IsNullOrWhiteSpace(opt.ExcludeNameRegex))
                reExclude = new System.Text.RegularExpressions.Regex(opt.ExcludeNameRegex, System.Text.RegularExpressions.RegexOptions.IgnoreCase);

            // We now iterate ParameterBindings exactly like the full builder but apply filters before adding
            var graph = NewGraph(doc);
            var nodeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var edgeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // Project node
            var prjId = $"PRJ-{San(doc.Title)}";
            if (nodeSeen.Add(prjId))
            {
                graph.elements.nodes.Add(new OnexusNode
                {
                    data = new NodeData
                    {
                        id = prjId,
                        nodeType = "Project",
                        category = "Project",
                        label = new Dictionary<string, string> { ["en"] = doc.Title, ["jp"] = doc.Title }
                    }
                });
            }

            // Category/type caches
            var catCache = new Dictionary<int, string>();
            var typeCache = new Dictionary<string, OnexusNode>();

            // Iterate map
            var map = doc.ParameterBindings;
            var it = map.ForwardIterator();
            it.Reset();

            int addedParams = 0;

            while (it.MoveNext())
            {
                var def = it.Key as Definition;
                var bind = it.Current as Autodesk.Revit.DB.Binding;
                var ebind = it.Current as ElementBinding; // Revit 2024+: Categories on ElementBinding
                if (def == null || bind == null || ebind == null) continue;

                var defName = def.Name ?? "(unnamed)";
                // Name regex filters
                if (reInclude != null && !reInclude.IsMatch(defName)) continue;
                if (reExclude != null && reExclude.IsMatch(defName)) continue;

                // Category‐scope filter
                var catset = ebind.Categories;
                if (catset == null) continue;

                // If OnlyAffectingSelection: skip parameters that don't bind to selected categories
                if (opt.OnlyAffectingSelection && catIdsFromSelection != null)
                {
                    bool touches = false;
                    foreach (Category c in catset)
                    {
                        if (c == null) continue;
                        if (catIdsFromSelection.Contains((Int32)c.Id.Value)) { touches = true; break; }
                    }
                    if (!touches) continue;
                }

                // If CategoryWhitelist set, enforce it
                if (opt.CategoryWhitelist != null && opt.CategoryWhitelist.Count > 0)
                {
                    bool ok = false;
                    foreach (Category c in catset)
                    {
                        if (c == null) continue;
                        try
                        {
                            var bic = (BuiltInCategory)(Int32)c.Id.Value;
                            if (opt.CategoryWhitelist.Contains(bic)) { ok = true; break; }
                        }
                        catch { /* skip */ }
                    }
                    if (!ok) continue;
                }

                // If selection-aware + type presence filtering is enabled, ensure at least one selected type has this parameter
                if (opt.OnlyAffectingSelection && typeParamPresence != null && selectedEls.Count > 0)
                {
                    bool presentOnAnySelectedType = false;
                    foreach (var el in selectedEls)
                    {
                        ElementId tid = (el is FamilyInstance fi) ? fi.Symbol?.Id : el.GetTypeId();
                        if (tid == null || tid == ElementId.InvalidElementId) continue;
                        if (typeParamPresence.Contains($"{tid.Value}::{defName}"))
                        {
                            presentOnAnySelectedType = true; break;
                        }
                    }
                    if (!presentOnAnySelectedType) continue;
                }

                // Hard cap
                if (addedParams >= opt.MaxParameters) break;

                // --- Emit nodes/edges (same as unscoped builder, but limited types per category) ---
                var pNodeId = $"PAR-{San(defName)}";
                if (nodeSeen.Add(pNodeId))
                {
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id = pNodeId,
                            nodeType = "Parameter",
                            category = "Parameter",
                            label = new Dictionary<string, string> { ["en"] = defName, ["jp"] = defName }
                        }
                    });
                }

                // DeclaredIn
                AddEdge(graph, edgeSeen, "DeclaredIn", "Metadata", pNodeId, prjId, true, "Explicit");

                // Group label (2024+ API safe)
                string grpName = "Other";
                // Preferred (2024+)
                var gtid = def.GetGroupTypeId();
                grpName = (gtid != null) ? LabelUtils.GetLabelForGroup(gtid) : "Other";

                var grpId = $"PG-{San(grpName)}";
                if (nodeSeen.Add(grpId))
                {
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id = grpId,
                            nodeType = "ParameterGroup",
                            category = "ParameterGroup",
                            label = new Dictionary<string, string> { ["en"] = grpName, ["jp"] = grpName }
                        }
                    });
                }
                AddEdge(graph, edgeSeen, "InGroup", "Metadata", pNodeId, grpId, true, "Explicit");

                // Categories & limited types
                foreach (Category cat in catset)
                {
                    if (cat == null || !cat.AllowsBoundParameters) continue;

                    // Category node
                    var catNodeId = EnsureCategoryNode(graph, nodeSeen, catCache, cat);
                    AddEdge(graph, edgeSeen, "BindsToCategory", "Metadata", pNodeId, catNodeId, true, "Explicit");

                    // Short-circuit if we only need high-level mapping
                    if (opt.MaxTypesPerCategory <= 0) continue;

                    // Types (bounded)
                    try
                    {
                        var bic = (BuiltInCategory)(Int32)cat.Id.Value;
                        var types = new FilteredElementCollector(doc)
                            .OfCategory(bic)
                            .WhereElementIsElementType()
                            .Take(opt.MaxTypesPerCategory)
                            .Cast<ElementType>()
                            .ToList();

                        foreach (var t in types)
                        {
                            var tNode = EnsureTypeNodeForElementType(graph, typeCache, t, cat.Name);

                            // Category -> Type
                            AddEdge(graph, edgeSeen, "HasType", "Metadata", catNodeId, tNode.data.id, true);

                            // If selection-scoped and we had type presence, add BindsToType only when present on selected types
                            bool ok;
                            if (opt.OnlyAffectingSelection && typeParamPresence != null && selectedEls.Count > 0)
                            {
                                ok = typeParamPresence.Contains(t.Id.Value.ToString() + "::" + defName);
                            }
                            else
                            {
                                ok = (t.LookupParameter(defName) != null);
                            }

                            if (ok)
                                AddEdge(graph, edgeSeen, "BindsToType", "Metadata", pNodeId, tNode.data.id, true);
                        }
                    }
                    catch { /* ignore cats without valid BuiltInCategory */ }
                }

                addedParams++;
            }

            return graph;
        }

        // Family Editor: export only Family Parameters & Types
        private static OnexusGraph BuildFamilyEditorParameterGraph(Document doc, ParamExportOptions opt)
        {
            if (opt == null) opt = new ParamExportOptions(); // C# 7.3 safe

            var graph = NewGraph(doc);
            var nodeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var edgeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // Project/Family root
            var famTitle = doc.Title;
            var prjId = $"PRJ-{San(famTitle)}";
            if (nodeSeen.Add(prjId))
            {
                graph.elements.nodes.Add(new OnexusNode
                {
                    data = new NodeData
                    {
                        id = prjId,
                        nodeType = "Project",
                        category = "Project",
                        label = new Dictionary<string, string> { ["en"] = famTitle, ["jp"] = famTitle }
                    }
                });
            }

            var fm = doc.FamilyManager;
            if (fm == null) return graph;

            string familyName = (doc.OwnerFamily != null ? doc.OwnerFamily.Name : "(Family)");

            // Family Types (FamilyType in family editor does NOT expose an Id reliably across versions)
            var typeCache = new Dictionary<string, OnexusNode>();
            foreach (FamilyType ft in fm.Types)
            {
                // Revit enforces unique type names within a family; key on name
                var typeKey = $"FT-{San(ft.Name)}";
                if (!typeCache.ContainsKey(typeKey))
                {
                    var node = new OnexusNode
                    {
                        data = new NodeData
                        {
                            id = typeKey,
                            nodeType = "FamilyType",
                            category = "FamilyType",
                            label = new Dictionary<string, string> { ["en"] = ft.Name, ["jp"] = ft.Name },
                            familyName = familyName,
                            typeName = ft.Name
                        }
                    };
                    typeCache[typeKey] = node;
                    graph.elements.nodes.Add(node);
                }
            }

            // Regex filters (optional)
            System.Text.RegularExpressions.Regex reInc = null, reExc = null;
            if (!string.IsNullOrWhiteSpace(opt.IncludeNameRegex))
                reInc = new System.Text.RegularExpressions.Regex(opt.IncludeNameRegex, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (!string.IsNullOrWhiteSpace(opt.ExcludeNameRegex))
                reExc = new System.Text.RegularExpressions.Regex(opt.ExcludeNameRegex, System.Text.RegularExpressions.RegexOptions.IgnoreCase);

            int added = 0;

            foreach (FamilyParameter fp in fm.GetParameters())
            {
                var def = fp.Definition;
                var pname = (def != null && !string.IsNullOrEmpty(def.Name)) ? def.Name : "(param)";
                if (reInc != null && !reInc.IsMatch(pname)) continue;
                if (reExc != null && reExc.IsMatch(pname)) continue;
                if (added >= opt.MaxParameters) break;

                var pid = $"PAR-{San(pname)}";
                if (nodeSeen.Add(pid))
                {
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id = pid,
                            nodeType = "Parameter",
                            category = "Parameter",
                            label = new Dictionary<string, string> { ["en"] = pname, ["jp"] = pname }
                        }
                    });
                }

                // DeclaredIn
                AddEdge(graph, edgeSeen, "DeclaredIn", "Metadata", pid, prjId, true, "Explicit");

                // ParameterGroup (2024+ safe)
                string grpName = "Other";
                // Preferred (2024+)
                var gtid = def.GetGroupTypeId();
                grpName = (gtid != null) ? LabelUtils.GetLabelForGroup(gtid) : "Other";

                var gid = $"PG-{San(grpName)}";
                if (nodeSeen.Add(gid))
                {
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id = gid,
                            nodeType = "ParameterGroup",
                            category = "ParameterGroup",
                            label = new Dictionary<string, string> { ["en"] = grpName, ["jp"] = grpName }
                        }
                    });
                }
                AddEdge(graph, edgeSeen, "InGroup", "Metadata", pid, gid, true, "Explicit");

                // Link to all family types for navigation in ONEXUS
                foreach (var kv in typeCache)
                    AddEdge(graph, edgeSeen, "BindsToType", "Metadata", pid, kv.Key, true);

                added++;
            }

            return graph;
        }

        // =======================
        // Master Key (selection-based) — options
        // =======================
        public class MasterKeyOptions
        {
            public bool InferDeviceLinks { get; set; } = true; // default ON
            public double ProximityMM { get; set; } = 500.0;   // 500 mm
            public bool IncludeVendors { get; set; } = true;
            public bool IncludeRooms { get; set; } = true;
        }

        // =======================
        // Master Key (selection-based) — builder
        // =======================
        public static OnexusGraph BuildMasterKeySelectionGraph(
            Document doc,
            ElementId activeViewId,
            ICollection<ElementId> selection,
            MasterKeyOptions opt)
        {
            if (opt == null) opt = new MasterKeyOptions();

            var graph = NewGraph(doc);
            var nodeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var edgeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // --- unit helper ---
            double FeetFromMM(double mm) { return mm / 304.8; }
            var proxFeet = FeetFromMM(opt.ProximityMM);

            // --- param helpers (instance string lookup by possible names) ---
            string ReadParamString(Element e, params string[] names)
            {
                foreach (var n in names)
                {
                    var p = e.LookupParameter(n);
                    if (p != null && p.StorageType == StorageType.String)
                    {
                        var v = p.AsString();
                        if (!string.IsNullOrWhiteSpace(v)) return v.Trim();
                    }
                }
                return null;
            }

            // --- small geom helpers ---
            XYZ CenterOfBBox(BoundingBoxXYZ bb)
            {
                if (bb == null) return null;
                return (bb.Min + bb.Max) * 0.5;
            }
            XYZ ElementPoint(Element e, View vForViewBBox)
            {
                try
                {
                    var lp = e.Location as LocationPoint;
                    if (lp != null) return lp.Point;

                    var lc = e.Location as LocationCurve;
                    if (lc != null) return lc.Curve.Evaluate(0.5, true);

                    // doors: model bbox; detail items: view bbox
                    var bb = (vForViewBBox != null) ? e.get_BoundingBox(vForViewBBox) : e.get_BoundingBox(null);
                    var c = CenterOfBBox(bb);
                    if (c != null) return c;
                }
                catch { }
                return XYZ.Zero;
            }
            double Dist(XYZ a, XYZ b) => (a - b).GetLength();

            // --- caches ---
            var vendorNodes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase); // vendorName -> nodeId
            var keyNodes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase); // keyStr -> nodeId

            // --- Door selection (instances only) ---
            var doors = selection
                .Select(id => doc.GetElement(id))
                .OfType<FamilyInstance>()
                .Where(fi => fi.Category != null && fi.Category.Id.Value == (int)BuiltInCategory.OST_Doors)
                .ToList();

            if (doors.Count == 0) return graph;

            // --- collect devices (Detail Items / Ditem_認証機) in active view only ---
            var devices = new List<FamilyInstance>();
            if (activeViewId != ElementId.InvalidElementId)
            {
                var viewFilter = new FilteredElementCollector(doc, activeViewId)
                    .OfCategory(BuiltInCategory.OST_DetailComponents)
                    .WhereElementIsNotElementType()
                    .OfClass(typeof(FamilyInstance))
                    .Cast<FamilyInstance>()
                    .Where(fi => fi.Symbol != null && string.Equals(fi.Symbol.FamilyName, "Ditem_認証機", StringComparison.OrdinalIgnoreCase))
                    .ToList();
                devices.AddRange(viewFilter);
            }
            else
            {
                // fallback: all views
                var all = new FilteredElementCollector(doc)
                    .OfCategory(BuiltInCategory.OST_DetailComponents)
                    .WhereElementIsNotElementType()
                    .OfClass(typeof(FamilyInstance))
                    .Cast<FamilyInstance>()
                    .Where(fi => fi.Symbol != null && string.Equals(fi.Symbol.FamilyName, "Ditem_認証機", StringComparison.OrdinalIgnoreCase))
                    .ToList();
                devices.AddRange(all);
            }

            var viewObj = (activeViewId != ElementId.InvalidElementId) ? doc.GetElement(activeViewId) as View : null;

            // --- build nodes: doors
            foreach (var d in doors)
            {
                var id = d.UniqueId;
                if (nodeSeen.Add(id))
                {
                    var mark = ReadParamString(d, "Mark", "番号", "Door Number");
                    var doorTypeTag = d.Symbol != null ? d.Symbol.Name : d.Name;
                    var keyNumber = ReadParamString(d, "鍵番号", "KeyNumber", "Key No", "KEY_NO");
                    var pull = ReadParamString(d, "鋼前_引き側", "PullSide", "引き");
                    var push = ReadParamString(d, "鋼前_押し側", "PushSide", "押し");
                    var zone = ReadParamString(d, "区画", "Zone");
                    var vendor = ReadParamString(d, "製作会社", "Manufacturer");

                    var label = (mark != null ? mark + " " : "") + (doorTypeTag ?? "Door");
                    var lvl = TryGetLevel(d, doc)?.Name;

                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id = id,
                            nodeType = "Door",
                            category = "SecurityDoor",
                            label = new Dictionary<string, string> { ["en"] = label, ["jp"] = label },
                            revitCategory = "Doors",
                            level = lvl,
                            familyName = d.Symbol != null ? d.Symbol.FamilyName : null,
                            typeName = d.Symbol != null ? d.Symbol.Name : d.Name,
                            revitInstanceIds = new List<long> { d.Id.Value },
                            revitInstanceUids = new List<string> { d.UniqueId }
                        }
                    });

                    // KeyNumber node + edge
                    if (!string.IsNullOrWhiteSpace(keyNumber))
                    {
                        string keyId;
                        if (!keyNodes.TryGetValue(keyNumber, out keyId))
                        {
                            keyId = "KEY-" + San(keyNumber);
                            keyNodes[keyNumber] = keyId;
                            graph.elements.nodes.Add(new OnexusNode
                            {
                                data = new NodeData
                                {
                                    id = keyId,
                                    nodeType = "KeyNumber",
                                    category = "KeyNumber",
                                    label = new Dictionary<string, string> { ["en"] = keyNumber, ["jp"] = keyNumber }
                                }
                            });
                            nodeSeen.Add(keyId);
                        }
                        AddEdge(graph, edgeSeen, "KeyedBy", "Security", id, keyId, true, "Explicit");
                    }

                    // Vendor node + edge
                    if (opt.IncludeVendors && !string.IsNullOrWhiteSpace(vendor))
                    {
                        string vId;
                        if (!vendorNodes.TryGetValue(vendor, out vId))
                        {
                            vId = "VENDOR-" + San(vendor);
                            vendorNodes[vendor] = vId;
                            graph.elements.nodes.Add(new OnexusNode
                            {
                                data = new NodeData
                                {
                                    id = vId,
                                    nodeType = "Vendor",
                                    category = "SecurityVendor",
                                    label = new Dictionary<string, string> { ["en"] = vendor, ["jp"] = vendor }
                                }
                            });
                            nodeSeen.Add(vId);
                        }
                        AddEdge(graph, edgeSeen, "ProvidedBy", "Vendor", id, vId, true, "Explicit");
                    }

                    // Rooms (both sides if present)
                    if (opt.IncludeRooms)
                    {
                        var fr = d.FromRoom;
                        var tr = d.ToRoom;
                        if (fr != null && fr.Area > 0)
                        {
                            var rid = fr.UniqueId;
                            if (nodeSeen.Add(rid))
                            {
                                var rlabel = MakeRoomLabel(fr);
                                graph.elements.nodes.Add(new OnexusNode
                                {
                                    data = new NodeData
                                    {
                                        id = rid,
                                        nodeType = "Space",
                                        category = "Room",
                                        label = new Dictionary<string, string> { ["en"] = rlabel, ["jp"] = rlabel },
                                        revitCategory = "Rooms",
                                        level = fr.Level != null ? fr.Level.Name : null
                                    }
                                });
                            }
                            AddEdge(graph, edgeSeen, "LocatedIn", "Spatial", id, rid, true, "Explicit");
                        }
                        if (tr != null && tr.Area > 0)
                        {
                            var rid = tr.UniqueId;
                            if (nodeSeen.Add(rid))
                            {
                                var rlabel = MakeRoomLabel(tr);
                                graph.elements.nodes.Add(new OnexusNode
                                {
                                    data = new NodeData
                                    {
                                        id = rid,
                                        nodeType = "Space",
                                        category = "Room",
                                        label = new Dictionary<string, string> { ["en"] = rlabel, ["jp"] = rlabel },
                                        revitCategory = "Rooms",
                                        level = tr.Level != null ? tr.Level.Name : null
                                    }
                                });
                            }
                            AddEdge(graph, edgeSeen, "LocatedIn", "Spatial", id, rid, true, "Explicit");
                        }
                    }
                }
            }

            // --- device nodes + inferred Controls edges
            foreach (var dev in devices)
            {
                var did = dev.UniqueId;
                if (nodeSeen.Add(did))
                {
                    var dlabel = "認証機";
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id = did,
                            nodeType = "AccessDevice",
                            category = "FaceRecognition",
                            label = new Dictionary<string, string> { ["en"] = dlabel, ["jp"] = dlabel },
                            revitCategory = "Detail Items",
                            familyName = dev.Symbol != null ? dev.Symbol.FamilyName : null,
                            typeName = dev.Symbol != null ? dev.Symbol.Name : dev.Name,
                            revitInstanceIds = new List<long> { dev.Id.Value },
                            revitInstanceUids = new List<string> { dev.UniqueId }
                        }
                    });
                }

                if (opt.InferDeviceLinks)
                {
                    var dv = ElementPoint(dev, viewObj);
                    FamilyInstance nearest = null;
                    double best = double.MaxValue;

                    foreach (var door in doors)
                    {
                        var dp = ElementPoint(door, null);
                        var dist = Dist(dv, dp);
                        if (dist < best)
                        {
                            best = dist;
                            nearest = door;
                        }
                    }

                    if (nearest != null && best <= proxFeet)
                    {
                        AddEdge(graph, edgeSeen, "Controls", "Security", did, nearest.UniqueId, true, "Inferred");
                    }
                    // else: exported as unlinked device (visible data gap)
                }
            }

            return graph;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  MEP Systems graph
        //
        //  Exports every MEPSystem (Mechanical / Electrical / Piping) in the
        //  document as a system node, then connects:
        //    • BaseEquipment  →  SuppliedBy  →  System  (AHU serves Supply Air)
        //    • Terminal/Fixture →  ConnectedTo →  System  (diffuser on supply)
        //
        //  Distribution elements (ducts, pipes, cable trays) are intentionally
        //  skipped — they produce enormous graphs without adding analytical value
        //  at the system level.
        // ══════════════════════════════════════════════════════════════════════
        public static OnexusGraph BuildMEPSystemsGraph(Document doc)
        {
            var graph    = NewGraph(doc);
            var nodeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var edgeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            var systems = new FilteredElementCollector(doc)
                .OfClass(typeof(MEPSystem))
                .Cast<MEPSystem>()
                .ToList();

            foreach (var sys in systems)
            {
                var sysNodeType = GetMEPSystemNodeType(sys);
                if (sysNodeType == null) continue;                // skip unrecognised subtypes

                var sysUid   = sys.UniqueId;
                var sysLabel = !string.IsNullOrWhiteSpace(sys.Name) ? sys.Name : sysNodeType;

                // ── System node ──────────────────────────────────────────────
                if (nodeSeen.Add(sysUid))
                {
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id                = sysUid,
                            nodeType          = sysNodeType,
                            category          = sysNodeType,
                            label             = MakeBilingualLabel(sysLabel),
                            revitCategory     = "MEP Systems",
                            revitInstanceIds  = new List<long>   { sys.Id.Value },
                            revitInstanceUids = new List<string> { sys.UniqueId }
                        }
                    });
                }

                // ── Base equipment (AHU, panel, pump…) ───────────────────────
                try
                {
                    var equip = sys.BaseEquipment;
                    if (equip != null)
                    {
                        EnsureMEPElementNode(graph, nodeSeen, equip);
                        // Equipment ← SuppliedBy ← System (equipment supplies the system)
                        AddEdge(graph, edgeSeen, "SuppliedBy", "MEP",
                                sysUid, equip.UniqueId, directional: true, confidence: "Explicit");
                    }
                }
                catch { /* some system types don't expose BaseEquipment */ }

                // ── Terminals and fixtures connected to this system ──────────
                try
                {
                    var baseEquipId = sys.BaseEquipment?.Id ?? ElementId.InvalidElementId;

                    foreach (Element el in sys.Elements)
                    {
                        if (el == null) continue;
                        if (el.Id == baseEquipId) continue;           // already handled above
                        if (!IsMEPLeafElement(el)) continue;          // skip ducts, pipes, etc.

                        EnsureMEPElementNode(graph, nodeSeen, el);
                        // Leaf element → ConnectedTo → System
                        AddEdge(graph, edgeSeen, "ConnectedTo", "MEP",
                                el.UniqueId, sysUid, directional: true, confidence: "Explicit");
                    }
                }
                catch { /* ElementSet iteration can fail on corrupt systems */ }
            }

            return graph;
        }

        // ── MEP helpers ───────────────────────────────────────────────────────

        /// <summary>Maps an MEPSystem subclass to an Onexus nodeType string.</summary>
        private static string GetMEPSystemNodeType(MEPSystem sys)
        {
            if (sys is MechanicalSystem) return "MechanicalSystem";
            if (sys is ElectricalSystem) return "ElectricalSystem";
            if (sys is PipingSystem)     return "PipingSystem";
            return null;
        }

        /// <summary>
        /// Returns true for equipment, terminals, fixtures and devices that are
        /// worth showing as individual nodes.  Returns false for distribution
        /// elements (ducts, pipes, conduits, cable trays) which would balloon
        /// the graph without adding system-level insight.
        /// </summary>
        private static bool IsMEPLeafElement(Element el)
        {
            if (el.Category == null) return false;
            try
            {
                var bic = (BuiltInCategory)(int)el.Category.Id.Value;
                switch (bic)
                {
                    case BuiltInCategory.OST_MechanicalEquipment:
                    case BuiltInCategory.OST_ElectricalEquipment:
                    case BuiltInCategory.OST_ElectricalFixtures:
                    case BuiltInCategory.OST_PlumbingFixtures:
                    case BuiltInCategory.OST_DuctTerminal:       // air terminals / diffusers
                    case BuiltInCategory.OST_Sprinklers:
                    case BuiltInCategory.OST_LightingFixtures:
                    case BuiltInCategory.OST_LightingDevices:
                    case BuiltInCategory.OST_FireAlarmDevices:
                    case BuiltInCategory.OST_DataDevices:
                    case BuiltInCategory.OST_CommunicationDevices:
                        return true;
                    default:
                        return false;
                }
            }
            catch { return false; }
        }

        /// <summary>Maps an element's category to an Onexus nodeType string.</summary>
        private static string GetMEPElementNodeType(Element el)
        {
            if (el.Category == null) return "MepElement";
            try
            {
                var bic = (BuiltInCategory)(int)el.Category.Id.Value;
                switch (bic)
                {
                    case BuiltInCategory.OST_MechanicalEquipment:
                    case BuiltInCategory.OST_ElectricalEquipment:
                        return "MepEquipment";
                    case BuiltInCategory.OST_DuctTerminal:
                        return "MepTerminal";
                    case BuiltInCategory.OST_PlumbingFixtures:
                    case BuiltInCategory.OST_Sprinklers:
                        return "MepFixture";
                    case BuiltInCategory.OST_LightingFixtures:
                    case BuiltInCategory.OST_LightingDevices:
                        return "MepLighting";
                    case BuiltInCategory.OST_FireAlarmDevices:
                    case BuiltInCategory.OST_DataDevices:
                    case BuiltInCategory.OST_CommunicationDevices:
                    case BuiltInCategory.OST_ElectricalFixtures:
                        return "MepDevice";
                    default:
                        return "MepElement";
                }
            }
            catch { return "MepElement"; }
        }

        /// <summary>
        /// Adds a node for an MEP element if not already present.
        /// </summary>
        private static void EnsureMEPElementNode(
            OnexusGraph graph,
            HashSet<string> nodeSeen,
            Element el)
        {
            var uid = el.UniqueId;
            if (!nodeSeen.Add(uid)) return;

            var cat      = el.Category?.Name ?? "MEP";
            var nodeType = GetMEPElementNodeType(el);
            var label    = MakeMEPLabel(el);

            // Level — try LevelId first, then parameter fallback
            string levelName = null;
            try
            {
                if (el.LevelId != null && el.LevelId != ElementId.InvalidElementId)
                    levelName = (el.Document.GetElement(el.LevelId) as Level)?.Name;
            }
            catch { }

            graph.elements.nodes.Add(new OnexusNode
            {
                data = new NodeData
                {
                    id                = uid,
                    nodeType          = nodeType,
                    category          = cat,
                    label             = MakeBilingualLabel(label),
                    revitCategory     = cat,
                    level             = levelName,
                    familyName        = (el is FamilyInstance fi2) ? fi2.Symbol?.FamilyName : null,
                    typeName          = (el is FamilyInstance fi3) ? (fi3.Symbol?.Name ?? fi3.Name) : el.Name,
                    revitInstanceIds  = new List<long>   { el.Id.Value },
                    revitInstanceUids = new List<string> { uid }
                }
            });
        }

        /// <summary>Human-readable label for any MEP element.</summary>
        private static string MakeMEPLabel(Element el)
        {
            if (el is FamilyInstance fi)
            {
                var fam = fi.Symbol?.FamilyName;
                var typ = fi.Symbol?.Name ?? fi.Name;
                if (!string.IsNullOrWhiteSpace(fam) && !string.IsNullOrWhiteSpace(typ))
                    return $"{fam} : {typ}";
                return fam ?? typ ?? fi.Name ?? "MEP";
            }
            return !string.IsNullOrWhiteSpace(el.Name) ? el.Name
                 : (el.Category?.Name ?? "MEP");
        }

        /// <summary>Creates a {en, jp} label dictionary with the same text for both.</summary>
        private static Dictionary<string, string> MakeBilingualLabel(string text) =>
            new Dictionary<string, string> { ["en"] = text, ["jp"] = text };

        // ══════════════════════════════════════════════════════════════════════
        //  Sheets & Views graph
        //
        //  Exports every drawing sheet, the views placed on each sheet, and
        //  the rooms visible in each plan-type view.
        //
        //  Node types produced:
        //    Sheet  (nodeType: "Sheet",  category: "Sheet")
        //    View   (nodeType: "View",   category: view type name e.g. "FloorPlan")
        //    Space  (nodeType: "Space",  category: "Room") — rooms in plan views
        //
        //  Edge types produced:
        //    ContainedIn (View → Sheet, dimension: Documentation)
        //      A view is placed on this sheet.
        //    ShowsSpace  (View → Room,  dimension: Documentation)
        //      A room appears in this floor-plan/ceiling-plan view.
        //      Only produced for plan-type views (FloorPlan, CeilingPlan,
        //      AreaPlan, EngineeringPlan) where room tags are meaningful.
        // ══════════════════════════════════════════════════════════════════════
        public static OnexusGraph BuildSheetsAndViewsGraph(Document doc)
        {
            var graph    = NewGraph(doc);
            var nodeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var edgeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            var sheets = new FilteredElementCollector(doc)
                .OfClass(typeof(ViewSheet))
                .Cast<ViewSheet>()
                .OrderBy(s => s.SheetNumber)
                .ToList();

            foreach (var sheet in sheets)
            {
                // ── Sheet node ───────────────────────────────────────────────
                var sheetUid   = sheet.UniqueId;
                var sheetLabel = string.IsNullOrWhiteSpace(sheet.SheetNumber)
                    ? (sheet.Name ?? "Sheet")
                    : $"{sheet.SheetNumber} — {sheet.Name}";

                if (nodeSeen.Add(sheetUid))
                {
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id                = sheetUid,
                            nodeType          = "Sheet",
                            category          = "Sheet",
                            label             = MakeBilingualLabel(sheetLabel),
                            revitCategory     = "Sheets",
                            revitInstanceIds  = new List<long>   { sheet.Id.Value },
                            revitInstanceUids = new List<string> { sheetUid }
                        }
                    });
                }

                // ── Views placed on this sheet ───────────────────────────────
                ISet<ElementId> placedViewIds;
                try   { placedViewIds = sheet.GetAllPlacedViews(); }
                catch { continue; }

                foreach (var viewId in placedViewIds)
                {
                    var view = doc.GetElement(viewId) as Autodesk.Revit.DB.View;
                    if (view == null || view.IsTemplate) continue;

                    var viewUid      = view.UniqueId;
                    var viewTypeName = view.ViewType.ToString();  // "FloorPlan", "Section", etc.
                    var viewLabel    = !string.IsNullOrWhiteSpace(view.Name)
                        ? view.Name : viewTypeName;

                    // ── View node ────────────────────────────────────────────
                    if (nodeSeen.Add(viewUid))
                    {
                        graph.elements.nodes.Add(new OnexusNode
                        {
                            data = new NodeData
                            {
                                id                = viewUid,
                                nodeType          = "View",
                                category          = viewTypeName,
                                label             = MakeBilingualLabel(viewLabel),
                                revitCategory     = "Views",
                                revitInstanceIds  = new List<long>   { view.Id.Value },
                                revitInstanceUids = new List<string> { viewUid }
                            }
                        });
                    }

                    // ── ContainedIn edge: View → Sheet ───────────────────────
                    AddEdge(graph, edgeSeen,
                            "ContainedIn", "Documentation",
                            viewUid, sheetUid,
                            directional: true, confidence: "Explicit");

                    // ── ShowsSpace edges: plan-type views only ───────────────
                    if (!IsPlanView(view.ViewType)) continue;

                    try
                    {
                        var rooms = new FilteredElementCollector(doc, viewId)
                            .OfCategory(BuiltInCategory.OST_Rooms)
                            .WhereElementIsNotElementType()
                            .Cast<Room>()
                            .Where(r => r.Area > 0);

                        foreach (var room in rooms)
                        {
                            var roomUid = room.UniqueId;

                            // Add the room node if we haven't seen it yet
                            // (it may already exist if a spatial graph was merged later,
                            //  but this graph is standalone so we create it here)
                            if (nodeSeen.Add(roomUid))
                            {
                                graph.elements.nodes.Add(new OnexusNode
                                {
                                    data = new NodeData
                                    {
                                        id                = roomUid,
                                        nodeType          = "Space",
                                        category          = "Room",
                                        label             = MakeBilingualLabel(MakeRoomLabel(room)),
                                        revitCategory     = "Rooms",
                                        level             = room.Level?.Name,
                                        revitInstanceIds  = new List<long>   { room.Id.Value },
                                        revitInstanceUids = new List<string> { roomUid }
                                    }
                                });
                            }

                            // View → ShowsSpace → Room
                            AddEdge(graph, edgeSeen,
                                    "ShowsSpace", "Documentation",
                                    viewUid, roomUid,
                                    directional: true, confidence: "Explicit");
                        }
                    }
                    catch { /* view may not support element collection */ }
                }
            }

            return graph;
        }

        /// <summary>
        /// Returns true for view types where room tags are spatially meaningful —
        /// used to decide whether to generate ShowsSpace edges.
        /// </summary>
        private static bool IsPlanView(ViewType vt)
        {
            switch (vt)
            {
                case ViewType.FloorPlan:
                case ViewType.CeilingPlan:
                case ViewType.AreaPlan:
                case ViewType.EngineeringPlan:
                    return true;
                default:
                    return false;
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        //  Delta sync — Phase 5
        // ══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// Builds a single <see cref="OnexusNode"/> for a changed/added element.
        /// Returns <c>null</c> when the element type is not worth syncing
        /// (e.g. annotation, dimension, view template).
        ///
        /// Called from <see cref="OnexusPaneContent.ProcessDeltaEntry"/> on the
        /// Revit main thread inside an Idling callback, so all Revit API calls
        /// are safe here.
        /// </summary>
        public static OnexusNode BuildDeltaNode(Document doc, ElementId id)
        {
            try
            {
                var el = doc.GetElement(id);
                if (el == null || el.UniqueId == null) return null;

                // ── Room ─────────────────────────────────────────────────────
                if (el is Room room)
                {
                    if (room.Area <= 0) return null;    // unplaced room: skip
                    var lvl = room.Level;
                    return new OnexusNode
                    {
                        data = new NodeData
                        {
                            id                = room.UniqueId,
                            nodeType          = "Space",
                            category          = "Room",
                            label             = MakeBilingualLabel(MakeRoomLabel(room)),
                            revitCategory     = "Rooms",
                            level             = lvl?.Name,
                            revitInstanceIds  = new List<long>   { room.Id.Value },
                            revitInstanceUids = new List<string> { room.UniqueId }
                        }
                    };
                }

                // ── Level ────────────────────────────────────────────────────
                if (el is Level level)
                {
                    var lbl = level.Name ?? "Level";
                    return new OnexusNode
                    {
                        data = new NodeData
                        {
                            id                = level.UniqueId,
                            nodeType          = "Level",
                            category          = "Level",
                            label             = MakeBilingualLabel(lbl),
                            revitCategory     = "Levels",
                            level             = lbl,
                            revitInstanceIds  = new List<long>   { level.Id.Value },
                            revitInstanceUids = new List<string> { level.UniqueId }
                        }
                    };
                }

                // ── MEP system (Mechanical / Electrical / Piping) ─────────────
                if (el is MEPSystem mep)
                {
                    var nodeType = GetMEPSystemNodeType(mep);
                    return new OnexusNode
                    {
                        data = new NodeData
                        {
                            id                = mep.UniqueId,
                            nodeType          = nodeType,
                            category          = nodeType,
                            label             = MakeBilingualLabel(mep.Name ?? nodeType),
                            revitCategory     = mep.Category?.Name,
                            revitInstanceIds  = new List<long>   { mep.Id.Value },
                            revitInstanceUids = new List<string> { mep.UniqueId }
                        }
                    };
                }

                // ── FamilyInstance (walls, doors, furniture, MEP equipment …) ─
                if (el is FamilyInstance fi)
                {
                    var lvl = TryGetLevel(fi, doc);
                    var cat = fi.Category?.Name ?? "Element";

                    // Decide nodeType: MEP leaf → specific type, else generic Element
                    var nodeType = IsMEPLeafElement(fi) ? GetMEPElementNodeType(fi) : "Element";

                    return new OnexusNode
                    {
                        data = new NodeData
                        {
                            id                = fi.UniqueId,
                            nodeType          = nodeType,
                            category          = cat,
                            label             = MakeBilingualLabel(MakeElementLabel(fi)),
                            revitCategory     = cat,
                            level             = lvl?.Name,
                            familyName        = fi.Symbol?.FamilyName,
                            typeName          = fi.Symbol?.Name ?? fi.Name,
                            revitInstanceIds  = new List<long>   { fi.Id.Value },
                            revitInstanceUids = new List<string> { fi.UniqueId }
                        }
                    };
                }

                // ── ViewSheet ────────────────────────────────────────────────
                if (el is ViewSheet sheet)
                {
                    var lbl = string.IsNullOrWhiteSpace(sheet.SheetNumber)
                        ? (sheet.Name ?? "Sheet")
                        : $"{sheet.SheetNumber} — {sheet.Name}";
                    return new OnexusNode
                    {
                        data = new NodeData
                        {
                            id                = sheet.UniqueId,
                            nodeType          = "Sheet",
                            category          = "Sheet",
                            label             = MakeBilingualLabel(lbl),
                            revitCategory     = "Sheets",
                            revitInstanceIds  = new List<long>   { sheet.Id.Value },
                            revitInstanceUids = new List<string> { sheet.UniqueId }
                        }
                    };
                }

                // ── Generic element (annotations, grids, etc.) ────────────────
                //    Only include elements that Revit tracks with a UniqueId and
                //    belong to a named category (skip internal workset elements).
                var genCat = el.Category?.Name;
                if (string.IsNullOrEmpty(genCat)) return null;

                return new OnexusNode
                {
                    data = new NodeData
                    {
                        id                = el.UniqueId,
                        nodeType          = "Element",
                        category          = genCat,
                        label             = MakeBilingualLabel(el.Name ?? genCat),
                        revitCategory     = genCat,
                        revitInstanceIds  = new List<long>   { el.Id.Value },
                        revitInstanceUids = new List<string> { el.UniqueId }
                    }
                };
            }
            catch { return null; }
        }

        // ══════════════════════════════════════════════════════════════════════
        //  Element Parameter Value Graph
        //
        //  Enumerates element.Parameters on each selected element to expose ALL
        //  parameters (built-in + shared + project).  Unlike BuildParameterBindingGraphScoped,
        //  this shows real values rather than just the schema binding map.
        //
        //  Graph shape:
        //    Element ──HasType──► FamilyType
        //    Element ──HasParameter──► Parameter (name: value)
        //    Parameter ──InGroup──► ParameterGroup
        // ══════════════════════════════════════════════════════════════════════

        public static OnexusGraph BuildElementParameterValueGraph(
            Document doc,
            ICollection<ElementId> elementIds,
            ParamExportOptions opt = null)
        {
            if (opt == null) opt = new ParamExportOptions();

            var graph    = NewGraph(doc);
            var nodeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var edgeSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // Regex filters
            System.Text.RegularExpressions.Regex reInclude = null, reExclude = null;
            if (!string.IsNullOrWhiteSpace(opt.IncludeNameRegex))
                reInclude = new System.Text.RegularExpressions.Regex(opt.IncludeNameRegex, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (!string.IsNullOrWhiteSpace(opt.ExcludeNameRegex))
                reExclude = new System.Text.RegularExpressions.Regex(opt.ExcludeNameRegex, System.Text.RegularExpressions.RegexOptions.IgnoreCase);

            var elements = elementIds == null
                ? new List<Element>()
                : elementIds.Select(id => doc.GetElement(id)).Where(e => e != null).ToList();

            if (elements.Count == 0) return graph;

            int paramCount = 0;

            foreach (var el in elements)
            {
                // ── Element/Instance node ───────────────────────────────────────
                var elUid   = el.UniqueId;
                var cat     = el.Category?.Name ?? "Element";
                var lvl     = TryGetLevel(el, doc);

                string elLabel;
                if (el is Room r)            elLabel = MakeRoomLabel(r);
                else if (el is FamilyInstance fi) elLabel = MakeElementLabel(fi);
                else                         elLabel = el.Name ?? cat;

                if (nodeSeen.Add(elUid))
                {
                    graph.elements.nodes.Add(new OnexusNode
                    {
                        data = new NodeData
                        {
                            id                = elUid,
                            nodeType          = (el is Room) ? "Space" : "Element",
                            category          = (el is Room) ? "Room"  : cat,
                            label             = MakeBilingualLabel(elLabel),
                            revitCategory     = cat,
                            level             = lvl?.Name,
                            revitInstanceIds  = new List<long>   { el.Id.Value },
                            revitInstanceUids = new List<string> { elUid }
                        }
                    });
                }

                // ── FamilyType node ─────────────────────────────────────────────
                string typeNodeId = null;
                if (el is FamilyInstance fi2 && fi2.Symbol != null)
                {
                    typeNodeId  = $"TYP-{fi2.Symbol.Id.Value}";
                    var typeLbl = $"{fi2.Symbol.FamilyName} : {fi2.Symbol.Name}";
                    if (nodeSeen.Add(typeNodeId))
                    {
                        graph.elements.nodes.Add(new OnexusNode
                        {
                            data = new NodeData
                            {
                                id               = typeNodeId,
                                nodeType         = "FamilyType",
                                category         = cat,
                                label            = MakeBilingualLabel(typeLbl),
                                revitCategory    = cat,
                                revitInstanceIds = new List<long> { fi2.Symbol.Id.Value }
                            }
                        });
                    }
                    AddEdge(graph, edgeSeen, "HasType", "Metadata", elUid, typeNodeId, directional: true);
                }

                // ── Parameters ──────────────────────────────────────────────────
                foreach (Parameter p in el.Parameters)
                {
                    try
                    {
                        if (p == null || p.Definition == null) continue;
                        var defName = p.Definition.Name;
                        if (string.IsNullOrEmpty(defName)) continue;
                        if (reInclude != null && !reInclude.IsMatch(defName)) continue;
                        if (reExclude != null && reExclude.IsMatch(defName))  continue;
                        if (paramCount >= opt.MaxParameters) break;

                        // ── Parameter group ───────────────────────────────────
                        string grpName = "Other";
                        try
                        {
                            var gtid = p.Definition.GetGroupTypeId();
                            if (gtid != null) grpName = LabelUtils.GetLabelForGroup(gtid);
                        }
                        catch { }

                        var grpId = $"PG-{San(grpName)}";
                        if (nodeSeen.Add(grpId))
                        {
                            graph.elements.nodes.Add(new OnexusNode
                            {
                                data = new NodeData
                                {
                                    id       = grpId,
                                    nodeType = "ParameterGroup",
                                    category = "ParameterGroup",
                                    label    = MakeBilingualLabel(grpName)
                                }
                            });
                        }

                        // ── Stringify value ───────────────────────────────────
                        string rawValue = null;
                        string storageTypeName = p.StorageType.ToString();
                        try
                        {
                            switch (p.StorageType)
                            {
                                case StorageType.String:
                                    rawValue = p.AsString();
                                    break;
                                case StorageType.Double:
                                    rawValue = p.AsValueString() ?? p.AsDouble().ToString("G6");
                                    break;
                                case StorageType.Integer:
                                    rawValue = p.AsInteger().ToString();
                                    break;
                                case StorageType.ElementId:
                                    var refEl = doc.GetElement(p.AsElementId());
                                    rawValue = refEl?.Name ?? p.AsElementId().Value.ToString();
                                    break;
                            }
                        }
                        catch { }

                        var displayValue = rawValue ?? "(no value)";

                        // ── Parameter node (one per unique param name+group combo) ──
                        // Keyed per element so multiple selected elements can show
                        // different values for the same parameter name.
                        var paramId = $"PAR-{San(elUid)}-{San(defName)}";
                        if (nodeSeen.Add(paramId))
                        {
                            graph.elements.nodes.Add(new OnexusNode
                            {
                                data = new NodeData
                                {
                                    id              = paramId,
                                    nodeType        = "Parameter",
                                    category        = storageTypeName,
                                    label           = MakeBilingualLabel($"{defName}: {displayValue}"),
                                    paramValue      = displayValue,
                                    paramStorageType = storageTypeName,
                                    paramGroup      = grpName
                                }
                            });
                            paramCount++;
                        }

                        AddEdge(graph, edgeSeen, "HasParameter", "Metadata", elUid, paramId, directional: true);
                        AddEdge(graph, edgeSeen, "InGroup",      "Metadata", paramId, grpId,  directional: true);
                    }
                    catch { /* safe-fail per parameter */ }
                }
            }

            return graph;
        }
    }
}
