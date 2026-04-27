// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System.Collections.Generic;

namespace ONES
{
    // Root graph container
    public class OnexusGraph
    {
        public OnexusMeta meta { get; set; } = new OnexusMeta();
        public OnexusElements elements { get; set; } = new OnexusElements();
    }

    // Metadata (extend as needed)
    public class OnexusMeta
    {
        public string schema { get; set; } = "onexus-1.1";
        public string project { get; set; }
        public string languageDefault { get; set; } = "en";
        public List<string> phases { get; set; }
    }

    // Element lists
    public class OnexusElements
    {
        public List<OnexusNode> nodes { get; set; } = new List<OnexusNode>();
        public List<OnexusEdge> edges { get; set; } = new List<OnexusEdge>();
    }

    // Cytoscape node wrapper
    public class OnexusNode
    {
        public NodeData data { get; set; }
    }

    // Node payload
    public class NodeData
    {
        public string id { get; set; }
        public string nodeType { get; set; }
        public string category { get; set; }
        public Dictionary<string, string> label { get; set; }

        // Existing extras
        public string revitCategory { get; set; }
        public string level { get; set; }
        public string familyName { get; set; }
        public string typeName { get; set; }

        // NEW: instance references (optional)
        public List<int> revitInstanceIds { get; set; }     // quick selection (ElementId)
        public List<string> revitInstanceUids { get; set; } // robust across sessions (UniqueId)
    }

    // Cytoscape edge wrapper
    public class OnexusEdge
    {
        public EdgeData data { get; set; }
    }

    // Edge payload
    public class EdgeData
    {
        public string id { get; set; }
        public string type { get; set; }        // e.g., "LocatedIn", "OnLevel", "PartOfSystem"
        public string dimension { get; set; }   // e.g., "Spatial", "System"
        public bool directional { get; set; } = true;
        public string source { get; set; }
        public string target { get; set; }

        // Optional attributes recognized by ONEXUS UI
        public string owner { get; set; }
        public string risk { get; set; }
        public string confidence { get; set; }  // "Explicit" / "Inferred"
        public List<string> phase { get; set; }
        public string notes { get; set; }
    }
}
