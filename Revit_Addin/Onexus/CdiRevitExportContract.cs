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
    /// Construction_Decision_Intelligence/Spatial_Decision_Graph docs/28.
    /// Kept separate from the ONEXUS graph contract (OnexusGraph, "onexus-1.1")
    /// and from the neutral 3D Room mesh sidecar (CdiRoomGeometryPackage,
    /// "cdi-room-geometry-v1"): this one carries element facts (name, level,
    /// real parameters), not viewer graph nodes or triangulated geometry.
    /// </summary>
    public class CdiRevitExportPackage
    {
        public string schemaVersion { get; set; } = "cdi-revit-onexus-export-v1";
        public CdiRevitExportInfo export { get; set; } = new CdiRevitExportInfo();
        public List<CdiRevitExportModel> models { get; set; } = new List<CdiRevitExportModel>();
        public List<CdiRevitExportElement> elements { get; set; } = new List<CdiRevitExportElement>();

        // No relationships are emitted by the Room exporter yet; the schema
        // requires the key to be present but does not require it non-empty.
        public List<object> relationships { get; set; } = new List<object>();
    }

    public class CdiRevitExportInfo
    {
        public string sourceSystem { get; set; } = "Revit";
        public string exportedAt { get; set; }
        public string documentId { get; set; }
        public string documentName { get; set; }
        public string units { get; set; } = "feet";
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
        public string name { get; set; }
        public string kind { get; set; }
        public string category { get; set; }
        public string level { get; set; }
        public string family { get; set; } = "";
        public string type { get; set; } = "";
        public CdiRevitExportClassification classification { get; set; } = new CdiRevitExportClassification();

        /// <summary>Free-form — whatever real parameters the Revit API returned for this element.</summary>
        public Dictionary<string, string> parameters { get; set; } = new Dictionary<string, string>();

        public CdiRevitExportSemantics semantics { get; set; } = new CdiRevitExportSemantics();
        public CdiRevitExportLocalSpatial localSpatial { get; set; } = new CdiRevitExportLocalSpatial();
    }

    public class CdiRevitExportClassification
    {
        public List<string> sbs { get; set; } = new List<string>();
        public Dictionary<string, object> other { get; set; } = new Dictionary<string, object>();
    }

    public class CdiRevitExportSemantics
    {
        public string mark { get; set; } = "";
        public string room { get; set; } = "";
        public string space { get; set; } = "";
        public string fromRoom { get; set; } = "";
        public string toRoom { get; set; } = "";
        public string system { get; set; } = "";
        public string host { get; set; } = "";
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
}
