// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
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
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using Microsoft.Web.WebView2.Core;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Onexus
{
    public partial class OnexusViewerWindow : Window
    {
        private readonly string _indexHtmlPath;
        private string _graphJsonText;
        private bool _webReady;

        // Revit bridge fields
        private UIApplication _uiapp;
        private UIDocument _uidoc;
        private bool _selectionBridgeEnabled;
        private string[] _lastSentUids = new string[0];
        private DateTime _lastSentAt = DateTime.MinValue;

        public OnexusViewerWindow(string indexHtmlPath, string graphJsonText)
        {
            InitializeComponent();

            if (string.IsNullOrWhiteSpace(indexHtmlPath))
                throw new ArgumentNullException("indexHtmlPath");

            _indexHtmlPath = indexHtmlPath;
            _graphJsonText = string.IsNullOrWhiteSpace(graphJsonText) ? "{}" : graphJsonText;

            Loaded += OnLoaded;
            Closed += OnClosed;
        }

        public void LoadGraphJson(string graphJsonText)
        {
            _graphJsonText = string.IsNullOrWhiteSpace(graphJsonText) ? "{}" : graphJsonText;

            if (_webReady && Web?.CoreWebView2 != null)
                _ = InjectGraphAsync(_graphJsonText);
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            // Prepare WebView2
            string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ONEXUS", "WebView2");
            var env = await CoreWebView2Environment.CreateAsync(userDataFolder: dataDir);
            await Web.EnsureCoreWebView2Async(env);

            // --- Inject pre-document boot script (holds graph until loader exists) ---
            string boot = @"
                (function () {
                  window.__pendingOnexusGraph = null;
                  window.onexusReceiveGraph = function (b64) { window.__pendingOnexusGraph = b64 || null; };

                  function b64ToUtf8Json(b64) {
                    try {
                      var bin = atob(b64);
                      var len = bin.length;
                      var bytes = new Uint8Array(len);
                      for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
                      var txt = new TextDecoder('utf-8').decode(bytes);
                      return JSON.parse(txt);
                    } catch (e) { console.error('b64ToUtf8Json failed', e); return null; }
                  }

                  var tries = 0, max = 100;
                  var timer = setInterval(function () {
                    try {
                      if (window.onexusLoadGraph && typeof window.onexusLoadGraph === 'function'
                          && window.__pendingOnexusGraph) {
                        var obj = b64ToUtf8Json(window.__pendingOnexusGraph);
                        if (obj) window.onexusLoadGraph(obj);
                        window.__pendingOnexusGraph = null;
                        clearInterval(timer);
                      }
                    } catch (e) { /* keep trying */ }
                    if (++tries > max) clearInterval(timer);
                  }, 100);
                })();
            ";
            await Web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(boot);
            // -----------------------------------------------------------------------

            AttachWebBridgeHandlers();

            Web.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
            Web.Source = new Uri(_indexHtmlPath);
        }

        private void OnClosed(object sender, EventArgs e)
        {
            try
            {
                if (_uiapp != null)
                    _uiapp.Idling -= Uiapp_Idling;
            }
            catch { /* ignore */ }

            try { Web?.Dispose(); } catch { }
        }

        private async void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            try
            {
                if (!e.IsSuccess) return;


                // Ensure bridge (in case this is the first place CoreWebView2 became available)
                AttachWebBridgeHandlers();

                await InjectGraphAsync(_graphJsonText);
                _webReady = true;

                // #if DEBUG
                // Web.CoreWebView2.OpenDevToolsWindow();
                // #endif
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Failed to inject graph:\n" + ex.Message, "ONEXUS",
                    MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private async Task InjectGraphAsync(string graphJsonText)
        {
            if (Web?.CoreWebView2 == null) return;

            var json = string.IsNullOrWhiteSpace(graphJsonText) ? "{}" : graphJsonText;
            JToken.Parse(json);

            string b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(json));
            string js = "window.onexusReceiveGraph && window.onexusReceiveGraph('" + b64 + "');";
            await Web.CoreWebView2.ExecuteScriptAsync(js);
        }

        /// <summary>
        /// Enable two-way selection sync between page and Revit.
        /// </summary>
        public void EnableRevitSelectionBridge(Autodesk.Revit.UI.UIApplication uiapp)
        {
            _uiapp = uiapp ?? throw new ArgumentNullException(nameof(uiapp));
            _uidoc = _uiapp.ActiveUIDocument;

            if (_selectionBridgeEnabled)
            {
                AttachWebBridgeHandlers();
                return;
            }

            // Revit -> Page, throttled in Idling (already in your code)
            _uiapp.Idling += Uiapp_Idling;
            _selectionBridgeEnabled = true;

            // If WebView2 is already ready, attach immediately; otherwise OnLoaded/OnNavigationCompleted will attach.
            AttachWebBridgeHandlers();
        }

        public void UpdateDocument(UIDocument uidoc)
        {
            _uidoc = uidoc;
            _lastSentUids = Array.Empty<string>();
        }

        private void Uiapp_Idling(object sender, IdlingEventArgs e)
        {
            try
            {
                if (_uidoc == null || Web?.CoreWebView2 == null) return;

                bool anySelectionChanged = false;

                // A) Handle pending selections
                PendingSelect pending;
                while (_pendingNodeSelect.TryDequeue(out pending))
                {
                    if (pending == null) continue;

                    var toSelect = new List<ElementId>();

                    // 1) Prefer ElementIds for speed
                    if (pending.ElementIds != null && pending.ElementIds.Length > 0)
                    {
                        foreach (var i in pending.ElementIds)
                        {
                            var id = new ElementId(i);
                            if (id != ElementId.InvalidElementId)
                                toSelect.Add(id);
                        }
                    }
                    // 2) Fallback to UniqueIds if no ElementIds
                    if (toSelect.Count == 0 && pending.UniqueIds != null && pending.UniqueIds.Length > 0)
                    {
                        foreach (var uid in pending.UniqueIds)
                        {
                            var el = _uidoc.Document.GetElement(uid);
                            if (el != null) toSelect.Add(el.Id);
                        }
                    }

                    if (toSelect.Count > 0)
                    {
                        _uidoc.Selection.SetElementIds(toSelect);
                        _uidoc.ShowElements(toSelect);
                        anySelectionChanged = true;
                    }
                }

                // B) Push current Revit selection → page (throttled)
                if ((DateTime.Now - _lastSentAt).TotalMilliseconds < 300 && !anySelectionChanged) return;

                var ids = _uidoc.Selection.GetElementIds();
                var uids = ids
                    .Select(id => _uidoc.Document.GetElement(id))
                    .Where(el => el != null)
                    .Select(el => el.UniqueId)
                    .Where(uid => !string.IsNullOrEmpty(uid))
                    .ToArray();

                if (!SequenceEqual(_lastSentUids, uids) || anySelectionChanged)
                {
                    var payload = new JObject
                    {
                        ["type"] = "highlight-nodes",
                        ["ids"] = new JArray(uids)
                    };
                    Web.CoreWebView2.PostWebMessageAsJson(payload.ToString(Formatting.None));
                    _lastSentUids = uids;
                    _lastSentAt = DateTime.Now;
                }
            }
            catch { /* ignore */ }
        }

        private static bool SequenceEqual(string[] a, string[] b)
        {
            if (ReferenceEquals(a, b)) return true;
            if (a == null || b == null) return false;
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++)
                if (!string.Equals(a[i], b[i], StringComparison.Ordinal)) return false;
            return true;
        }

        // Factory helpers (unchanged from earlier)
        public static OnexusViewerWindow CreateFromGraphJson(string onexusFolder, string graphJsonText)
        {
            var indexHtml = Path.Combine(onexusFolder, "index.html");
            if (!File.Exists(indexHtml))
                throw new FileNotFoundException("ONEXUS index.html not found", indexHtml);
            return new OnexusViewerWindow(indexHtml, graphJsonText);
        }

        public static OnexusViewerWindow CreateFromSavedFile(string onexusFolder, string savedJsonPath)
        {
            var indexHtml = Path.Combine(onexusFolder, "index.html");
            if (!File.Exists(indexHtml))
                throw new FileNotFoundException("ONEXUS index.html not found", indexHtml);
            if (!File.Exists(savedJsonPath))
                throw new FileNotFoundException("Exported JSON not found", savedJsonPath);

            var json = File.ReadAllText(savedJsonPath, Encoding.UTF8);
            return new OnexusViewerWindow(indexHtml, json);
        }

        // Add these fields at class scope
        private bool _webBridgeAttached = false;

        // Call this after CoreWebView2 is available
        private void AttachWebBridgeHandlers()
        {
            if (_webBridgeAttached) return;
            if (Web == null || Web.CoreWebView2 == null) return;

            // Page -> Revit: handle node clicks (select-node)
            Web.CoreWebView2.WebMessageReceived += (s, args) =>
            {
                try
                {
                    var json = args.TryGetWebMessageAsString();
                    if (string.IsNullOrEmpty(json)) json = args.WebMessageAsJson;
                    if (string.IsNullOrEmpty(json)) return;

                    var root = JObject.Parse(json);
                    var type = (string)root["type"];
                    if (!string.Equals(type, "select-node", StringComparison.OrdinalIgnoreCase)) return;

                    var nodeId = (string)root["id"];
                    var idsJ = root["revitInstanceIds"] as JArray;
                    var uidsJ = root["revitInstanceUids"] as JArray;

                    var model = new PendingSelect
                    {
                        NodeId = nodeId,
                        ElementIds = idsJ != null ? idsJ.Select(x => (int)x).ToArray() : Array.Empty<int>(),
                        UniqueIds = uidsJ != null ? uidsJ.Select(x => (string)x).Where(st => !string.IsNullOrEmpty(st)).ToArray()
                                                   : Array.Empty<string>()
                    };
                    _pendingNodeSelect.Enqueue(model);
                }
                catch { /* ignore malformed */ }
            };

            _webBridgeAttached = true;
        }

        class PendingSelect
        {
            public string NodeId { get; set; }
            public int[] ElementIds { get; set; }
            public string[] UniqueIds { get; set; }
        }

        private readonly ConcurrentQueue<PendingSelect> _pendingNodeSelect = new ConcurrentQueue<PendingSelect>();

    }
}
