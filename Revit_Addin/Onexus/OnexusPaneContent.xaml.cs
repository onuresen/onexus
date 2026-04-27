// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using Microsoft.Web.WebView2.Core;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Onexus
{
    // ══════════════════════════════════════════════════════════════════════════
    //  OnexusPaneContent
    //
    //  WPF UserControl that:
    //    1. Hosts a WebView2 pointing at the local Onexus web app (index.html)
    //    2. Injects graph JSON via Base64 postMessage (same approach as the
    //       prototype's floating window, so the existing boot script still works)
    //    3. Bridges selection both ways:
    //         Revit → Onexus  (via Idling → PostWebMessageAsJson)
    //         Onexus → Revit  (via WebMessageReceived → SetElementIds)
    // ══════════════════════════════════════════════════════════════════════════
    public partial class OnexusPaneContent : UserControl
    {
        // ── WebView2 state ─────────────────────────────────────────────────────
        private bool   _initStarted;        // prevents double-init on multiple Loaded events
        private bool   _webReady;           // true once NavigationCompleted fires successfully
        private bool   _handlersAttached;   // guard for WebMessageReceived subscription
        private string _pendingJson;        // graph queued before WebView2 was ready

        // ── Revit bridge state ────────────────────────────────────────────────
        private UIApplication _uiapp;
        private UIDocument    _uidoc;
        private bool          _bridgeWired;           // Idling subscribed?
        private string[]      _lastSentUids = Array.Empty<string>();
        private DateTime      _lastSentAt   = DateTime.MinValue;

        private readonly ConcurrentQueue<PendingSelect> _pendingSelects =
            new ConcurrentQueue<PendingSelect>();

        // ── Delta-sync state (Phase 5) ────────────────────────────────────────
        // Maps ElementId.Value → UniqueId for every node in the last full graph.
        // Populated by TrackGraph(); consulted when deletions arrive so we can
        // send the right node id to the JS "removed" array.
        private readonly Dictionary<long, string>   _elementIdCache = new Dictionary<long, string>();
        private readonly object                     _cacheSync      = new object();
        private readonly ConcurrentQueue<DeltaEntry> _pendingDeltas  = new ConcurrentQueue<DeltaEntry>();

        // Maximum element-changes per delta before we ask for a full resync
        private const int MaxDeltaElements = 200;

        // ── Constructor ────────────────────────────────────────────────────────
        public OnexusPaneContent()
        {
            InitializeComponent();
            Loaded += OnLoaded;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  Initialisation
        // ══════════════════════════════════════════════════════════════════════

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            // Loaded can fire again if the pane is re-docked; guard against double-init
            if (_initStarted) return;
            _initStarted = true;

            // Resolve Onexus folder (prompts user if not yet configured)
            var folder = OnexusSettings.EnsureOnexusFolder();
            if (folder == null)
            {
                ShowPlaceholder(
                    "ONEXUS folder not configured.\n\n" +
                    "Click any ONEXUS ribbon command to be prompted for the folder location.");
                return;
            }

            var indexHtml = Path.Combine(folder, "index.html");
            if (!File.Exists(indexHtml))
            {
                ShowPlaceholder($"index.html not found in:\n{folder}\n\nPlease reconfigure via 'ONEXUS › Set Folder'.");
                return;
            }

            try
            {
                // WebView2 user-data folder (isolated from the floating viewer's profile)
                string dataDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Onexus", "WebView2", "DockablePane");

                var env = await CoreWebView2Environment.CreateAsync(userDataFolder: dataDir);
                await Web.EnsureCoreWebView2Async(env);

                // Inject the boot script BEFORE navigation so it runs on every page load.
                // This is the same boot-script pattern used by the prototype's floating window:
                // it sets up window.onexusReceiveGraph() and polls for window.onexusLoadGraph().
                await Web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(BootScript);

                AttachWebMessageHandler();

                Web.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
                Web.Source = new Uri(indexHtml);
            }
            catch (Exception ex)
            {
                ShowPlaceholder(
                    "WebView2 failed to initialise.\n\n" +
                    "Make sure the WebView2 Runtime is installed.\n\n" +
                    ex.Message);
            }
        }

        private async void OnNavigationCompleted(
            object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (!e.IsSuccess) return;

            // Attach handlers in case CoreWebView2 was only ready now
            AttachWebMessageHandler();

            // Inject any graph that arrived before navigation completed
            if (_pendingJson != null)
            {
                await InjectGraphAsync(_pendingJson);
                _pendingJson = null;
            }

            _webReady = true;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  WebMessage bridge (JS → Revit)
        // ══════════════════════════════════════════════════════════════════════

        private void AttachWebMessageHandler()
        {
            if (_handlersAttached) return;
            if (Web?.CoreWebView2 == null) return;

            Web.CoreWebView2.WebMessageReceived += (s, args) =>
            {
                try
                {
                    // Try string first; fall back to raw JSON
                    var raw = args.TryGetWebMessageAsString();
                    if (string.IsNullOrEmpty(raw)) raw = args.WebMessageAsJson;
                    if (string.IsNullOrEmpty(raw)) return;

                    var root = JObject.Parse(raw);
                    var type = (string)root["type"];

                    // ── select-node: select element in Revit, no camera move ──────────
                    // ── zoom-to-node: select element AND zoom Revit view to it ─────────
                    if (string.Equals(type, "select-node",  StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(type, "zoom-to-node", StringComparison.OrdinalIgnoreCase))
                    {
                        var shouldZoom = string.Equals(type, "zoom-to-node", StringComparison.OrdinalIgnoreCase);

                        var idsJ  = root["revitInstanceIds"]  as JArray;
                        var uidsJ = root["revitInstanceUids"] as JArray;

                        _pendingSelects.Enqueue(new PendingSelect
                        {
                            NodeId     = (string)root["id"],
                            ElementIds = idsJ  != null
                                ? idsJ.Select(x => (int)x).ToArray()
                                : Array.Empty<int>(),
                            UniqueIds  = uidsJ != null
                                ? uidsJ.Select(x => (string)x)
                                       .Where(u => !string.IsNullOrEmpty(u))
                                       .ToArray()
                                : Array.Empty<string>(),
                            ShouldZoom = shouldZoom
                        });
                    }
                }
                catch { /* swallow malformed messages */ }
            };

            _handlersAttached = true;
        }

        // ══════════════════════════════════════════════════════════════════════
        //  Revit bridge (Idling — runs on Revit's main thread)
        // ══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// Call once from any IExternalCommand to attach the selection-sync bridge.
        /// Safe to call multiple times — subsequent calls are no-ops.
        /// </summary>
        public void EnsureBridge(UIApplication uiapp)
        {
            if (_bridgeWired || uiapp == null) return;
            _uiapp = uiapp;
            _uidoc = uiapp.ActiveUIDocument;
            _uiapp.Idling += OnIdling;
            _bridgeWired = true;
        }

        /// <summary>
        /// Updates the active UIDocument reference when the user switches documents.
        /// Call from UIApplication.ViewActivated or DocumentChanged events.
        /// </summary>
        public void UpdateDocument(UIDocument uidoc)
        {
            _uidoc = uidoc;
            _lastSentUids = Array.Empty<string>();   // reset so next Idling fires fresh
        }

        // ══════════════════════════════════════════════════════════════════════
        //  Delta sync — Phase 5
        // ══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// Rebuilds the ElementId→UniqueId cache from a freshly exported graph.
        /// Called by OnexusPaneManager.ShowGraph() so deletions can be resolved.
        /// </summary>
        public void TrackGraph(OnexusGraph graph)
        {
            if (graph?.elements?.nodes == null) return;
            lock (_cacheSync)
            {
                _elementIdCache.Clear();
                foreach (var node in graph.elements.nodes)
                {
                    var ids  = node.data?.revitInstanceIds;
                    var uids = node.data?.revitInstanceUids;
                    if (ids == null || uids == null) continue;
                    int count = Math.Min(ids.Count, uids.Count);
                    for (int i = 0; i < count; i++)
                        _elementIdCache[(long)ids[i]] = uids[i];
                }
            }
        }

        /// <summary>
        /// Queues a document-change delta for processing on the next Idling tick.
        /// Silently drops entries when the queue is deep (rapid-change guard).
        /// </summary>
        public void EnqueueDelta(DeltaEntry entry)
        {
            if (entry == null) return;
            // Cap queue at 50 entries (~50 transactions) to avoid memory bloat
            if (_pendingDeltas.Count < 50)
                _pendingDeltas.Enqueue(entry);
        }

        /// <summary>
        /// Processes one <see cref="DeltaEntry"/> inside an Idling callback
        /// (valid Revit API context).  Builds or removes nodes and posts the
        /// delta to the Onexus web app via WebView2.
        /// </summary>
        private void ProcessDeltaEntry(DeltaEntry entry)
        {
            try
            {
                var doc = entry?.Doc;
                if (doc == null || Web?.CoreWebView2 == null) return;

                // If the transaction touched too many elements, ask JS to trigger
                // a full resync instead of flooding the bridge with hundreds of nodes.
                int totalChanged = entry.Added.Count + entry.Modified.Count;
                if (totalChanged > MaxDeltaElements)
                {
                    Web.CoreWebView2.PostWebMessageAsJson(
                        new JObject { ["type"] = "graph-delta-overflow", ["count"] = totalChanged }
                            .ToString(Formatting.None));
                    return;
                }

                var graphDelta = new OnexusGraphDelta();

                // Added + modified → build/update nodes and refresh cache
                foreach (var id in entry.Added.Concat(entry.Modified))
                {
                    var node = OnexusExportCore.BuildDeltaNode(doc, id);
                    if (node == null) continue;

                    graphDelta.nodes.Add(node);

                    // Keep cache current so future deletions can resolve the UID
                    var uids = node.data?.revitInstanceUids;
                    if (uids?.Count > 0)
                        lock (_cacheSync) { _elementIdCache[(long)id.Value] = uids[0]; }
                }

                // Deleted → look up UID from cache (element is gone from doc)
                foreach (var id in entry.Deleted)
                {
                    string uid;
                    lock (_cacheSync) { _elementIdCache.TryGetValue((long)id.Value, out uid); }
                    if (!string.IsNullOrEmpty(uid))
                    {
                        graphDelta.removed.Add(uid);
                        lock (_cacheSync) { _elementIdCache.Remove((long)id.Value); }
                    }
                }

                if (graphDelta.nodes.Count == 0 && graphDelta.removed.Count == 0) return;

                PostDelta(graphDelta);
            }
            catch { /* delta errors must never surface to the user */ }
        }

        /// <summary>
        /// Serialises a <see cref="OnexusGraphDelta"/> and pushes it to the
        /// Onexus web app as a "graph-delta" message.
        /// </summary>
        private void PostDelta(OnexusGraphDelta delta)
        {
            try
            {
                if (Web?.CoreWebView2 == null) return;
                var payload = new JObject
                {
                    ["type"]    = "graph-delta",
                    ["nodes"]   = JArray.FromObject(delta.nodes),
                    ["edges"]   = JArray.FromObject(delta.edges),
                    ["removed"] = new JArray(delta.removed)
                };
                Web.CoreWebView2.PostWebMessageAsJson(payload.ToString(Formatting.None));
            }
            catch { }
        }

        private void OnIdling(object sender, IdlingEventArgs e)
        {
            try
            {
                if (Web?.CoreWebView2 == null || _uidoc == null) return;

                bool didSelectFromPage = false;

                // ── A) Apply pending selections from the Onexus page ──────────
                PendingSelect pending;
                while (_pendingSelects.TryDequeue(out pending))
                {
                    var toSelect = new List<ElementId>();

                    // 1) Prefer integer ElementIds — fastest lookup
                    if (pending.ElementIds != null && pending.ElementIds.Length > 0)
                    {
                        foreach (var i in pending.ElementIds)
                        {
                            var id = new ElementId(i);
                            if (id != ElementId.InvalidElementId) toSelect.Add(id);
                        }
                    }

                    // 2) Fallback: try explicit UniqueIds from the message
                    if (toSelect.Count == 0 &&
                        pending.UniqueIds != null && pending.UniqueIds.Length > 0)
                    {
                        foreach (var uid in pending.UniqueIds)
                        {
                            var el = _uidoc.Document.GetElement(uid);
                            if (el != null) toSelect.Add(el.Id);
                        }
                    }

                    // 3) Last resort: treat the Onexus node id itself as a Revit UniqueId.
                    //    Spatial graph nodes (rooms, family instances, levels) use UniqueId
                    //    directly as their Onexus id, so this covers them even on graphs
                    //    exported before Phase 2 populated revitInstanceUids.
                    if (toSelect.Count == 0 && !string.IsNullOrEmpty(pending.NodeId))
                    {
                        try
                        {
                            var el = _uidoc.Document.GetElement(pending.NodeId);
                            if (el != null) toSelect.Add(el.Id);
                        }
                        catch { }
                    }

                    if (toSelect.Count > 0)
                    {
                        _uidoc.Selection.SetElementIds(toSelect);
                        // Only move the camera when the user explicitly asked (zoom-to-node)
                        if (pending.ShouldZoom)
                            _uidoc.ShowElements(toSelect);
                        didSelectFromPage = true;
                    }
                }

                // ── B) Push current Revit selection → Onexus page (throttled) ─
                if ((DateTime.Now - _lastSentAt).TotalMilliseconds < 300 && !didSelectFromPage)
                    return;

                var selectedIds = _uidoc.Selection.GetElementIds();
                var uids = selectedIds
                    .Select(id => _uidoc.Document.GetElement(id))
                    .Where(el => el != null)
                    .Select(el => el.UniqueId)
                    .Where(uid => !string.IsNullOrEmpty(uid))
                    .ToArray();

                if (!ArraysEqual(_lastSentUids, uids) || didSelectFromPage)
                {
                    var msg = new JObject
                    {
                        ["type"] = "highlight-nodes",
                        ["ids"]  = new JArray(uids)
                    };
                    Web.CoreWebView2.PostWebMessageAsJson(msg.ToString(Formatting.None));
                    _lastSentUids = uids;
                    _lastSentAt   = DateTime.Now;
                }

                // ── C) Process one pending document-change delta per Idling tick ─
                //    Processing one at a time keeps Revit responsive even under
                //    rapid model edits.  Larger bursts are naturally batched because
                //    DocumentChanged coalesces within a single transaction.
                if (_pendingDeltas.TryDequeue(out DeltaEntry delta))
                    ProcessDeltaEntry(delta);
            }
            catch { /* Idling must never throw */ }
        }

        // ══════════════════════════════════════════════════════════════════════
        //  Graph injection (called by OnexusPaneManager)
        // ══════════════════════════════════════════════════════════════════════

        /// <summary>
        /// Loads a graph into the Onexus web app.  If WebView2 is not yet
        /// navigated, the JSON is queued and injected after NavigationCompleted.
        /// </summary>
        public void LoadGraph(string json, int nodeCount = 0, int edgeCount = 0)
        {
            if (string.IsNullOrWhiteSpace(json)) return;

            if (_webReady)
                _ = InjectGraphAsync(json);   // fire-and-forget; awaited internally
            else
                _pendingJson = json;           // will be injected in OnNavigationCompleted
        }

        private async Task InjectGraphAsync(string json)
        {
            try
            {
                // Validate before sending (guards against accidentally injecting bad JSON)
                JToken.Parse(json);

                // Encode as Base64 so we don't have to escape anything inside ExecuteScriptAsync
                var b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(json));
                var js  = $"window.onexusReceiveGraph && window.onexusReceiveGraph('{b64}');";
                await Web.CoreWebView2.ExecuteScriptAsync(js);
            }
            catch { /* non-fatal — bad JSON or WebView2 not ready */ }
        }

        // ══════════════════════════════════════════════════════════════════════
        //  Boot script
        //
        //  Identical logic to the floating-window prototype so the same Onexus
        //  web app works in both contexts without any JS changes.
        // ══════════════════════════════════════════════════════════════════════

        private const string BootScript = @"
(function () {
  window.__pendingOnexusGraph = null;
  window.onexusReceiveGraph = function (b64) {
    window.__pendingOnexusGraph = b64 || null;
  };

  function b64ToUtf8Json(b64) {
    try {
      var bin   = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch (err) {
      console.error('[ONEXUS bridge] b64ToUtf8Json failed', err);
      return null;
    }
  }

  var tries = 0, maxTries = 150;
  var timer = setInterval(function () {
    try {
      if (typeof window.onexusLoadGraph === 'function' && window.__pendingOnexusGraph) {
        var obj = b64ToUtf8Json(window.__pendingOnexusGraph);
        if (obj) window.onexusLoadGraph(obj);
        window.__pendingOnexusGraph = null;
        clearInterval(timer);
      }
    } catch (e) { /* keep trying */ }
    if (++tries > maxTries) clearInterval(timer);
  }, 100);
})();
";

        // ══════════════════════════════════════════════════════════════════════
        //  Helpers
        // ══════════════════════════════════════════════════════════════════════

        private void ShowPlaceholder(string message)
        {
            Web.Visibility         = System.Windows.Visibility.Collapsed;
            PlaceholderText.Text   = message;
            PlaceholderText.Visibility = System.Windows.Visibility.Visible;
        }

        private static bool ArraysEqual(string[] a, string[] b)
        {
            if (ReferenceEquals(a, b)) return true;
            if (a == null || b == null || a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++)
                if (!string.Equals(a[i], b[i], StringComparison.Ordinal)) return false;
            return true;
        }

        // ── Inner types ────────────────────────────────────────────────────────

        private class PendingSelect
        {
            public string   NodeId     { get; set; }
            public int[]    ElementIds { get; set; }
            public string[] UniqueIds  { get; set; }
            /// <summary>
            /// True for zoom-to-node (right-click menu) — calls ShowElements.
            /// False for select-node (single click) — just highlights in Properties.
            /// </summary>
            public bool     ShouldZoom { get; set; }
        }
    }
}
