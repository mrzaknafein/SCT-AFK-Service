using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("SCT AFK Service Kurulum Sihirbazı")]
[assembly: AssemblyDescription("SCT AFK Service - Minecraft Multi-Account & AFK Bot Kurulum Aracı")]
[assembly: AssemblyCompany("SCT AFK Service")]
[assembly: AssemblyProduct("SCT AFK Service Setup")]
[assembly: AssemblyCopyright("Copyright © 2026 SCT AFK Service")]
[assembly: AssemblyVersion("2.4.4.0")]
[assembly: AssemblyFileVersion("2.4.4.0")]

namespace SctAfkService.Setup
{
    internal static class Program
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool DeleteFile(string name);

        [DllImport("user32.dll")]
        public static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        public static extern int SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern void SHChangeNotify(int wEventId, uint uFlags, string dwItem1, IntPtr dwItem2);

        [DllImport("shell32.dll", SetLastError = true)]
        public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

        [STAThread]
        private static void Main(string[] args)
        {
            // Kendi üzerindeki ve klasöründeki tüm Mark-of-the-Web (Zone.Identifier) engellerini temizle
            try
            {
                RemoveMarkOfTheWeb(Application.ExecutablePath);
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                if (!string.IsNullOrEmpty(baseDir) && Directory.Exists(baseDir))
                {
                    foreach (string f in Directory.GetFiles(baseDir))
                    {
                        RemoveMarkOfTheWeb(f);
                    }
                }
            }
            catch { }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (args != null && args.Length > 0 && args[0].Equals("--uninstall", StringComparison.OrdinalIgnoreCase))
            {
                RunUninstaller();
                return;
            }

            Application.Run(new SetupWizardForm());
        }

        public static void RemoveMarkOfTheWeb(string filePath)
        {
            try
            {
                if (File.Exists(filePath))
                {
                    DeleteFile(filePath + ":Zone.Identifier");
                }
            }
            catch { }
        }

        public static void RefreshShell(string path = null)
        {
            try
            {
                if (!string.IsNullOrEmpty(path) && File.Exists(path))
                {
                    SHChangeNotify(0x00002000, 0x1005, path, IntPtr.Zero);
                }
                SHChangeNotify(0x08000000, 0x1000, IntPtr.Zero, IntPtr.Zero);
            }
            catch { }
        }

        public static void CreateShortcut(string shortcutPath, string targetExePath, string description, string iconPath)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                object shell = Activator.CreateInstance(shellType);
                object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
                Type shortcutType = shortcut.GetType();
                shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetExePath });
                shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { Path.GetDirectoryName(targetExePath) });
                shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
                
                string icoLoc = (!string.IsNullOrEmpty(iconPath) && File.Exists(iconPath)) ? (iconPath.EndsWith(".ico", StringComparison.OrdinalIgnoreCase) ? iconPath : (iconPath + ",0")) : (targetExePath + ",0");
                shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { icoLoc });
                
                shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
                RemoveMarkOfTheWeb(shortcutPath);
            }
            catch { }
        }

        public static string FindNodeJs()
        {
            string[] candidates = new string[]
            {
                Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "nodejs", "node.exe"),
                Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "node.exe"),
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe")
            };

            foreach (string c in candidates)
            {
                if (File.Exists(c)) return c;
            }

            // Kurulum sonrasi process PATH guncellenmemis olabilir; Machine ve User PATH kayitlarini da kontrol et
            string pathEnv = (Environment.GetEnvironmentVariable("PATH") ?? "") + ";" +
                             (Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.Machine) ?? "") + ";" +
                             (Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User) ?? "");
            foreach (string p in pathEnv.Split(';'))
            {
                try
                {
                    string t = Environment.ExpandEnvironmentVariables(p.Trim().Trim('"'));
                    if (string.IsNullOrEmpty(t)) continue;
                    string full = Path.Combine(t, "node.exe");
                    if (File.Exists(full)) return full;
                }
                catch { }
            }

            return null;
        }

        public static void InstallNodeJs(Action<string> statusCallback)
        {
            try
            {
                if (statusCallback != null) statusCallback("Node.js LTS paketi taranıyor (winget)...");
                try
                {
                    ProcessStartInfo wingetPsi = new ProcessStartInfo
                    {
                        FileName = "winget",
                        Arguments = "install OpenJS.NodeJS.LTS -e --silent --disable-interactivity --accept-source-agreements --accept-package-agreements",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden
                    };
                    using (Process p = Process.Start(wingetPsi))
                    {
                        if (p != null)
                        {
                            p.WaitForExit(180000);
                            if (p.ExitCode == 0 && !string.IsNullOrEmpty(FindNodeJs())) return;
                        }
                    }
                }
                catch { }

                try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; } catch { }

                string arch = "x64";
                try
                {
                    string pa = (Environment.GetEnvironmentVariable("PROCESSOR_ARCHITEW6432") ?? Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "").ToUpperInvariant();
                    if (pa == "ARM64") arch = "arm64";
                    else if (!Environment.Is64BitOperatingSystem) arch = "x86";
                }
                catch { }

                string[] versions = new string[] { "v22.11.0", "v20.18.0" };
                string tempMsi = Path.Combine(Path.GetTempPath(), "sct-node-lts-" + arch + ".msi");

                foreach (string ver in versions)
                {
                    string url = "https://nodejs.org/dist/" + ver + "/node-" + ver + "-" + arch + ".msi";
                    try
                    {
                        if (statusCallback != null) statusCallback("Resmi Node.js " + ver + " indiriliyor (nodejs.org)...");
                        try { if (File.Exists(tempMsi)) File.Delete(tempMsi); } catch { }

                        using (WebClient wc = new WebClient())
                        {
                            wc.DownloadFile(url, tempMsi);
                        }

                        if (File.Exists(tempMsi) && new FileInfo(tempMsi).Length > 1000000)
                        {
                            if (statusCallback != null) statusCallback("Node.js " + ver + " kuruluyor (Lütfen bekleyin)...");
                            ProcessStartInfo msiPsi = new ProcessStartInfo
                            {
                                FileName = "msiexec.exe",
                                Arguments = string.Format("/i \"{0}\" /passive /norestart", tempMsi),
                                UseShellExecute = true
                            };
                            using (Process p = Process.Start(msiPsi))
                            {
                                if (p != null) p.WaitForExit(600000);
                            }
                            try { File.Delete(tempMsi); } catch { }
                            Thread.Sleep(1500);

                            if (!string.IsNullOrEmpty(FindNodeJs())) return;
                        }
                    }
                    catch { }
                }
            }
            catch { }
        }

        private static void RunUninstaller()
        {
            DialogResult dr = MessageBox.Show(
                "SCT AFK Service uygulamasını ve tüm kısayollarını bilgisayarınızdan kaldırmak istediğinize emin misiniz?",
                "SCT AFK Service - Kaldırma Onayı",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question
            );

            if (dr != DialogResult.Yes) return;

            try
            {
                // Varsa çalışan servisleri durdur
                foreach (Process p in Process.GetProcessesByName("SCT AFK Service"))
                {
                    try { p.Kill(); } catch { }
                }

                // Kısayolları sil
                string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "SCT AFK Service.lnk");
                if (File.Exists(desktopLnk)) File.Delete(desktopLnk);

                string startMenuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "SCT AFK Service");
                if (Directory.Exists(startMenuDir)) Directory.Delete(startMenuDir, true);

                // Registry kaydını sil
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\SctAfkService", false);

                // Kaldırma scripti ile kendi klasörünü sil
                string currentDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
                string batFile = Path.Combine(Path.GetTempPath(), "sct_uninstall.bat");
                File.WriteAllText(batFile, string.Format(
                    "@echo off\r\nping 127.0.0.1 -n 2 > nul\r\nrmdir /S /Q \"{0}\"\r\ndel \"%~f0\"\r\n",
                    currentDir
                ), Encoding.Default);

                Process.Start(new ProcessStartInfo
                {
                    FileName = batFile,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    CreateNoWindow = true
                });

                RefreshShell();

                MessageBox.Show(
                    "SCT AFK Service başarıyla bilgisayarınızdan kaldırıldı.",
                    "SCT AFK Service Kaldırıldı",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
            catch (Exception ex)
            {
                MessageBox.Show("Kaldırma sırasında bir hata oluştu: " + ex.Message, "Hata", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    public class SetupWizardForm : Form
    {
        private int currentStep = 0; // 0: Welcome, 1: Directory & Options, 2: Installing, 3: Finished
        private Panel headerPanel;
        private Panel contentPanel;
        private Panel footerPanel;

        private Button btnBack;
        private Button btnNext;
        private Button btnCancel;

        // Step 1 controls
        private TextBox txtInstallDir;
        private CheckBox chkDesktopShortcut;
        private CheckBox chkStartMenuShortcut;
        private CheckBox chkOptimizeSecurity;
        private CheckBox chkInstallNode;

        // Step 2 controls
        private Label lblInstallStatus;
        private ProgressBar prgInstall;

        // Step 3 controls
        private CheckBox chkLaunchNow;

        private Image logoImage = null;
        private Icon appIcon = null;

        private string targetInstallPath;

        public SetupWizardForm()
        {
            this.Text = "SCT AFK Service Kurulum Sihirbazı";
            this.Size = new Size(580, 430);
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(15, 31, 22);
            this.ForeColor = Color.FromArgb(244, 239, 230);
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            this.DoubleBuffered = true;

            LoadResources();

            if (this.appIcon != null)
            {
                this.Icon = this.appIcon;
            }

            string defaultDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs",
                "SCT AFK Service"
            );
            targetInstallPath = defaultDir;

            InitializeLayout();
            ShowStep(0);
        }

        private void LoadResources()
        {
            try
            {
                Assembly asm = Assembly.GetExecutingAssembly();
                using (Stream stream = asm.GetManifestResourceStream("sct.logo.jpg"))
                {
                    if (stream != null)
                    {
                        logoImage = Image.FromStream(stream);
                    }
                }
                using (Stream stream = asm.GetManifestResourceStream("sct.app.ico"))
                {
                    if (stream != null)
                    {
                        appIcon = new Icon(stream);
                    }
                }
            }
            catch { }
        }

        private void InitializeLayout()
        {
            // 1. Header (Custom title bar & branding)
            headerPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = 62,
                BackColor = Color.FromArgb(21, 43, 30)
            };
            headerPanel.MouseDown += OnTitleBarMouseDown;

            PictureBox picLogo = new PictureBox
            {
                Size = new Size(38, 38),
                Location = new Point(16, 12),
                SizeMode = PictureBoxSizeMode.Zoom,
                Image = logoImage,
                BackColor = Color.Transparent
            };
            try
            {
                GraphicsPath circlePath = new GraphicsPath();
                circlePath.AddEllipse(0, 0, 38, 38);
                picLogo.Region = new Region(circlePath);
            }
            catch { }
            picLogo.MouseDown += OnTitleBarMouseDown;
            headerPanel.Controls.Add(picLogo);

            Label lblTitle = new Label
            {
                Text = "SCT AFK Service",
                Font = new Font("Segoe UI", 12f, FontStyle.Bold),
                ForeColor = Color.FromArgb(232, 220, 196),
                Location = new Point(62, 11),
                AutoSize = true
            };
            lblTitle.MouseDown += OnTitleBarMouseDown;
            headerPanel.Controls.Add(lblTitle);

            Label lblSub = new Label
            {
                Text = "Kurulum Sihirbazı • v2.4.4 (Native Masaüstü GUI & Çoklu Hesap)",
                Font = new Font("Segoe UI", 8.5f, FontStyle.Regular),
                ForeColor = Color.FromArgb(183, 173, 155),
                Location = new Point(63, 34),
                AutoSize = true
            };
            lblSub.MouseDown += OnTitleBarMouseDown;
            headerPanel.Controls.Add(lblSub);

            // Kapat & Simge Durumu Butonları
            Button btnClose = new Button
            {
                Text = "✕",
                Size = new Size(32, 28),
                Location = new Point(this.Width - 38, 8),
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.FromArgb(156, 163, 175),
                BackColor = Color.Transparent,
                Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold)
            };
            btnClose.FlatAppearance.BorderSize = 0;
            btnClose.MouseEnter += (s, e) => { btnClose.BackColor = Color.FromArgb(239, 68, 68); btnClose.ForeColor = Color.White; };
            btnClose.MouseLeave += (s, e) => { btnClose.BackColor = Color.Transparent; btnClose.ForeColor = Color.FromArgb(156, 163, 175); };
            btnClose.Click += (s, e) => this.Close();
            headerPanel.Controls.Add(btnClose);

            Button btnMin = new Button
            {
                Text = "—",
                Size = new Size(32, 28),
                Location = new Point(this.Width - 72, 8),
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.FromArgb(156, 163, 175),
                BackColor = Color.Transparent,
                Cursor = Cursors.Hand,
                Font = new Font("Segoe UI", 8f)
            };
            btnMin.FlatAppearance.BorderSize = 0;
            btnMin.MouseEnter += (s, e) => { btnMin.BackColor = Color.FromArgb(35, 39, 50); };
            btnMin.MouseLeave += (s, e) => { btnMin.BackColor = Color.Transparent; };
            btnMin.Click += (s, e) => this.WindowState = FormWindowState.Minimized;
            headerPanel.Controls.Add(btnMin);

            this.Controls.Add(headerPanel);

            // 2. Footer (Navigasyon Butonları)
            footerPanel = new Panel
            {
                Dock = DockStyle.Bottom,
                Height = 58,
                BackColor = Color.FromArgb(21, 43, 30)
            };

            btnCancel = CreateStyledButton("İptal", false);
            btnCancel.Location = new Point(this.Width - 100, 14);
            btnCancel.Click += (s, e) => this.Close();
            footerPanel.Controls.Add(btnCancel);

            btnNext = CreateStyledButton("İleri >", true);
            btnNext.Location = new Point(this.Width - 210, 14);
            btnNext.Click += OnNextClick;
            footerPanel.Controls.Add(btnNext);

            btnBack = CreateStyledButton("< Geri", false);
            btnBack.Location = new Point(this.Width - 310, 14);
            btnBack.Click += OnBackClick;
            btnBack.Visible = false;
            footerPanel.Controls.Add(btnBack);

            this.Controls.Add(footerPanel);

            // 3. Content Panel
            contentPanel = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(15, 31, 22),
                Padding = new Padding(24, 18, 24, 18)
            };
            this.Controls.Add(contentPanel);
            contentPanel.BringToFront();
        }

        private void OnTitleBarMouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                Program.ReleaseCapture();
                Program.SendMessage(this.Handle, 0xA1, 0x2, 0);
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            // Dış kenarlık
            using (Pen pen = new Pen(Color.FromArgb(40, 45, 58), 1))
            {
                e.Graphics.DrawRectangle(pen, 0, 0, this.Width - 1, this.Height - 1);
            }
        }

        private Button CreateStyledButton(string text, bool isPrimary)
        {
            Button btn = new Button
            {
                Text = text,
                Size = new Size(92, 32),
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btn.FlatAppearance.BorderSize = 0;

            if (isPrimary)
            {
                btn.BackColor = Color.FromArgb(139, 92, 246);
                btn.ForeColor = Color.FromArgb(248, 245, 238);
                btn.MouseEnter += (s, e) => btn.BackColor = Color.FromArgb(124, 58, 237);
                btn.MouseLeave += (s, e) => btn.BackColor = Color.FromArgb(139, 92, 246);
            }
            else
            {
                btn.BackColor = Color.FromArgb(31, 61, 43);
                btn.ForeColor = Color.FromArgb(232, 220, 196);
                btn.MouseEnter += (s, e) => btn.BackColor = Color.FromArgb(39, 77, 54);
                btn.MouseLeave += (s, e) => btn.BackColor = Color.FromArgb(31, 61, 43);
            }

            return btn;
        }

        private void ShowStep(int step)
        {
            currentStep = step;
            contentPanel.Controls.Clear();

            switch (step)
            {
                case 0:
                    BuildWelcomeStep();
                    btnBack.Visible = false;
                    btnNext.Text = "İleri >";
                    btnNext.Enabled = true;
                    btnCancel.Visible = true;
                    break;
                case 1:
                    BuildOptionsStep();
                    btnBack.Visible = true;
                    btnNext.Text = "Kurulumu Yap";
                    btnNext.Enabled = true;
                    btnCancel.Visible = true;
                    break;
                case 2:
                    BuildInstallingStep();
                    btnBack.Visible = false;
                    btnNext.Enabled = false;
                    btnCancel.Visible = false;
                    StartInstallationProcess();
                    break;
                case 3:
                    BuildFinishedStep();
                    btnBack.Visible = false;
                    btnNext.Text = "Bitir";
                    btnNext.Enabled = true;
                    btnCancel.Visible = false;
                    break;
            }
        }

        private void BuildWelcomeStep()
        {
            Label lblHeader = new Label
            {
                Text = "SCT AFK Service Kurulumuna Hoş Geldiniz",
                Font = new Font("Segoe UI", 13.5f, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(20, 10),
                AutoSize = true
            };
            contentPanel.Controls.Add(lblHeader);

            Label lblDesc = new Label
            {
                Text = "Bu sihirbaz, SCT AFK Service'i bilgisayarınıza güvenli bir şekilde kuracak,\r\nSmartScreen engellerini kaldıracak ve masaüstünüze şık bir kısayol ekleyecektir.",
                Font = new Font("Segoe UI", 9.5f),
                ForeColor = Color.FromArgb(156, 163, 175),
                Location = new Point(22, 42),
                Size = new Size(520, 38)
            };
            contentPanel.Controls.Add(lblDesc);

            // Özellikler Kartı
            Panel card = new Panel
            {
                Location = new Point(20, 92),
                Size = new Size(530, 140),
                BackColor = Color.FromArgb(19, 22, 30)
            };
            card.Paint += (s, e) =>
            {
                using (Pen p = new Pen(Color.FromArgb(38, 43, 58)))
                {
                    e.Graphics.DrawRectangle(p, 0, 0, card.Width - 1, card.Height - 1);
                }
            };

            string[] features = new string[]
            {
                "✔  Maksimum 3 Hesap Ücretsiz (STARTER Sürüm)",
                "✔  Gelişmiş Koruma, Can Koruması & Anti-Cheat Paket Gizleme",
                "✔  2D / 3D Canlı Çevre Radarı & Manuel Yönlendirme (WASD)",
                "✔  Schematica / Litematica Otomatik Çiftlik İnşası (Auto-Builder)"
            };

            int fY = 14;
            foreach (string feat in features)
            {
                Label lblF = new Label
                {
                    Text = feat,
                    ForeColor = Color.FromArgb(229, 231, 235),
                    Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                    Location = new Point(18, fY),
                    AutoSize = true
                };
                card.Controls.Add(lblF);
                fY += 28;
            }
            contentPanel.Controls.Add(card);

            // Node.js durum bilgisi
            string nodePath = Program.FindNodeJs();
            bool hasNode = !string.IsNullOrEmpty(nodePath);

            Label lblNodeStatus = new Label
            {
                Text = hasNode ? "✔  Node.js LTS Çalışma Ortamı Algılandı (Hazır)" : "⚡  Node.js algılanamadı (Kurulum sırasında otomatik olarak indirilecek ve kurulacaktır)",
                ForeColor = hasNode ? Color.FromArgb(74, 222, 128) : Color.FromArgb(250, 204, 21),
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                Location = new Point(22, 244),
                AutoSize = true
            };
            contentPanel.Controls.Add(lblNodeStatus);

            Label lblPrompt = new Label
            {
                Text = "Kuruluma devam etmek için 'İleri >' butonuna tıklayın.",
                ForeColor = Color.FromArgb(156, 163, 175),
                Font = new Font("Segoe UI", 9f),
                Location = new Point(22, 275),
                AutoSize = true
            };
            contentPanel.Controls.Add(lblPrompt);
        }

        private void BuildOptionsStep()
        {
            Label lblHeader = new Label
            {
                Text = "Kurulum Konumu ve Kısayol Seçenekleri",
                Font = new Font("Segoe UI", 13f, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(20, 10),
                AutoSize = true
            };
            contentPanel.Controls.Add(lblHeader);

            Label lblSub = new Label
            {
                Text = "Uygulamanın kurulacağı hedef klasörü ve ek seçenekleri belirleyin:",
                ForeColor = Color.FromArgb(156, 163, 175),
                Location = new Point(22, 40),
                AutoSize = true
            };
            contentPanel.Controls.Add(lblSub);

            // Dizin seçimi
            Label lblDir = new Label
            {
                Text = "Hedef Kurulum Klasörü:",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(229, 231, 235),
                Location = new Point(22, 68),
                AutoSize = true
            };
            contentPanel.Controls.Add(lblDir);

            txtInstallDir = new TextBox
            {
                Text = targetInstallPath,
                Location = new Point(22, 92),
                Size = new Size(420, 26),
                BackColor = Color.FromArgb(24, 28, 38),
                ForeColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Segoe UI", 9.5f)
            };
            contentPanel.Controls.Add(txtInstallDir);

            Button btnBrowse = CreateStyledButton("Gözat...", false);
            btnBrowse.Location = new Point(452, 90);
            btnBrowse.Size = new Size(95, 28);
            btnBrowse.Click += (s, e) =>
            {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog())
                {
                    fbd.Description = "SCT AFK Service Kurulum Klasörünü Seçin";
                    fbd.SelectedPath = txtInstallDir.Text;
                    if (fbd.ShowDialog() == DialogResult.OK)
                    {
                        txtInstallDir.Text = fbd.SelectedPath;
                    }
                }
            };
            contentPanel.Controls.Add(btnBrowse);

            // Seçenekler
            chkDesktopShortcut = new CheckBox
            {
                Text = "Masaüstüne SCT AFK Service kısayolu oluştur",
                Checked = true,
                Location = new Point(25, 132),
                AutoSize = true,
                ForeColor = Color.FromArgb(229, 231, 235),
                Font = new Font("Segoe UI", 9.5f)
            };
            contentPanel.Controls.Add(chkDesktopShortcut);

            chkStartMenuShortcut = new CheckBox
            {
                Text = "Windows Başlat Menüsüne program kısayolu ekle",
                Checked = true,
                Location = new Point(25, 162),
                AutoSize = true,
                ForeColor = Color.FromArgb(229, 231, 235),
                Font = new Font("Segoe UI", 9.5f)
            };
            contentPanel.Controls.Add(chkStartMenuShortcut);

            chkOptimizeSecurity = new CheckBox
            {
                Text = "SmartScreen ve Windows İnternet kısıtlamalarını otomatik kaldır (Önerilen)",
                Checked = true,
                Location = new Point(25, 192),
                AutoSize = true,
                ForeColor = Color.FromArgb(74, 222, 128),
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold)
            };
            contentPanel.Controls.Add(chkOptimizeSecurity);

            bool isNodeMissing = string.IsNullOrEmpty(Program.FindNodeJs());
            chkInstallNode = new CheckBox
            {
                Text = isNodeMissing ? "Eksik Node.js LTS çalışma ortamını otomatik kur (Gerekli)" : "Node.js LTS çalışma ortamı sistemde mevcut (Hazır)",
                Checked = isNodeMissing,
                Enabled = isNodeMissing,
                Location = new Point(25, 222),
                AutoSize = true,
                ForeColor = isNodeMissing ? Color.FromArgb(250, 204, 21) : Color.FromArgb(156, 163, 175),
                Font = new Font("Segoe UI", 9.5f, isNodeMissing ? FontStyle.Bold : FontStyle.Regular)
            };
            contentPanel.Controls.Add(chkInstallNode);
        }

        private void BuildInstallingStep()
        {
            Label lblHeader = new Label
            {
                Text = "SCT AFK Service Kuruluyor...",
                Font = new Font("Segoe UI", 13.5f, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(20, 20),
                AutoSize = true
            };
            contentPanel.Controls.Add(lblHeader);

            lblInstallStatus = new Label
            {
                Text = "Kurulum hazırlanıyor...",
                ForeColor = Color.FromArgb(156, 163, 175),
                Font = new Font("Segoe UI", 9.5f),
                Location = new Point(22, 60),
                Size = new Size(520, 24)
            };
            contentPanel.Controls.Add(lblInstallStatus);

            prgInstall = new ProgressBar
            {
                Location = new Point(22, 95),
                Size = new Size(525, 22),
                Minimum = 0,
                Maximum = 100,
                Value = 0,
                Style = ProgressBarStyle.Continuous
            };
            contentPanel.Controls.Add(prgInstall);

            Label lblTip = new Label
            {
                Text = "Lütfen kurulum sihirbazı dosyaları sisteme kaydederken bekleyin.\r\nBu işlem genellikle birkaç saniye sürer.",
                ForeColor = Color.FromArgb(107, 114, 128),
                Font = new Font("Segoe UI", 9f),
                Location = new Point(22, 135),
                Size = new Size(520, 36)
            };
            contentPanel.Controls.Add(lblTip);
        }

        private void BuildFinishedStep()
        {
            Label lblHeader = new Label
            {
                Text = "✔  Kurulum Başarıyla Tamamlandı!",
                Font = new Font("Segoe UI", 14f, FontStyle.Bold),
                ForeColor = Color.FromArgb(74, 222, 128),
                Location = new Point(20, 25),
                AutoSize = true
            };
            contentPanel.Controls.Add(lblHeader);

            Label lblDesc = new Label
            {
                Text = "SCT AFK Service bilgisayarınıza başarıyla kuruldu.\r\nMasaüstünüzdeki kısayola tıklayarak istediğiniz zaman başlatabilirsiniz.",
                ForeColor = Color.FromArgb(209, 213, 219),
                Font = new Font("Segoe UI", 10f),
                Location = new Point(22, 68),
                Size = new Size(520, 48)
            };
            contentPanel.Controls.Add(lblDesc);

            Panel infoCard = new Panel
            {
                Location = new Point(22, 125),
                Size = new Size(525, 90),
                BackColor = Color.FromArgb(19, 22, 30)
            };
            infoCard.Paint += (s, e) =>
            {
                using (Pen p = new Pen(Color.FromArgb(38, 43, 58)))
                {
                    e.Graphics.DrawRectangle(p, 0, 0, infoCard.Width - 1, infoCard.Height - 1);
                }
            };

            Label lblDest = new Label
            {
                Text = "Kurulum Konumu: " + targetInstallPath,
                ForeColor = Color.FromArgb(156, 163, 175),
                Font = new Font("Segoe UI", 9f),
                Location = new Point(14, 12),
                Size = new Size(500, 20)
            };
            infoCard.Controls.Add(lblDest);

            Label lblProt = new Label
            {
                Text = "Güvenlik: SmartScreen engeli ve internet damgası (MotW) kaldırıldı.",
                ForeColor = Color.FromArgb(74, 222, 128),
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                Location = new Point(14, 34),
                Size = new Size(500, 20)
            };
            infoCard.Controls.Add(lblProt);

            Label lblUn = new Label
            {
                Text = "Kaldırma: Windows Ayarlar > Yüklü Uygulamalar bölümünden kaldırabilirsiniz.",
                ForeColor = Color.FromArgb(156, 163, 175),
                Font = new Font("Segoe UI", 8.5f),
                Location = new Point(14, 58),
                Size = new Size(500, 20)
            };
            infoCard.Controls.Add(lblUn);

            contentPanel.Controls.Add(infoCard);

            chkLaunchNow = new CheckBox
            {
                Text = "SCT AFK Service uygulamasını hemen başlat",
                Checked = true,
                Location = new Point(25, 235),
                AutoSize = true,
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 10f, FontStyle.Bold)
            };
            contentPanel.Controls.Add(chkLaunchNow);
        }

        private void OnNextClick(object sender, EventArgs e)
        {
            if (currentStep == 0)
            {
                ShowStep(1);
            }
            else if (currentStep == 1)
            {
                targetInstallPath = txtInstallDir.Text.Trim();
                if (string.IsNullOrEmpty(targetInstallPath))
                {
                    MessageBox.Show("Lütfen geçerli bir kurulum klasörü belirtin.", "Uyarı", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                ShowStep(2);
            }
            else if (currentStep == 3)
            {
                if (chkLaunchNow != null && chkLaunchNow.Checked)
                {
                    string targetExe = Path.Combine(targetInstallPath, "SCT AFK Service.exe");
                    if (File.Exists(targetExe))
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = targetExe,
                            WorkingDirectory = targetInstallPath
                        });
                    }
                }
                this.Close();
            }
        }

        private void OnBackClick(object sender, EventArgs e)
        {
            if (currentStep == 1)
            {
                ShowStep(0);
            }
        }

        private void StartInstallationProcess()
        {
            Thread installThread = new Thread(RunInstallWorker);
            installThread.IsBackground = true;
            installThread.Start();
        }

        private void SetInstallStatus(string text, int progress)
        {
            if (this.InvokeRequired)
            {
                this.BeginInvoke(new Action(() => SetInstallStatus(text, progress)));
                return;
            }
            if (lblInstallStatus != null) lblInstallStatus.Text = text;
            if (prgInstall != null)
            {
                if (progress > 100) progress = 100;
                if (progress < 0) progress = 0;
                prgInstall.Value = progress;
            }
        }

        private void RunInstallWorker()
        {
            try
            {
                SetInstallStatus("Hedef klasör hazırlanıyor...", 10);
                Thread.Sleep(200);
                if (!Directory.Exists(targetInstallPath))
                {
                    Directory.CreateDirectory(targetInstallPath);
                }

                // 1. Node.js eksikse ve checkbox işaretliyse otomatik kur
                if (chkInstallNode != null && chkInstallNode.Checked)
                {
                    string existingNode = Program.FindNodeJs();
                    if (string.IsNullOrEmpty(existingNode))
                    {
                        SetInstallStatus("Node.js LTS çalışma ortamı hazırlanıyor...", 20);
                        Program.InstallNodeJs(status => SetInstallStatus(status, 35));
                    }
                }

                SetInstallStatus("SCT AFK Service dosyaları çıkartılıyor...", 60);
                Thread.Sleep(300);

                string exeTarget = Path.Combine(targetInstallPath, "SCT AFK Service.exe");
                string uninstallerTarget = Path.Combine(targetInstallPath, "Uninstall.exe");

                Assembly asm = Assembly.GetExecutingAssembly();
                using (Stream s = asm.GetManifestResourceStream("sct.payload.exe") ?? asm.GetManifestResourceStream("sct.portable.exe"))
                {
                    if (s != null)
                    {
                        using (FileStream fs = new FileStream(exeTarget, FileMode.Create, FileAccess.Write))
                        {
                            s.CopyTo(fs);
                        }
                    }
                }

                // Setup'ın kendisini uninstaller olarak kopyala
                try
                {
                    File.Copy(Application.ExecutablePath, uninstallerTarget, true);
                }
                catch { }

                if (chkOptimizeSecurity != null && chkOptimizeSecurity.Checked)
                {
                    Program.RemoveMarkOfTheWeb(exeTarget);
                    Program.RemoveMarkOfTheWeb(uninstallerTarget);
                }

                // Masaüstünde daha önceden kalmış kaza eseri bir app.ico varsa temizle
                try
                {
                    string[] desktopDirs = new string[] {
                        Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Desktop"),
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "OneDrive", "Desktop"),
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "OneDrive", "Masaüstü")
                    };
                    foreach (string d in desktopDirs)
                    {
                        if (Directory.Exists(d))
                        {
                            string fIco = Path.Combine(d, "app.ico");
                            if (File.Exists(fIco)) File.Delete(fIco);
                        }
                    }
                }
                catch { }

                SetInstallStatus("Masaüstü ve Başlat Menüsü kısayolları oluşturuluyor...", 80);
                Thread.Sleep(300);

                if (chkDesktopShortcut != null && chkDesktopShortcut.Checked)
                {
                    string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "SCT AFK Service.lnk");
                    Program.CreateShortcut(desktopLnk, exeTarget, "SCT AFK Service - Minecraft Çoklu Hesap & Proxy AFK Client", exeTarget);
                }

                if (chkStartMenuShortcut != null && chkStartMenuShortcut.Checked)
                {
                    string startMenuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "SCT AFK Service");
                    if (!Directory.Exists(startMenuDir)) Directory.CreateDirectory(startMenuDir);
                    string startMenuLnk = Path.Combine(startMenuDir, "SCT AFK Service.lnk");
                    Program.CreateShortcut(startMenuLnk, exeTarget, "SCT AFK Service - Minecraft Çoklu Hesap & Proxy AFK Client", exeTarget);

                    string uninstallLnk = Path.Combine(startMenuDir, "SCT AFK Service Kaldır.lnk");
                    Program.CreateShortcut(uninstallLnk, uninstallerTarget, "SCT AFK Service Uygulamasını Kaldır", exeTarget);
                }

                SetInstallStatus("Windows Denetim Masası / Program Ekle-Kaldır kaydı oluşturuluyor...", 95);
                try
                {
                    using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\SctAfkService"))
                    {
                        if (key != null)
                        {
                            key.SetValue("DisplayName", "SCT AFK Service");
                            key.SetValue("DisplayVersion", "2.4.4");
                            key.SetValue("Publisher", "SCT AFK Service");
                            key.SetValue("DisplayIcon", exeTarget + ",0");
                            key.SetValue("InstallLocation", targetInstallPath);
                            key.SetValue("UninstallString", "\"" + uninstallerTarget + "\" --uninstall");
                            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                            key.SetValue("EstimatedSize", 2048, RegistryValueKind.DWord);
                        }
                    }
                }
                catch { }

                Program.RefreshShell(exeTarget);

                SetInstallStatus("Kurulum başarıyla tamamlandı!", 100);
                Thread.Sleep(400);

                if (this.InvokeRequired)
                {
                    this.BeginInvoke(new Action(() => ShowStep(3)));
                }
                else
                {
                    ShowStep(3);
                }
            }
            catch (Exception ex)
            {
                if (this.InvokeRequired)
                {
                    this.BeginInvoke(new Action(() =>
                    {
                        MessageBox.Show("Kurulum sırasında bir hata oluştu: " + ex.Message, "Kurulum Hatası", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        ShowStep(1);
                    }));
                }
            }
        }
    }
}
