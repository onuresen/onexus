// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System.Collections.Generic;

namespace Onexus
{
    /// <summary>
    /// POCO shape for CDI's `cdi-revit-onexus-export-v1` contract — the
    /// geometry-light handoff format documented in
    /// Construction_Decision_Intelligence/Spatial_Decision_Graph docs/28 and
    /// docs/71 (Group B — Revit-native context export). Kept separate from the
    /// ONEXUS graph contract (OnexusGraph, "onexus-1.1") and from the neutral
    /// 3D Room mesh sidecar (CdiRoomGeometryPackage, "cdi-room-geometry-v1"):
    /// this one carries element facts (name, level, real parameters, stable
    /// host/room/system references), not viewer graph nodes or triangulated
    /// geometry.
    ///
    /// All fields added for Group B are additive to the v1 contract — none of
    /// them were promoted to `required` in the schema — so the older Room-only
    /// export already on disk (`data/projects/esen_sample_2024/cdi-revit-onexus-export.json`)
    /// still validates unchanged.
    /// </summary>
    public class CdiRevitExportPackage
    {
        public string schemaVersion { get; set; } = "cdi-revit-onexus-export-v1";
        public CdiRevitExportInfo export { get; set; } = new CdiRevitExportInfo();
        public List<CdiRevitExportModel> models { get; set; } = new List<CdiRevitExportModel>();
        public List<CdiRevitExportElement> elements { get; set; } = new List<CdiRevitExportElement>();

        // Group B populates this with source-native facts only (hostedBy,
        // connectsTo Door FromRoom/ToRoom, installedIn Room/Space, and
        // belongsToSystem) — never a `controls` or other inferred/functional
        // relationship. The schema requires the key to be present but does
        // not require it non-empty.
        public List<CdiRevitExportRelationship> relationships { get; set; } = new List<CdiRevitExportRelationship>();
    }

    public class CdiRevitExportInfo
    {
        public string sourceSystem { get; set; } = "Revit";
        public string exportedAt { get; set; }
        public string documentId { get; set; }
        public string documentName { get; set; }
        public string units { get; set; } = "feet";

        /// <summary>
        /// The Revit phase used to resolve Door From/To Room. Revit's
        /// parameterless FamilyInstance.FromRoom/ToRoom/Room properties (used
        /// by this exporter) resolve against the last phase of the document —
        /// this field records that phase's name so a reviewer can tell which
        /// phase the recorded Door/Room facts belong to. Empty when the
        /// document defines no phases.
        /// </summary>
        public string phase { get; set; } = "";
    }

    public class CdiRevitExportModel
    {
        public string modelId { get; set; }
        public string name { get; set; }
        public string sourceDocumentId { get; set; }

        // Single-model export (no federation offset) — identity transform.
        public List<double> transformToFederation { get; set; } = new List<double>
        {
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        };
    }

    public class CdiRevitExportElement
    {
        public string modelId { get; set; }
        public string externalId { get; set; }
        public string uniqueId { get; set; }

        /// <summary>Revit's session-scoped numeric ElementId.Value — diagnostic only, never the stable identity (use uniqueId/externalId for that).</summary>
        public long elementId { get; set; }
        public string name { get; set; }
        public string kind { get; set; }
        public string category { get; set; }
        public string level { get; set; }
        public string family { get; set; } = "";
        public string type { get; set; } = "";

        /// <summary>
        /// The instance's Family Type, kept as its own stable identity
        /// (ElementId + UniqueId of the ElementType) — separate from this
        /// element's own instance uniqueId/elementId. A Family Type is
        /// context, never a physical relationship endpoint.
        /// </summary>
        public CdiRevitExportTypeIdentity typeIdentity { get; set; } = new CdiRevitExportTypeIdentity();

        public CdiRevitExportClassification classification { get; set; } = new CdiRevitExportClassification();

        /// <summary>Free-form — whatever real parameters the Revit API returned for this element.</summary>
        public Dictionary<string, string> parameters { get; set; } = new Dictionary<string, string>();

        public CdiRevitExportSemantics semantics { get; set; } = new CdiRevitExportSemantics();
        public CdiRevitExportLocalSpatial localSpatial { get; set; } = new CdiRevitExportLocalSpatial();
    }

    public class CdiRevitExportTypeIdentity
    {
        public string typeId { get; set; } = "";
        public string typeUniqueId { get; set; } = "";
        public string typeName { get; set; } = "";
    }

    public class CdiRevitExportClassification
    {
        public List<string> sbs { get; set; } = new List<string>();
        public Dictionary<string, object> other { get; set; } = new Dictionary<string, object>();
    }

    public class CdiRevitExportSemantics
    {
        public string mark { get; set; } = "";

        /// <summary>Room label for a Room/Space-associated instance (e.g. equipment such as a card reader).</summary>
        public string room { get; set; } = "";

        /// <summary>Stable Room UniqueId backing `room`.</summary>
        public string roomId { get; set; } = "";

        /// <summary>MEP Space label for a Space-associated instance.</summary>
        public string space { get; set; } = "";

        /// <summary>Stable Space UniqueId backing `space`.</summary>
        public string spaceId { get; set; } = "";

        /// <summary>Door FromRoom label.</summary>
        public string fromRoom { get; set; } = "";

        /// <summary>Stable Room UniqueId backing `fromRoom`.</summary>
        public string fromRoomId { get; set; } = "";

        /// <summary>Door ToRoom label.</summary>
        public string toRoom { get; set; } = "";

        /// <summary>Stable Room UniqueId backing `toRoom`.</summary>
        public string toRoomId { get; set; } = "";

        /// <summary>First/primary MEP system name this instance belongs to, where the Revit API exposes membership.</summary>
        public string system { get; set; } = "";

        /// <summary>Stable UniqueId(s) of every MEP system this instance belongs to (System.Elements membership).</summary>
        public List<string> systemIds { get; set; } = new List<string>();

        /// <summary>Door/Window Host label.</summary>
        public string host { get; set; } = "";

        /// <summary>Stable host-element UniqueId backing `host`.</summary>
        public string hostId { get; set; } = "";
    }

    public class CdiRevitExportLocalSpatial
    {
        public CdiRevitExportPoint anchor { get; set; }
        public CdiRevitExportBounds bounds { get; set; }
    }

    public class CdiRevitExportBounds
    {
        public CdiRevitExportPoint min { get; set; }
        public CdiRevitExportPoint max { get; set; }
    }

    public class CdiRevitExportPoint
    {
        public double x { get; set; }
        public double y { get; set; }
        public double z { get; set; }
    }

    /// <summary>
    /// A source-native relationship with stable endpoints — never emitted from
    /// proximity or name/type similarity. `method` is always "native" for
    /// facts this exporter reads straight from the Revit API.
    /// </summary>
    public class CdiRevitExportRelationship
    {
        public string sourceModelId { get; set; }
        public string sourceExternalId { get; set; }
        public string targetModelId { get; set; }
        public string targetExternalId { get; set; }
        public string type { get; set; }
        public string method { get; set; } = "native";
        public List<string> evidence { get; set; } = new List<string>();
    }
}
