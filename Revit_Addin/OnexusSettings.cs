// بِسْــــــــــــــــــــــمِ اﷲِارَّحْمَنِ ارَّحِيم
// الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ
// Allâhumme salli alâ seyyidinâ Muhammedin ve alâ âli seyyidinâ Muhammed
//
// (C) Copyright 2020 by Onur Esen

using System;
using System.IO;
using Newtonsoft.Json;

namespace ONES
{
    /// <summary>
    /// Persists addin-level settings (e.g. the Onexus web folder path)
    /// to %APPDATA%\ONES\settings.json so they survive Revit restarts.
    /// </summary>
    public static class OnexusSettings
    {
        // ── Storage ────────────────────────────────────────────────────────────
        private static readonly string SettingsPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "ONES", "settings.json");

        private static SettingsData _cached;

        // ── Public properties ──────────────────────────────────────────────────

        /// <summary>Path to the folder that contains index.html of the Onexus web app.</summary>
        public static string OnexusFolder
        {
            get => Load().OnexusFolder;
            set { var s = Load(); s.OnexusFolder = value; Save(s); }
        }

        // ── Public helpers ─────────────────────────────────────────────────────

        /// <summary>
        /// Returns the configured Onexus folder.  If it has not been set yet (or
        /// the saved path no longer contains index.html), shows a FolderBrowserDialog
        /// so the user can locate it.  Returns null if the user cancels.
        /// </summary>
        public static string EnsureOnexusFolder()
        {
            var folder = Load().OnexusFolder;

            // Fast-path: already valid
            if (!string.IsNullOrWhiteSpace(folder) &&
                File.Exists(Path.Combine(folder, "index.html")))
                return folder;

            // Ask user
            using (var dlg = new System.Windows.Forms.FolderBrowserDialog())
            {
                dlg.Description = "Select your ONEXUS folder — the folder that contains index.html";
                dlg.ShowNewFolderButton = false;
                if (!string.IsNullOrWhiteSpace(folder) && Directory.Exists(folder))
                    dlg.SelectedPath = folder;

                if (dlg.ShowDialog() != System.Windows.Forms.DialogResult.OK)
                    return null;

                folder = dlg.SelectedPath;

                if (!File.Exists(Path.Combine(folder, "index.html")))
                {
                    System.Windows.MessageBox.Show(
                        "index.html was not found in the selected folder.\n" +
                        "Please select the root ONEXUS folder (the one that contains index.html).",
                        "ONEXUS — Folder Not Found",
                        System.Windows.MessageBoxButton.OK,
                        System.Windows.MessageBoxImage.Warning);
                    return null;
                }

                // Persist for next time
                OnexusFolder = folder;
                return folder;
            }
        }

        /// <summary>
        /// Clears the saved folder so the user is prompted again on next use.
        /// Useful from a "Change Onexus Folder" ribbon button.
        /// </summary>
        public static void ResetOnexusFolder()
        {
            OnexusFolder = null;
        }

        // ── Private helpers ────────────────────────────────────────────────────

        private static SettingsData Load()
        {
            if (_cached != null) return _cached;
            try
            {
                if (File.Exists(SettingsPath))
                {
                    var json = File.ReadAllText(SettingsPath, System.Text.Encoding.UTF8);
                    _cached = JsonConvert.DeserializeObject<SettingsData>(json) ?? new SettingsData();
                    return _cached;
                }
            }
            catch { /* corrupted file — use defaults */ }

            _cached = new SettingsData();
            return _cached;
        }

        private static void Save(SettingsData data)
        {
            _cached = data;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath));
                File.WriteAllText(
                    SettingsPath,
                    JsonConvert.SerializeObject(data, Formatting.Indented),
                    new System.Text.UTF8Encoding(false));
            }
            catch { /* non-fatal — settings just won't persist */ }
        }

        // ── Data model ─────────────────────────────────────────────────────────

        private class SettingsData
        {
            public string OnexusFolder { get; set; }
        }
    }
}
