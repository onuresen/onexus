// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System;
using System.IO;
using System.Text;
using System.Windows;
using Autodesk.Revit.UI;
using Newtonsoft.Json;

namespace Onexus
{
    public static class OnexusViewer
    {
        public static void Show(UIApplication uiapp, string onexusFolder, OnexusGraph graph)
        {
            string json = JsonConvert.SerializeObject(graph, Formatting.Indented);
            Show(uiapp, onexusFolder, json);
        }

        public static void Show(UIApplication uiapp, string onexusFolder, string jsonText)
        {
            var win = OnexusViewerWindow.CreateFromGraphJson(onexusFolder, jsonText);

            // Hook selection sync both ways
            win.EnableRevitSelectionBridge(uiapp);

            // Bind owner (optional)
            try
            {
                var revitHandle = uiapp.MainWindowHandle;
                if (revitHandle != IntPtr.Zero)
                {
                    var helper = new System.Windows.Interop.WindowInteropHelper(win) { Owner = revitHandle };
                }
            }
            catch { /* ignore */ }

            win.Show(); // modeless
        }

        public static void ShowFromFile(UIApplication uiapp, string onexusFolder, string exportedJsonPath)
        {
            var win = OnexusViewerWindow.CreateFromSavedFile(onexusFolder, exportedJsonPath);

            // Hook selection sync both ways
            win.EnableRevitSelectionBridge(uiapp);

            try
            {
                var revitHandle = uiapp.MainWindowHandle;
                if (revitHandle != IntPtr.Zero)
                {
                    var helper = new System.Windows.Interop.WindowInteropHelper(win) { Owner = revitHandle };
                }
            }
            catch { /* ignore */ }

            win.Show();
        }
    }
}
