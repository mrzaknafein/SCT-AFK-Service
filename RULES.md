# 🛡️ SCT AFK SERVICE - GELİŞTİRİCİ VE ANTIGRAVITY / YAPAY ZEKA ASİSTAN REHBERİ (RULES.md)

> **DİKKAT (TÜM GELİŞTİRİCİLER & YAPAY ZEKA ASİSTANLARI İÇİN BAĞLAYICIDIR):**  
> Bu belge; SCT AFK Service projesinde geliştirme yapan tüm ekip üyeleri (`mrzaknafein`, `kheromieallah`) ve projede kod yazan tüm **Yapay Zeka Asistanları (Google Antigravity, Cursor, Copilot vb.)** için **kesin ve bağlayıcı mimari standartları** içerir. Projede geliştirme yapmadan önce bu kuralları okumak ve harfiyen uygulamak zorunludur.

---

## 🚀 1. ÖNEMLİ MİMARİ DEVRİM: 100% NATIVE WPF MASAÜSTÜ SİSTEMİ (v2.4.2 / v80+)

Proje, **20261106_native_wpf_gui_v80** sürümü itibarıyla tarayıcı, WebView2, Microsoft Edge ve HTML/CSS sarmalayıcılarından **tamamen arındırılmıştır**.

### ⚠️ Asla Geri Dönülmeyecek Katı Kurallar:
1. **HTML / WebView / Edge YASAĞI:**
   * Kullanıcı arayüzü (UI) artık bir web sayfası değildir. Projeye kesinlikle WebView2, Chromium, iframe, Electron veya Edge tabanlı tarayıcı penceresi eklenmeyecektir.
2. **Kullanıcı Arayüzü (UI) Yeri: `Launcher.cs` (C# Native WPF):**
   * Tüm ekranlar, butonlar, istatistik kartları, hesap listeleri, ayarlar sekmesi ve konsol logları doğrudan `Launcher.cs` içerisinde **Windows Presentation Foundation (WPF)** bileşenleri (`Window`, `Grid`, `StackPanel`, `Border`, `ScrollViewer`, `TextBlock`, `TextBox`, `Button`) ile saf C# kodundan üretilmektedir (XAML dosyası bile gerekmez, tek dosyada gömülüdür).
3. **IPC İletişim Protokolü: Windows Named Pipe:**
   * C# WPF Arayüzü (`Launcher.cs`) ile Node.js Mineflayer Motoru (`index.js`) arasındaki haberleşme **KESİNLİKLE HTTP veya WebSocket DEĞİLDİR**.
   * İletişim, Windows çekirdek seviyesinde ultra hızlı çalışan yerel **Named Pipe** üzerinden gerçekleşir:
     `\\.\pipe\SctAfkEngineIpc`
   * C# tarafında `SctPipeClient`, Node.js tarafında `ipcServer` (net.createServer) kullanılır.
   * Mesaj formatı: JSON satırları (`\n` ile ayrılmış JSON payload: `req`, `res`, `event`).

---

## 🎨 2. ARAYÜZ TASARIMI VE RENK PALETİ STANDARTLARI (PREMIUM EDITORIAL)

Tüm yeni arayüz geliştirmelerinde (yeni butonlar, sekmeler, diyaloglar veya modallar) **aşağıdaki resmi renk paleti ve tasarım kuralları** kullanılmalıdır:

| Renk Adı | Hex Kodu | Kullanım Alanı |
| :--- | :--- | :--- |
| **Pencere Arka Planı** | `#FFF2EAE0` / `#FFF5ECE3` | Ana pencere zemini, sıcak kum/bej lüks doku |
| **Kart Zeminleri (Card BG)** | `#FFFFFFFF` | İçerik kartları, kutular, panel gövdeleri |
| **Kart Kenarlığı (Border)** | `#FFE8DCC4` / `#FFD6C5A9` | Kart sınırları, zarif çerçeveler |
| **Forest Green (Ana Renk)** | `#FF1F3D2B` | Birincil butonlar, başlıklar, aktif sekmeler, vurgular |
| **Sand Beige (İkincil Renk)**| `#FFE8DCC4` | İkincil butonlar, pasif rozetler, hafif zeminler |
| **Electric Purple (Aksan)** | `#FF8B5CF6` | Pro rozetleri, özel durumlar, canlı aksanlar |
| **Başlık & Metin (Text Dark)**| `#FF1F3D2B` / `#FF14261B` | Okunabilir ana metinler, başlıklar |
| **Açıklama Metni (Muted)** | `#FF556B5C` / `#FF6F7E74` | Alt açıklamalar, sayaçlar, pasif etiketler |

### Tasarım Kuralları:
* **Yuvarlak Logo ve Avatarlar:** Uygulama içindeki tüm logo, resim ve kullanıcı avatarları tam yuvarlak (circular) veya yumuşatılmış `CornerRadius(12-16)` kenarlı olmalıdır. Köşeli, kaba dikdörtgen resimler yasaktır.
* **Kullanıcıdan Gizlenen Dahili Ayarlar:** GitHub repo adı, token veya dal seçimi gibi dahili teknik ayarlar son kullanıcıya gösterilmez (`Settings` sekmesinde gizli tutulur).

---

## 📁 3. Dizin Yapısı ve Dosya Sorumlulukları

* **`.sct-afk-engine/index.js`**: Mineflayer tabanlı Minecraft bot motoru, KeyAuth lisanslama, otomasyonlar (Auto-Spawner, Auto-Builder, Auto-Sell) ve Named Pipe IPC sunucusu.
* **`.sct-afk-engine/Launcher.cs`**: 100% Native WPF masaüstü arayüzü, sistem tepsisi (system tray), ses sentezleyici ve IPC istemcisi.
* **`minecraft-afk-client/SCT AFK Service.exe`**: C# derleyicisi (`csc.exe`) ile tek parça haline getirilmiş, sıfır bağımlılıklı taşınabilir (portable) Windows uygulaması.
* **`sct-admin-relay/`**: VPS üzerinde 7/24 çalışan merkezi filo yöneticisi (`Port 4890`, Canlı VPS: `http://148.135.181.63:4890`).
* **`sct-admin-app/`**: Yönetici için bağımsız Windows Masaüstü uygulaması (`SCT Admin Panel.exe`, C# Native WPF).

---

## ⚠️ 4. Vulcan Anti-Cheat & Hareket Kuralları (KESİNLİKLE DEĞİŞTİRİLEMEZ)

Sunuculardaki (Minertown vb.) Vulcan anti-cheat sistemine yakalanmamak için aşağıdaki kurallar zorunludur:
1. **Blok Koyma Gecikmesi (Auto-Builder Delay):** ASLA **250ms'nin altına indirilmemelidir**! Güvenli aralık: **260ms - 315ms**. (200ms altı Vulcan FastPlace bayrağı üretir).
2. **Sprint (Koşma) Yasağı:** İnşaat, blok koyma veya kazma sırasında bot sprint atmamalıdır (`bot.setControlState('sprint', false)`).
3. **Pencere Açıkken Hareket Yasağı (InventoryMove):** Sandık, fıçı veya `/craft` açıkken bot yürütülmemelidir.
4. **Stabil Yedek Koruması:** `index.js.v38_stable_backup` dosyası her zaman en güvenilir temel sürümdür, silinmemelidir.

---

## 🔄 5. Sürüm Yönetimi, GitHub Dağıtımı & Çift Dal Senkronizasyonu (`main` & `dev`)

Geliştiriciler ister `dev` ister `main` dalına push atsın, aşağıdaki sürüm kurallarına uyulmalıdır:

1. **Sürüm Kimliği (Build ID) Eşitleme Kuralı:**
   * `.sct-afk-engine/index.js` içindeki `const ENGINE_BUILD_ID = '...';` (Örn: `20261106_native_wpf_gui_v80`)
   * `.sct-afk-engine/Launcher.cs` içindeki `public const string CURRENT_ENGINE_BUILD_ID = "...";`
   * `version.json` içindeki `buildId`
   Bu 3 değer **BİREBİR AYNI OLMALIDIR**.
2. **Dağıtım Dosyaları:**
   * `version.json` içindeki `files` haritasında hem yeni sistem (`Launcher.cs`, `SCT AFK Service.exe`), hem de eski istemcilerin geçişi için (`index.js`, `public/index.html`) tanımlı olmalıdır.
3. **Çift Dal Uyumu:**
   * `dev` dalında test edilen özellikler tamamlandığında `main` dalına da aktarılmalı veya `deploy_v80_native_wpf.js` benzeri bir script ile her iki dal da senkronize tutulmalıdır.
4. **Taşınabilir EXE Derleme Komutu:**
   ```powershell
   $fw = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319"
   $wpf = "$fw\WPF"
   & "$fw\csc.exe" /nologo /target:winexe /optimize+ /out:"..\minecraft-afk-client\SCT AFK Service.exe" /win32icon:app.ico /r:"$wpf\PresentationFramework.dll" /r:"$wpf\PresentationCore.dll" /r:"$wpf\WindowsBase.dll" /r:"$fw\System.Xaml.dll" /r:System.Web.Extensions.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /res:package.json,sct.package.json /res:index.js,sct.index.js /res:public\logo.jpg,sct.logo.jpg /res:config.json,sct.config.json /res:Launcher.cs,sct.Launcher.cs /res:app.ico,sct.app.ico Launcher.cs
   ```

---

## 🤝 6. Diğer Geliştirici & Agent İle Ortak Çalışma İlkeleri

1. **Yeni Bir Bot Özelliği Eklerken:**
   * Mantığı `index.js` içerisine yazın.
   * Gerekli ayar veya komutları `config.json` şemasına ekleyin.
   * WPF Arayüzünde buton veya ayar gerekiyorsa, bunu `Launcher.cs` içine ekleyin ve `SctPipeClient.SendIpcRequest(...)` ile motora bildirin.
2. **Asla Yerel Port 3000 Web UI Yazmayın:**
   * Yeni bir web sayfası, html bileşeni veya WebView yazmayın. Tüm UI bileşenleri C# WPF ile oluşturulur.
3. **Hesap İsimleri:**
   * Test yaparken `zaknafein_dev1`, `khero_dev1` gibi ayrı hesap adları kullanın.
