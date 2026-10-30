# 🛡️ SCT AFK SERVICE - GELİŞTİRİCİ VE ANTIGRAVITY REHBERİ (RULES.md)

Bu belge, SCT AFK Service projesinde geliştirme yapan tüm geliştiriciler (mrzaknafein, kheromieallah) ve Google Antigravity yapay zeka asistanları için **bağlayıcı kuralları ve mimari standartları** içerir. Projede herhangi bir değişiklik yapmadan önce bu kurallara uyulmalıdır.

---

## 📁 1. Proje Mimarisi ve Dizin Yapısı

* **`.sct-afk-engine/`**: Mineflayer tabanlı Minecraft bot motoru, KeyAuth lisanslama ve yerel Web arayüzü (`http://127.0.0.1:3847`).
* **`sct-admin-relay/`**: VPS üzerinde 7/24 çalışan merkezi filo yönetimi, telemetri ve uzaktan komut köprü sunucusu (`Port 4890`, Canlı VPS: `http://148.135.181.63:4890`).
* **`sct-admin-app/`**: Geliştirici/Yönetici için bağımsız Windows Masaüstü uygulaması (`SCT Admin Panel.exe`, C# Native Launcher + Dahili Web Arayüzü).
* **`minecraft-afk-client/`**: Kullanıcılara dağıtılan Windows `.exe` dosyaları, kurulum sihirbazı ve GitHub dağıtım deposu (`GITHUB_YUKLENECEKLER/`).

---

## ⚠️ 2. Vulcan Anti-Cheat & Hareket Kuralları (KESİNLİKLE İHLAL EDİLEMEZ)

Sunuculardaki (Minertown vb.) Vulcan anti-cheat sistemine yakalanmamak için aşağıdaki kurallar testlerle doğrulanmıştır ve **asla değiştirilmemelidir**:

1. **Blok Koyma Gecikmesi (Auto-Builder Delay):**
   * Blok koyma gecikmesi ASLA **250ms'nin altına indirilmemelidir**!
   * Güvenli taban aralık: **260ms - 315ms** arasındadır.
   * *Neden:* 200ms ve altı hızlar Vulcan FastPlace (<4 tick) bayrağı üretir ve bot anında kicklenir (`[Vulcan] Unfair Advantage`).
2. **Sprint (Koşma) Yasağı:**
   * Otomatik inşaat (Auto-Builder) modunda ve blok yerleştirirken/kazarken `sprint: true` yapılmamalıdır (`bot.setControlState('sprint', false)`).
   * *Neden:* Blok koyarken sprint atmak Vulcan Scaffold Type G bayrağını tetikler.
3. **Ada Boşluk & Kenar Kontrolü (Sneak):**
   * Botlar yalnızca fiziksel olarak ada kenarına yaklaştığında (boşluğa mesafe `< 0.22m`) sneak yapmalıdır (`isNearIslandEdge`).
   * Düz yolda yürürken veya tarla modlarında botlar gereksiz yere sneak kilidine alınmamalıdır.
4. **Pencere Açıkken Hareket Yasağı (InventoryMove):**
   * Sandık, fıçı veya `/craft` menüsü açıkken (`bot.currentWindow`) bot kesinlikle hareket ettirilmemelidir. Pencere kapatıldıktan sonra yürüyüş başlatılmalıdır.
5. **Stabil Yedek Koruması:**
   * `.sct-afk-engine/index.js.v38_stable_backup` dosyası her zaman en güvenilir temel sürümdür. Bu dosya asla silinmemeli veya değiştirilmemelidir.

---

## 🌐 3. Merkezi Telemetri & VPS Admin Protokolü

* **Canlı VPS Relay Adresi:** `http://148.135.181.63:4890` (Port: `4890`)
* **İstemci Yetki Anahtarı:** `SCT_CLIENT_RELAY_KEY_2026`
* **Admin Master Şifresi:** `SCT_ADMIN_MASTER_2026!#`
* **İstemci Telemetri Döngüsü:**
  * İstemciler her 4 saniyede bir `startAdminRelayReporter()` üzerinden VPS'e heartbeat gönderir.
  * İstemci `config.json` içinde `127.0.0.1` yazsa bile `DEFAULT_MASTER_RELAY_URL` doğrudan VPS IP'sine yönlendirir.
* **Desteklenen Uzak Komutlar:**
  * `restart_app`: İstemciyi arka planda temizce kapatıp yeniden başlatır.
  * `stop_all` / `start_all`: Tüm botları durdurur veya sırayla başlatır.
  * `stop_bot` / `start_bot`: Belirli bir botu durdurur veya başlatır.
  * `send_chat`: Seçilen bota `/is`, `/spawn`, `/sat hepsi` vb. komutları gönderir.
  * `broadcast`: Kullanıcının ekranına Cyberpunk temalı neon pop-up (`#adminBroadcastModal`) açar ve ses çalar.
  * `request_logs`: İstemcinin son 60 terminal log satırını admin paneline akıtır.

---

## 📦 4. Sürüm Yönetimi ve GitHub Dağıtım Kuralları (DOĞRUDAN MAIN DAĞITIMI)

İstemciler güncellemeleri GitHub (`mrzaknafein/SCT-AFK-Service`) **`main`** dalı üzerinden otomatik olarak indirir. Dağıtıma güncelleme çıkarırken:

1. `.sct-afk-engine/index.js` dosyasının 32. satırındaki `ENGINE_BUILD_ID` bir üst sürüme güncellenmelidir (örn: `..._v67`).
2. `version.json` dosyasındaki `buildId` ve `version` birebir aynı yapım kimliğiyle güncellenmelidir.
3. **KRİTİK:** `index.js` içindeki `ENGINE_BUILD_ID` ile `version.json` içindeki `buildId` **BİREBİR AYNI OLMALIDIR**. Aksi halde istemcilerin yerleşik güvenlik kontrolü güncellemeyi iptal eder!
4. **DOĞRUDAN DAĞITIM KURALI:** Tüm değişiklikler test edildikten sonra **doğrudan `main` dalına** push edilmelidir. Kodlar `dev` dalında bekletilmez; doğrudan `main` üzerinden dağıtıma çıkar.

---

## 🛠️ 5. Windows EXE Derleme Standartları

Windows kullanıcıları için EXE'ler harici Node.js veya Electron kurulumu gerektirmeden bağımsız (portable) çalışır:

* **SCT AFK Service.exe Derleme:**
  ```powershell
  Set-Location "C:\...\.sct-afk-engine"
  & "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /optimize+ /out:"..\minecraft-afk-client\SCT AFK Service.exe" /win32icon:app.ico /res:package.json,sct.package.json /res:index.js,sct.index.js /res:public\index.html,sct.index.html /res:public\logo.jpg,sct.logo.jpg /res:config.json,sct.config.json /res:Launcher.cs,sct.Launcher.cs /res:app.ico,sct.app.ico Launcher.cs
  ```

* **SCT Admin Panel.exe Derleme:**
  ```powershell
  Set-Location "C:\...\sct-admin-app"
  powershell -ExecutionPolicy Bypass -File "build_admin_exe.ps1"
  ```

---

## 👥 6. Çoklu Geliştirici (Ortak Çalışma) & Doğrudan Dağıtım Kuralları

1. **Tek ve Doğrudan Dağıtım Dalı (`main`):**
   * **Tüm geliştirmeler (yeni özellikler, iyileştirmeler ve hata düzeltmeleri) DOĞRUDAN `main` dalına commit/push edilir.**
   * `dev` dalı artık bekleme veya geliştirme havuzu olarak KULLANILMAZ; geliştirmeler `dev`e atılmaz.
   * Arkadaşınızın (kheromieallah) veya sizin yapacağınız geliştirmeler doğrudan `main`e gönderildiği an, sahadaki tüm kullanıcılar ve botlar yeni sürümü anında alıp dağıtımdan çalıştırır.
2. **Sürüm Kimliği (Build ID) Eşitleme Zorunluluğu:**
   * Yapılan her geliştirmede `index.js` (Satır 32) ve `version.json` içindeki `buildId` artırılıp eşitlenerek `main`e pushlanmalıdır.
3. **Hesap İsimleri:**
   * Test ederken her geliştirici farklı bot hesap adları (örn: `zaknafein_dev1`, `khero_dev1`) kullanmalıdır. Aynı isimle giriş yapılırsa sunucu diğer geliştiricinin botunu oyundan kickler.
4. **VPS Yönetimi:**
   * Her iki geliştirici de kendi bilgisayarında `SCT Admin Panel.exe` açarak aynı VPS (`148.135.181.63:4890`) üzerinden tüm filoyu ortaklaşa canlı takip edebilir.
