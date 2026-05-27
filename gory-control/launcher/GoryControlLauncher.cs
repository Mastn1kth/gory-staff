using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class GoryControlLauncher
{
    [STAThread]
    private static void Main()
    {
        string script = FindControlScript();

        if (string.IsNullOrWhiteSpace(script) || !File.Exists(script))
        {
            MessageBox.Show(
                "Не найден файл панели управления:\n" +
                "gory-control\\GoryControl.ps1\n\n" +
                "Откройте приложение из папки проекта Gor Staff.",
                "Горы",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return;
        }

        string root = Directory.GetParent(Path.GetDirectoryName(script)).FullName;
        var startInfo = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -ExecutionPolicy Bypass -STA -File \"" + script + "\"",
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        try
        {
            Process.Start(startInfo);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Не удалось открыть панель управления.\n\n" + ex.Message,
                "Горы",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }

    private static string FindControlScript()
    {
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string[] roots =
        {
            AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar),
            Environment.CurrentDirectory,
            Path.Combine(desktop, "Gor Staff")
        };

        foreach (string root in roots)
        {
            if (string.IsNullOrWhiteSpace(root))
            {
                continue;
            }

            string candidate = Path.Combine(root, "gory-control", "GoryControl.ps1");
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        return null;
    }
}
