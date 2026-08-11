// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System.Collections.Generic;

namespace Onexus
{
    /// <summary>
    /// Neutral, read-only handoff from a Revit-capable host to CDI or another
    /// viewer. It deliberately stays separate from the ONEXUS graph contract:
    /// graph nodes express relationships; this package supplies selectable mesh
    /// geometry for the same stable Revit Room identities.
    /// </summary>
    public class CdiRoomGeometryPackage
    {
        public string schemaVersion { get; set; } = "cdi-room-geometry-v1";
        public CdiRoomGeometryExport export { get; set; } = new CdiRoomGeometryExport();
        public CdiRoomGeometryModel model { get; set; } = new CdiRoomGeometryModel();
        public CdiRoomGeometrySummary summary { get; set; } = new CdiRoomGeometrySummary();
        public List<CdiRoomGeometryRecord> rooms { get; set; } = new List<CdiRoomGeometryRecord>();
    }

    public class CdiRoomGeometryExport
    {
        public string sourceSystem { get; set; } = "ONEXUS Revit Add-in";
        public string exportedAt { get; set; }
        public string selectionScope { get; set; }
        public string units { get; set; } = "feet";
        public string coordinateFrame { get; set; } = "Revit internal coordinates";
        public string axes { get; set; } = "x-east, y-north, z-up";
    }

    public class CdiRoomGeometryModel
    {
        public string documentId { get; set; }
        public string documentName { get; set; }
        public string applicationVersion { get; set; }
    }

    public class CdiRoomGeometrySummary
    {
        public int roomCount { get; set; }
        public int validGeometryCount { get; set; }
        public int unplacedCount { get; set; }
        public int unenclosedCount { get; set; }
        public int failedCount { get; set; }
        public int triangleCount { get; set; }
    }

    public class CdiRoomGeometryRecord
    {
        public string externalId { get; set; }
        public long elementId { get; set; }
        public string number { get; set; }
        public string name { get; set; }
        public string level { get; set; }
        public string phase { get; set; }
        public string geometryStatus { get; set; }
        public string message { get; set; }
        public CdiRoomMesh mesh { get; set; }
    }

    public class CdiRoomMesh
    {
        /// <summary>Flat xyz triples in the package coordinate frame.</summary>
        public List<double> vertices { get; set; } = new List<double>();

        /// <summary>Triangle vertex indices, grouped in triples.</summary>
        public List<int> indices { get; set; } = new List<int>();

        public CdiRoomBounds bounds { get; set; }
    }

    public class CdiRoomBounds
    {
        public CdiRoomPoint min { get; set; }
        public CdiRoomPoint max { get; set; }
    }

    public class CdiRoomPoint
    {
        public double x { get; set; }
        public double y { get; set; }
        public double z { get; set; }
    }
}
