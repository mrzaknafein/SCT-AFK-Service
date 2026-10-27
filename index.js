const mineflayer = require('mineflayer');
const nbt = require('prismarine-nbt');
const Vec3 = require('vec3');
const http = require('http');
const https = require('https');
const net = require('net');
const dns = require('dns');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec, execFile, execSync, spawn } = require('child_process');
const chalk = require('chalk');

// Sunucunun beklenmeyen bot veya soket hatalarında çökmesini önle
process.on('uncaughtException', (err) => {
  try {
    const msg = `[${new Date().toISOString()}] UNCAUGHT_EXCEPTION: ${err && err.stack ? err.stack : err}\n`;
    fs.appendFileSync(path.join(__dirname, 'crash.log'), msg);
    console.error(chalk.red('[HATA] Sistem istisnası yakalandı (çökme engellendi):'), err && err.message ? err.message : err);
  } catch (e) {}
});

process.on('unhandledRejection', (reason) => {
  try {
    const msg = `[${new Date().toISOString()}] UNHANDLED_REJECTION: ${reason && reason.stack ? reason.stack : reason}\n`;
    fs.appendFileSync(path.join(__dirname, 'crash.log'), msg);
    console.warn(chalk.yellow('[UYARI] Yakalanmamış asenkron işlem:'), reason && reason.message ? reason.message : reason);
  } catch (e) {}
});

const ENGINE_BUILD_ID = '20261026_smooth_chain_vulcan_safe_v41';
const CONFIG_PATH = path.join(__dirname, 'config.json');
const KEYAUTH_SAVED_PATH = path.join(__dirname, 'keyauth_saved.json');
const HTML_PATH = path.join(__dirname, 'public', 'index.html');

// --- KEYAUTH UYGULAMA KİMLİK BİLGİLERİ ---
const KEYAUTH_CONFIG = {
  name: 'SCT AFK Service',
  ownerid: 'J9kTuvh3nz',
  secret: '59fbfff0b41e911fb1d891a3c946c67a170a28e14bd5dd0d399da413afc8b677',
  version: '1.0',
  endpoints: ['https://keyauth.win/api/1.2/', 'https://keyauth.cc/api/1.2/']
};

let cachedSystemHwid = null;
function getSystemDeviceHwid() {
  if (cachedSystemHwid) return cachedSystemHwid;
  try {
    const sidOut = execSync('whoami /user /fo csv /nh', {
      encoding: 'utf8',
      timeout: 2500,
      windowsHide: true
    }).trim();
    const parts = sidOut.split(',');
    if (parts.length >= 2) {
      const sid = parts[1].replace(/"/g, '').trim();
      if (sid && sid.startsWith('S-1-')) {
        cachedSystemHwid = sid;
        return cachedSystemHwid;
      }
    }
  } catch (e) {}

  try {
    const regOut = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: 'utf8', timeout: 2500, windowsHide: true }
    );
    const m = regOut.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    if (m && m[1]) {
      cachedSystemHwid = m[1].trim().toUpperCase();
      return cachedSystemHwid;
    }
  } catch (e) {}

  const cpuModel = (os.cpus() && os.cpus()[0] && os.cpus()[0].model) || 'CPU';
  const raw = `${os.hostname()}_${os.userInfo().username}_${cpuModel}`;
  cachedSystemHwid =
    'S-1-5-21-' +
    crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24).toUpperCase();
  return cachedSystemHwid;
}

const keyAuthSession = {
  authenticated: true,
  isPro: false,
  sessionid: '',
  username: 'Ücretsiz Kullanıcı',
  subscription: 'Starter (Ücretsiz)',
  plan: 'starter', // 'starter' | 'pro'
  planLabel: 'STARTER',
  key: '',
  expiryTimestamp: null,
  createdate: null,
  lastlogin: null,
  hwid: getSystemDeviceHwid(),
  ip: ''
};

function resolveKeyAuthPlan(subscriptions) {
  const subs = Array.isArray(subscriptions) ? subscriptions : [];
  if (subs.length === 0) {
    // KeyAuth girişi başarılıysa kullanıcı PRO'dur (Starter KeyAuth gerektirmez)
    return { plan: 'pro', planLabel: 'PRO', primarySub: { subscription: 'PRO (175.00 TL)' } };
  }
  // KeyAuth'tan herhangi bir aktif abonelik / key döndüyse PRO olarak tanımla (Starter ücretsizdir, KeyAuth'ta yalnızca 175.00 TL'lik Pro satılır)
  const proSub = subs.find((s) => {
    const subName = String((s && s.subscription) || '').toLowerCase();
    return subName.includes('pro') || subName.includes('vip') || subName.includes('full') || subName.includes('premium') || subName.includes('sct');
  }) || subs[0];

  return {
    plan: 'pro',
    planLabel: 'PRO',
    primarySub: proSub
  };
}

function translateKeyAuthError(msg) {
  if (!msg) return 'KeyAuth sunucusundan yanıt alınamadı.';
  const m = String(msg);
  const lower = m.toLowerCase();
  if (lower.includes("username doesn't exist") || lower.includes('invalid username') || lower.includes('user not found')) {
    return 'Kullanıcı adı bulunamadı! İlk kez giriş yapıyorsanız "Kayıt Ol" sekmesinden lisans anahtarınızla hesap oluşturun.';
  }
  if (lower.includes('password does not match') || lower.includes('invalid password') || lower.includes('wrong password')) {
    return 'Girdiğiniz şifre hatalı! Lütfen kontrol edip tekrar deneyin.';
  }
  if (lower.includes('hwid') && (lower.includes('match') || lower.includes('invalid'))) {
    return 'HWID Uyuşmazlığı! Bu hesap başka bir bilgisayara kilitlenmiş. Lütfen yönetici (HWID Sıfırlama) ile iletişime geçin.';
  }
  if (lower.includes('key not found') || lower.includes('invalid license') || lower.includes('key does not exist')) {
    return 'Geçersiz lisans anahtarı! Lütfen satın aldığınız Key kodunu kontrol edin.';
  }
  if (lower.includes('key already used') || lower.includes('already used')) {
    return 'Bu lisans anahtarı daha önce kullanılmış! Zaten kayıt olduysanız "Giriş Yap" sekmesinden giriş yapın.';
  }
  if (lower.includes('username already exists') || lower.includes('already taken')) {
    return 'Bu kullanıcı adı zaten kullanımda. Lütfen farklı bir kullanıcı adı seçin.';
  }
  if (lower.includes('expired') || lower.includes('no active subscriptions')) {
    return 'Lisans süreniz sona ermiş! "Süre Uzat" sekmesinden yeni bir lisans anahtarı tanımlayabilirsiniz.';
  }
  if (lower.includes('banned') || lower.includes('blacklisted')) {
    return 'Bu hesap veya donanım kimliği (HWID) yönetici tarafından engellenmiş!';
  }
  if (lower.includes('session') && lower.includes('not found')) {
    return 'KeyAuth oturum süresi doldu, lütfen tekrar deneyin.';
  }
  return m;
}

function postFormUrlEncoded(endpointUrl, paramsObj) {
  return new Promise((resolve, reject) => {
    const formBody = new URLSearchParams();
    for (const [k, v] of Object.entries(paramsObj)) {
      if (typeof v !== 'undefined' && v !== null) {
        formBody.append(k, String(v));
      }
    }
    const postData = formBody.toString();
    const u = new URL(endpointUrl);

    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'KeyAuth'
        },
        timeout: 9000
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            resolve(parsed);
          } catch (err) {
            reject(new Error(`KeyAuth geçersiz yanıt döndürdü (HTTP ${res.statusCode})`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('KeyAuth sunucusu zaman aşımına uğradı'));
    });
    req.on('error', (err) => reject(err));
    req.write(postData);
    req.end();
  });
}

async function keyAuthApiCall(paramsObj) {
  let lastErr = null;
  for (const endpoint of KEYAUTH_CONFIG.endpoints) {
    try {
      return await postFormUrlEncoded(endpoint, paramsObj);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('KeyAuth sunucularına ulaşılamadı');
}

async function initKeyAuthSession() {
  const res = await keyAuthApiCall({
    type: 'init',
    ver: KEYAUTH_CONFIG.version,
    name: KEYAUTH_CONFIG.name,
    ownerid: KEYAUTH_CONFIG.ownerid
  });
  if (!res || !res.success || !res.sessionid) {
    throw new Error(translateKeyAuthError((res && res.message) || 'KeyAuth başlatılamadı'));
  }
  keyAuthSession.sessionid = res.sessionid;
  return res.sessionid;
}

function applyKeyAuthUserInfo(info, fallbackUsername) {
  const subs = (info && Array.isArray(info.subscriptions) && info.subscriptions) || [];
  const { plan, planLabel, primarySub } = resolveKeyAuthPlan(subs);
  const expirySec = Number(primarySub.expiry) || 0;

  keyAuthSession.authenticated = true;
  keyAuthSession.isPro = (plan === 'pro');
  keyAuthSession.username = (info && info.username) || fallbackUsername || '';
  keyAuthSession.subscription = primarySub.subscription || (plan === 'pro' ? 'PRO (175.00 TL)' : 'Starter');
  keyAuthSession.plan = plan;
  keyAuthSession.planLabel = planLabel;
  keyAuthSession.key = primarySub.key || '';
  keyAuthSession.expiryTimestamp = expirySec > 0 ? expirySec * 1000 : null;
  keyAuthSession.createdate = info && info.createdate ? Number(info.createdate) * 1000 : null;
  keyAuthSession.lastlogin = info && info.lastlogin ? Number(info.lastlogin) * 1000 : Date.now();
  keyAuthSession.hwid = (info && info.hwid) || getSystemDeviceHwid();
  keyAuthSession.ip = (info && info.ip) || '';
}

function saveLocalKeyAuthCredentials(username, password) {
  try {
    const payload = {
      u: Buffer.from(String(username), 'utf8').toString('base64'),
      p: Buffer.from(String(password), 'utf8').toString('base64'),
      sub: keyAuthSession.subscription || 'PRO (175.00 TL)',
      exp: keyAuthSession.expiryTimestamp || null,
      t: Date.now()
    };
    fs.writeFileSync(KEYAUTH_SAVED_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {}
}

function clearLocalKeyAuthCredentials() {
  try {
    if (fs.existsSync(KEYAUTH_SAVED_PATH)) {
      fs.unlinkSync(KEYAUTH_SAVED_PATH);
    }
  } catch (e) {}
}

function loadLocalKeyAuthCredentials() {
  try {
    if (!fs.existsSync(KEYAUTH_SAVED_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(KEYAUTH_SAVED_PATH, 'utf8'));
    if (!raw || !raw.u || !raw.p) return null;
    return {
      username: Buffer.from(raw.u, 'base64').toString('utf8'),
      password: Buffer.from(raw.p, 'base64').toString('utf8'),
      subscription: raw.sub || 'PRO (175.00 TL)',
      expiryTimestamp: raw.exp || null
    };
  } catch (e) {
    return null;
  }
}

function applySavedKeyAuthAsPro(saved) {
  if (!saved || !saved.username) return false;
  if (saved.expiryTimestamp && Date.now() >= saved.expiryTimestamp) return false;
  keyAuthSession.authenticated = true;
  keyAuthSession.isPro = true;
  keyAuthSession.plan = 'pro';
  keyAuthSession.planLabel = 'PRO';
  keyAuthSession.username = saved.username;
  keyAuthSession.subscription = saved.subscription || 'PRO (175.00 TL)';
  keyAuthSession.expiryTimestamp = saved.expiryTimestamp || null;
  return true;
}

// Motor yeniden başladığında (güncelleme vb.) kayıtlı PRO oturumu anında geri yükle
applySavedKeyAuthAsPro(loadLocalKeyAuthCredentials());

async function performKeyAuthLogin(username, password, remember = true) {
  const sid = await initKeyAuthSession();
  const res = await keyAuthApiCall({
    type: 'login',
    username: String(username).trim(),
    pass: String(password),
    hwid: getSystemDeviceHwid(),
    sessionid: sid,
    name: KEYAUTH_CONFIG.name,
    ownerid: KEYAUTH_CONFIG.ownerid
  });

  if (!res || !res.success) {
    throw new Error(translateKeyAuthError(res && res.message));
  }

  applyKeyAuthUserInfo(res.info, username);
  if (remember) {
    saveLocalKeyAuthCredentials(username, password);
  } else {
    clearLocalKeyAuthCredentials();
  }
  return getPublicKeyAuthStatus();
}

async function performKeyAuthRegister(username, password, licenseKey, remember = true) {
  const sid = await initKeyAuthSession();
  const res = await keyAuthApiCall({
    type: 'register',
    username: String(username).trim(),
    pass: String(password),
    key: String(licenseKey).trim(),
    hwid: getSystemDeviceHwid(),
    sessionid: sid,
    name: KEYAUTH_CONFIG.name,
    ownerid: KEYAUTH_CONFIG.ownerid
  });

  if (!res || !res.success) {
    throw new Error(translateKeyAuthError(res && res.message));
  }

  applyKeyAuthUserInfo(res.info, username);
  if (remember) {
    saveLocalKeyAuthCredentials(username, password);
  }
  return getPublicKeyAuthStatus();
}

async function performKeyAuthUpgrade(username, licenseKey) {
  const sid = await initKeyAuthSession();
  const res = await keyAuthApiCall({
    type: 'upgrade',
    username: String(username).trim(),
    key: String(licenseKey).trim(),
    sessionid: sid,
    name: KEYAUTH_CONFIG.name,
    ownerid: KEYAUTH_CONFIG.ownerid
  });

  if (!res || !res.success) {
    throw new Error(translateKeyAuthError(res && res.message));
  }
  return {
    ok: true,
    message: 'Lisans anahtarı hesabınıza başarıyla tanımlandı! Şimdi "Giriş Yap" sekmesinden giriş yapabilirsiniz.'
  };
}

function getPublicKeyAuthStatus() {
  const saved = loadLocalKeyAuthCredentials();
  if (keyAuthSession.plan !== 'pro' && saved) {
    applySavedKeyAuthAsPro(saved);
  }
  const isPro = keyAuthSession.plan === 'pro';
  return {
    engineBuildId: ENGINE_BUILD_ID,
    authenticated: true,
    isPro: isPro,
    username: isPro ? (keyAuthSession.username || (saved ? saved.username : 'PRO Üye')) : 'Ücretsiz Sürüm',
    hasSavedCredentials: Boolean(saved),
    subscription: isPro ? (keyAuthSession.subscription || 'PRO (175.00 TL)') : 'Starter (Ücretsiz)',
    plan: isPro ? 'pro' : 'starter',
    planLabel: isPro ? 'PRO' : 'STARTER',
    expiryTimestamp: isPro ? keyAuthSession.expiryTimestamp : null,
    createdate: keyAuthSession.createdate || null,
    lastlogin: keyAuthSession.lastlogin || null,
    hwid: keyAuthSession.hwid || getSystemDeviceHwid(),
    ip: keyAuthSession.ip || '',
    appName: KEYAUTH_CONFIG.name,
    appVersion: KEYAUTH_CONFIG.version,
    maxAccounts: isPro ? 999 : 3,
    price: '175.00 TL',
    discord: 'cagat'
  };
}

// İstemci Paket Kimliği (Brand Spoofing) Ön Ayarları
const CLIENT_BRAND_PRESETS = {
  vanilla: 'vanilla',
  lunar: 'lunarclient:v2.16.1-2433',
  feather: 'Feather Fabric',
  fabric: 'fabric',
  forge: 'fml,forge',
  badlion: 'Badlion',
  optifine: 'optifine'
};

function generateHwidString(seedStr = '') {
  const hash = crypto
    .createHash('sha256')
    .update(`${seedStr}_${Date.now()}_${Math.random()}`)
    .digest('hex')
    .toUpperCase();
  return `HWID-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;
}

function resolveAccountBrand(acc) {
  if (!acc) return 'vanilla';
  const preset = acc.clientBrand || 'vanilla';
  if (preset === 'custom') {
    return (acc.customBrand && String(acc.customBrand).trim()) || 'vanilla';
  }
  return CLIENT_BRAND_PRESETS[preset] || preset || 'vanilla';
}

function deriveSkinPartsFromHwid(hwid) {
  if (!hwid || typeof hwid !== 'string') {
    return {
      showCape: true,
      showJacket: true,
      showLeftSleeve: true,
      showRightSleeve: true,
      showLeftPants: true,
      showRightPants: true,
      showHat: true
    };
  }
  const code = hwid.charCodeAt(hwid.length - 1) || 1;
  return {
    showCape: (code & 1) === 0,
    showJacket: true,
    showLeftSleeve: true,
    showRightSleeve: true,
    showLeftPants: true,
    showRightPants: true,
    showHat: true
  };
}

// Bilinen yenilebilir yemek listesi (Auto-Eat için)
const FOOD_ITEMS = new Set([
  'cooked_beef', 'steak', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
  'cooked_salmon', 'cooked_cod', 'bread', 'baked_potato', 'golden_carrot',
  'golden_apple', 'enchanted_golden_apple', 'carrot', 'apple', 'melon_slice',
  'cooked_rabbit', 'rabbit_stew', 'mushroom_stew', 'beetroot_soup', 'pumpkin_pie',
  'cookie', 'sweet_berries', 'glow_berries', 'dried_kelp', 'beef', 'porkchop',
  'chicken', 'mutton', 'potato', 'beetroot'
]);

function loadConfig() {
  let parsed = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (err) {
    console.error(chalk.red(`[HATA] config.json okunamadı: ${err.message}`));
  }

  let updated = false;

  if (!parsed.uiPort) {
    parsed.uiPort = 3847;
    updated = true;
  }

  if (!parsed.server) {
    parsed.server = { host: 'localhost', port: 25565, version: false };
    updated = true;
  }

  if (!Array.isArray(parsed.servers) || parsed.servers.length === 0) {
    parsed.servers = [
      {
        id: 'srv_1',
        name: parsed.server.host && parsed.server.host !== 'localhost' ? parsed.server.host : 'Ana Sunucu',
        host: parsed.server.host || 'localhost',
        port: Number(parsed.server.port) || 25565,
        version: parsed.server.version || false
      }
    ];
    parsed.selectedServerId = 'srv_1';
    updated = true;
  }

  if (!parsed.selectedServerId || !parsed.servers.find((s) => s.id === parsed.selectedServerId)) {
    parsed.selectedServerId = parsed.servers[0].id;
    updated = true;
  }

  const activeSrv = parsed.servers.find((s) => s.id === parsed.selectedServerId) || parsed.servers[0];
  parsed.server = {
    ...parsed.server,
    host: activeSrv.host,
    port: activeSrv.port,
    version: activeSrv.version
  };

  if (!Array.isArray(parsed.accounts)) {
    parsed.accounts = [];
    delete parsed.account;
    updated = true;
  } else {
    // Mevcut hesaplara yeni varsayılan alanları ekle
    parsed.accounts = parsed.accounts.map((acc) => {
      if (!acc.hwid) {
        updated = true;
      }
      return {
        autoEat: true,
        autoTool: true,
        panicDisconnect: false,
        panicHealth: 6,
        autoCommandEnabled: false,
        autoCommandIntervalSec: 180,
        autoCommandText: '/sell all',
        autoFarmerSell: acc.autoFarmerSell && typeof acc.autoFarmerSell === 'object'
          ? { enabled: Boolean(acc.autoFarmerSell.enabled), intervalSec: Math.max(5, Number(acc.autoFarmerSell.intervalSec) || 120) }
          : { enabled: false, intervalSec: 120 },
        clientBrand: 'vanilla',
        customBrand: '',
        clientLocale: 'tr_TR',
        viewDistance: 10,
        mainHand: 'right',
        hwid: acc.hwid || generateHwidString(acc.username || acc.id),
        ...acc
      };
    });
  }

  if (!parsed.autoAuth) {
    parsed.autoAuth = {
      enabled: true,
      smartDetect: true,
      loginCommand: '/login {password}',
      registerCommand: '/register {password} {email}',
      delayMs: 3000,
      customJoinCommands: []
    };
    updated = true;
  } else {
    if (typeof parsed.autoAuth.smartDetect === 'undefined') {
      parsed.autoAuth.smartDetect = true;
      updated = true;
    }
    if (!parsed.autoAuth.registerCommand || !parsed.autoAuth.registerCommand.includes('{email}')) {
      parsed.autoAuth.registerCommand = '/register {password} {email}';
      updated = true;
    }
  }

  if (!parsed.reconnect) {
    parsed.reconnect = { enabled: true, delayMs: 5000 };
    updated = true;
  }

  if (!parsed.antiAfk) {
    parsed.antiAfk = {
      enabled: true,
      intervalMs: 15000,
      actions: { jump: true, rotate: true, swingArm: true, sneak: true }
    };
    updated = true;
  }

  if (!parsed.discord) {
    parsed.discord = {
      enabled: false,
      webhookUrl: '',
      notifyDisconnect: true,
      notifyPanic: true,
      notifyDeath: true,
      notifyCaptcha: true
    };
    updated = true;
  }

  if (!parsed.soundAlerts) {
    parsed.soundAlerts = {
      enabled: true,
      onDamage: true,
      onDisconnect: true,
      onMention: true,
      onCaptcha: true
    };
    updated = true;
  }

  if (typeof parsed.autoCaptcha === 'undefined') {
    parsed.autoCaptcha = { enabled: true };
    updated = true;
  }

  if (!parsed.discordRpc) {
    parsed.discordRpc = {
      enabled: true,
      clientId: '450485984333660181',
      largeImageUrl: 'https://files.catbox.moe/lg3ryp.jpg',
      largeImageText: 'SCT AFK Service'
    };
    updated = true;
  } else {
    if (parsed.discordRpc.clientId === '1261324838272909322') {
      parsed.discordRpc.clientId = '450485984333660181';
      updated = true;
    }
    if (!parsed.discordRpc.largeImageUrl || parsed.discordRpc.largeImageUrl === 'grass') {
      parsed.discordRpc.largeImageUrl = 'https://files.catbox.moe/lg3ryp.jpg';
      updated = true;
    }
    if (parsed.discordRpc.customDetails === 'Minertown Skyblock AFK') {
      parsed.discordRpc.customDetails = '';
      updated = true;
    }
    if (parsed.discordRpc.customState === '7/24 Kesintisiz Maden') {
      parsed.discordRpc.customState = '';
      updated = true;
    }
  }

  if (!parsed.updates) {
    parsed.updates = {
      enabled: true,
      autoApply: false,
      repoOwner: 'mrzaknafein',
      repoName: 'SCT-AFK-Service',
      branch: 'main',
      manifestUrl: ''
    };
    updated = true;
  }

  if (!Array.isArray(parsed.builderPresets)) {
    parsed.builderPresets = [];
    updated = true;
  }

  if (typeof parsed.builderSharedCoords === 'undefined') {
    parsed.builderSharedCoords = null;
  }

  if (updated) {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(parsed, null, 2), 'utf8');
    } catch (e) {}
  }

  return parsed;
}


// ==========================================
// --- HOT-UPDATE (OTOMATİK GÜNCELLEME) MODÜLÜ ---
// ==========================================
let updateCheckState = {
  lastChecked: 0,
  hasUpdate: false,
  latestBuildId: null,
  version: null,
  releaseNotes: '',
  error: null,
  isUpdating: false
};

function getUpdateManifestUrl() {
  if (config.updates && config.updates.manifestUrl && config.updates.manifestUrl.trim()) {
    return config.updates.manifestUrl.trim();
  }
  const owner = (config.updates && config.updates.repoOwner) || 'mrzaknafein';
  const repo = (config.updates && config.updates.repoName) || 'SCT-AFK-Service';
  const branch = (config.updates && config.updates.branch) || 'main';
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/version.json`;
}

function httpFetchUrl(urlStr, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Çok fazla yönlendirme sınırı'));
    const parsed = new URL(urlStr);
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(urlStr, { headers: { 'User-Agent': 'SCT-AFK-Engine/1.0' }, timeout: 9000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = new URL(redirectUrl, urlStr).toString();
        }
        res.resume();
        return resolve(httpFetchUrl(redirectUrl, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('İstek zaman aşımına uğradı (Timeout)')); });
    req.on('error', reject);
  });
}

async function checkForUpdates() {
  const manifestUrl = getUpdateManifestUrl();
  try {
    const rawBuf = await httpFetchUrl(manifestUrl);
    const manifest = JSON.parse(rawBuf.toString('utf8'));
    const remoteBuildId = manifest.buildId || manifest.version || '';
    const hasUpdate = Boolean(remoteBuildId && remoteBuildId !== ENGINE_BUILD_ID);

    updateCheckState = {
      lastChecked: Date.now(),
      hasUpdate,
      latestBuildId: remoteBuildId,
      version: manifest.version || '2.2.0',
      releaseNotes: manifest.releaseNotes || '',
      error: null,
      manifestUrl
    };
    return updateCheckState;
  } catch (err) {
    updateCheckState = {
      ...updateCheckState,
      lastChecked: Date.now(),
      error: err.message,
      manifestUrl
    };
    return updateCheckState;
  }
}

async function applyHotUpdate() {
  if (updateCheckState.isUpdating) {
    throw new Error('Güncelleme işlemi zaten devam ediyor...');
  }
  updateCheckState.isUpdating = true;
  try {
    const manifestUrl = getUpdateManifestUrl();
    const rawBuf = await httpFetchUrl(manifestUrl);
    const manifest = JSON.parse(rawBuf.toString('utf8'));
    const owner = (config.updates && config.updates.repoOwner) || 'mrzaknafein';
    const repo = (config.updates && config.updates.repoName) || 'SCT-AFK-Service';
    const branch = (config.updates && config.updates.branch) || 'main';

    let indexJsUrl = (manifest.files && manifest.files['index.js']) || `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/index.js`;
    let indexHtmlUrl = (manifest.files && manifest.files['public/index.html']) || `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/public/index.html`;

    indexJsUrl = indexJsUrl.replace('{OWNER}', owner).replace('{REPO}', repo).replace('{BRANCH}', branch);
    indexHtmlUrl = indexHtmlUrl.replace('{OWNER}', owner).replace('{REPO}', repo).replace('{BRANCH}', branch);
    // GitHub raw CDN önbelleğini atla
    const cacheBust = `${indexJsUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
    indexJsUrl += cacheBust;
    indexHtmlUrl += `${indexHtmlUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;

    addLog(null, 'GÜNCELLEME', `Yeni sürüm (${manifest.buildId || manifest.version}) indiriliyor...`, chalk.cyan);

    const [newJsBuf, newHtmlBuf] = await Promise.all([
      httpFetchUrl(indexJsUrl),
      httpFetchUrl(indexHtmlUrl)
    ]);

    const newJsStr = newJsBuf.toString('utf8');
    const newHtmlStr = newHtmlBuf.toString('utf8');

    if (!newJsStr.includes('ENGINE_BUILD_ID') || newJsStr.length < 15000) {
      throw new Error('İndirilen index.js dosyası geçersiz veya bozuk!');
    }
    // Sonsuz güncelleme döngüsü koruması: indirilen motor, manifestteki sürümle birebir aynı olmalı
    const dlBuildMatch = newJsStr.match(/const ENGINE_BUILD_ID = '([^']+)'/);
    const dlBuildId = dlBuildMatch ? dlBuildMatch[1] : '';
    const expectedBuildId = manifest.buildId || '';
    if (!dlBuildId || (expectedBuildId && dlBuildId !== expectedBuildId) || dlBuildId === ENGINE_BUILD_ID) {
      throw new Error(`İndirilen motor sürümü (${dlBuildId || '?'}) beklenen sürümle (${expectedBuildId}) eşleşmiyor. Güncelleme iptal edildi, birkaç dakika sonra tekrar denenecek.`);
    }
    if (!newHtmlStr.includes('<!DOCTYPE html>') || newHtmlStr.length < 5000) {
      throw new Error('İndirilen index.html dosyası geçersiz veya bozuk!');
    }

    const tmpJsPath = path.join(__dirname, 'index.js.tmp');
    const tmpHtmlPath = path.join(path.dirname(HTML_PATH), 'index.html.tmp');

    fs.writeFileSync(tmpJsPath, newJsBuf);
    fs.writeFileSync(tmpHtmlPath, newHtmlBuf);

    // Atomik dosya değişimi
    fs.renameSync(tmpJsPath, path.join(__dirname, 'index.js'));
    fs.renameSync(tmpHtmlPath, HTML_PATH);

    // Zaman damgasını tazele
    const now = new Date();
    try {
      fs.utimesSync(path.join(__dirname, 'index.js'), now, now);
      fs.utimesSync(HTML_PATH, now, now);
    } catch (e) {}

    addLog(null, 'GÜNCELLEME', 'Güncelleme başarıyla yüklendi! Sistem 1.2 sn içinde yeniden başlatılıyor...', chalk.green);

    // Tüm botları güvenle kapat
    for (const a of config.accounts) {
      stopBot(a.id);
    }

    setTimeout(() => {
      try {
        const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
          cwd: __dirname,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: process.env
        });
        child.unref();
      } catch (e) {}
      process.exit(0);
    }, 1200);

    return { ok: true, buildId: manifest.buildId || manifest.version };
  } finally {
    updateCheckState.isUpdating = false;
  }
}

let config = loadConfig();
const sessions = new Map();
const recentLogs = [];
const sseClients = new Set();

let exeSyncTimer = null;

function rebuildPortableExe() {
  const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  const launcherCs = path.join(__dirname, 'Launcher.cs');
  const icoPath = path.join(__dirname, 'app.ico');
  if (!fs.existsSync(cscPath) || !fs.existsSync(launcherCs) || !fs.existsSync(icoPath)) return;

  const targetPaths = new Set();
  const defaultExe = path.join(__dirname, '..', 'minecraft-afk-client', 'SCT AFK Service.exe');
  if (fs.existsSync(path.dirname(defaultExe))) {
    targetPaths.add(defaultExe);
  }
  const exePathTxt = path.join(__dirname, 'exe_path.txt');
  if (fs.existsSync(exePathTxt)) {
    try {
      const recorded = fs.readFileSync(exePathTxt, 'utf8').trim();
      if (recorded && fs.existsSync(path.dirname(recorded))) {
        targetPaths.add(recorded);
      }
    } catch (e) {}
  }

  for (const outExe of targetPaths) {
    const args = [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      `/out:${outExe}`,
      `/win32icon:${icoPath}`,
      `/resource:${path.join(__dirname, 'package.json')},sct.package.json`,
      `/resource:${path.join(__dirname, 'index.js')},sct.index.js`,
      `/resource:${path.join(__dirname, 'public', 'index.html')},sct.index.html`,
      `/resource:${path.join(__dirname, 'public', 'logo.jpg')},sct.logo.jpg`,
      `/resource:${CONFIG_PATH},sct.config.json`,
      `/resource:${launcherCs},sct.Launcher.cs`,
      `/resource:${icoPath},sct.app.ico`,
      launcherCs
    ];
    execFile(cscPath, args, { windowsHide: true }, () => {});
  }
}

function saveConfig() {
  try {
    config.configVersion = Date.now();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error(chalk.red(`[HATA] config.json kaydedilemedi: ${err.message}`));
  }
}

function broadcastSSE(type, data) {
  const payload = `data: ${JSON.stringify({ type, data })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch (e) {
      sseClients.delete(res);
    }
  }
}

function triggerSoundAlert(alertType, accountId, message) {
  if (!config.soundAlerts || config.soundAlerts.enabled === false) return;
  if (alertType === 'damage' && config.soundAlerts.onDamage === false) return;
  if (alertType === 'disconnect' && config.soundAlerts.onDisconnect === false) return;
  if (alertType === 'mention' && config.soundAlerts.onMention === false) return;
  if (alertType === 'captcha' && config.soundAlerts.onCaptcha === false) return;

  const acc = config.accounts.find((a) => a.id === accountId);
  broadcastSSE('sound', {
    alertType,
    accountId,
    username: acc ? acc.username : 'Sistem',
    message
  });
}

function sendDesktopNotification(title, body, accountId = null) {
  if (!body) return;
  const cleanTitle = (title || 'SCT AFK Bildirimi').replace(/§[0-9a-fk-or]/gi, '');
  const cleanBody = String(body).replace(/§[0-9a-fk-or]/gi, '');
  const acc = accountId ? config.accounts.find((a) => a.id === accountId) : null;

  broadcastSSE('desktop-notification', {
    title: cleanTitle,
    body: cleanBody,
    accountId: accountId,
    username: acc ? acc.username : null,
    timestamp: Date.now()
  });
}

// --- DISCORD RICH PRESENCE (RPC) CLIENT (Named Pipe üzerinden sıfır bağımlılık) ---
class DiscordRPC {
  constructor(clientId) {
    this.clientId = clientId || '450485984333660181';
    this.socket = null;
    this.connected = false;
    this.ready = false;
    this.pendingActivity = null;
    this.reconnectTimeout = null;
    this.currentPipeIndex = 0;
  }

  connect() {
    if (this.socket && !this.socket.destroyed) return;
    this.tryPipe(0);
  }

  tryPipe(index) {
    if (index > 9) {
      this.handleDisconnect();
      return;
    }
    this.currentPipeIndex = index;
    const pipeName = `\\\\.\\pipe\\discord-ipc-${index}`;
    let sock = null;
    try {
      sock = net.createConnection(pipeName, () => {
        this.socket = sock;
        this.connected = true;
        this.sendHandshake();
      });

      sock.on('data', (data) => {
        try {
          if (data.length < 8) return;
          const op = data.readInt32LE(0);
          const len = data.readInt32LE(4);
          const bodyStr = data.slice(8, 8 + len).toString('utf8');
          const parsed = JSON.parse(bodyStr);

          if (parsed.evt === 'READY') {
            this.ready = true;
            if (this.pendingActivity) {
              const act = this.pendingActivity;
              this.pendingActivity = null;
              this.setActivity(act);
            }
          } else if (op === 2 && parsed.code === 4000) {
            // Invalid Client ID, fallback to official Minecraft client id
            if (this.clientId !== '450485984333660181') {
              this.clientId = '450485984333660181';
              this.handleDisconnect(1000);
            }
          }
        } catch (e) {}
      });

      sock.on('error', () => {
        if (!this.connected) {
          this.tryPipe(index + 1);
        } else {
          this.handleDisconnect();
        }
      });

      sock.on('close', () => {
        this.handleDisconnect();
      });
    } catch (e) {
      this.tryPipe(index + 1);
    }
  }

  handleDisconnect(delay = 15000) {
    this.connected = false;
    this.ready = false;
    if (this.socket) {
      try { this.socket.destroy(); } catch (e) {}
      this.socket = null;
    }
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  sendHandshake() {
    this.send(0, { v: 1, client_id: this.clientId });
  }

  setActivity(activity) {
    if (!this.ready || !this.connected) {
      this.pendingActivity = activity;
      if (!this.socket || this.socket.destroyed) {
        this.connect();
      }
      return;
    }

    const payload = {
      cmd: 'SET_ACTIVITY',
      args: {
        pid: process.pid,
        activity: activity
      },
      nonce: Math.random().toString()
    };
    this.send(1, payload);
  }

  send(op, payload) {
    if (!this.socket || this.socket.destroyed) return;
    try {
      const json = JSON.stringify(payload);
      const dataBuffer = Buffer.from(json);
      const header = Buffer.alloc(8);
      header.writeInt32LE(op, 0);
      header.writeInt32LE(dataBuffer.length, 4);
      this.socket.write(Buffer.concat([header, dataBuffer]));
    } catch (e) {
      this.handleDisconnect();
    }
  }
}

const rpcStartTime = Math.floor(Date.now() / 1000);
let discordRpcClient = null;
let lastRpcUpdateTime = 0;

function initDiscordRPC() {
  if (config.discordRpc?.enabled === false) {
    if (discordRpcClient) {
      if (discordRpcClient.socket) {
        try { discordRpcClient.socket.destroy(); } catch (e) {}
      }
      discordRpcClient = null;
    }
    return;
  }
  const clientId = config.discordRpc?.clientId || '450485984333660181';
  try {
    if (discordRpcClient && discordRpcClient.socket) {
      try { discordRpcClient.socket.destroy(); } catch (e) {}
      discordRpcClient = null;
    }
    discordRpcClient = new DiscordRPC(clientId);
    discordRpcClient.connect();
    setTimeout(() => {
      updateDiscordRPC(true);
    }, 1500);
  } catch (e) {}
}

function updateDiscordRPC(force = false) {
  if (!discordRpcClient || config.discordRpc?.enabled === false) return;
  const now = Date.now();
  if (!force && now - lastRpcUpdateTime < 3000) return;
  lastRpcUpdateTime = now;

  try {
    const rpcCfg = config.discordRpc || {};
    const onlineBots = Array.from(sessions.values()).filter((s) => s.status === 'online');
    const onlineCount = onlineBots.length;
    const totalCount = config.accounts.length;

    let details = '';
    const srvHost = config.server?.host || 'play.minertown.net';

    // Aktif bot modunu tespit et
    let activeModeLabel = '';
    const isBuilding = onlineBots.some((s) => s.builder && s.builder.isBuilding);
    const isMining = onlineBots.some((s) => s.autoMine);
    const isAttacking = onlineBots.some((s) => s.autoAttack);
    const isFarming = onlineBots.some((s) => s.autoFarm);
    const isTilling = onlineBots.some((s) => s.autoTill);
    const isPlanting = onlineBots.some((s) => s.autoPlant);
    const isRightClicking = onlineBots.some((s) => s.autoRightClick);
    const isChestDepositing = onlineBots.some((s) => s.autoChest);

    if (isBuilding) activeModeLabel = '🏗️ Oto-İnşa';
    else if (isMining) activeModeLabel = '⛏️ Maden Farmı';
    else if (isAttacking) activeModeLabel = '⚔️ Mob Farmı';
    else if (isFarming) activeModeLabel = '🌾 Oto-Hasat';
    else if (isTilling) activeModeLabel = '🌱 Oto-Çapala';
    else if (isPlanting) activeModeLabel = '🌿 Oto-Ekim';
    else if (isRightClicking) activeModeLabel = '🎣 Sağ Tık';
    else if (isChestDepositing) activeModeLabel = '📦 Oto-Depolama';
    else if (onlineCount > 0) activeModeLabel = '🛡️ AFK Nöbeti';

    // 1. Satır: Details (Sunucu IP'si, Bot Sayısı, Aktif Mod, Özel Metin)
    const detailParts = [];
    if (rpcCfg.showServer !== false) {
      if (onlineCount > 0) {
        detailParts.push(`${srvHost} (${onlineCount}/${totalCount} Bot)`);
      } else {
        detailParts.push(`${srvHost} • Boşta`);
      }
    } else if (onlineCount > 0) {
      detailParts.push(`${onlineCount}/${totalCount} Bot Aktif`);
    } else {
      detailParts.push('Boşta Bekliyor');
    }

    if (rpcCfg.showMode !== false && activeModeLabel && onlineCount > 0) {
      detailParts.push(activeModeLabel);
    }

    if (rpcCfg.customDetails) {
      details = `${rpcCfg.customDetails} • ${detailParts.join(' • ')}`;
    } else {
      details = detailParts.join(' • ');
    }

    // 2. Satır: State (Kullanıcının Seçtiği Zengin İstatistikler & Özellikler)
    let state = '';
    const parts = [];

    const totalMined = Array.from(sessions.values()).reduce((sum, s) => sum + (s.stats?.blocksMined || 0), 0);
    const totalHarvested = Array.from(sessions.values()).reduce((sum, s) => sum + (s.stats?.cropsHarvested || 0), 0);
    const totalMobs = Array.from(sessions.values()).reduce((sum, s) => sum + (s.stats?.mobsAttacked || 0), 0);
    const totalChests = Array.from(sessions.values()).reduce((sum, s) => sum + (s.stats?.chestsDeposited || 0), 0);
    const totalCaptchas = Array.from(sessions.values()).reduce((sum, s) => sum + (s.stats?.captchasSolved || 0), 0);

    // Kazılan Blok Sayısı (showStats geriye dönük uyumluluk veya showBlocks)
    if (rpcCfg.showBlocks !== false && rpcCfg.showStats !== false) {
      parts.push(`⛏️ ${totalMined.toLocaleString('tr-TR')} Blok`);
    }

    // Toplanan Ekin / Hasat Sayısı
    if (rpcCfg.showCrops !== false && (totalHarvested > 0 || isFarming)) {
      parts.push(`🌾 ${totalHarvested.toLocaleString('tr-TR')} Hasat`);
    }

    // Kesilen Mob / Canavar Sayısı
    if (rpcCfg.showMobs) {
      parts.push(`⚔️ ${totalMobs.toLocaleString('tr-TR')} Mob`);
    }

    // Sandığa Aktarılan Eşya / Depolama
    if (rpcCfg.showChests) {
      parts.push(`📦 ${totalChests.toLocaleString('tr-TR')} Depo`);
    }

    // Çözülen Güvenlik Doğrulamaları / Captcha
    if (rpcCfg.showCaptchas) {
      parts.push(`🛡️ ${totalCaptchas} Captcha`);
    }

    // Oto-İnşa Durumu & Yüzdesi
    if (rpcCfg.showBuilder) {
      const activeBuilderSession = onlineBots.find((s) => s.builder && s.builder.totalBlocks > 0);
      if (activeBuilderSession && activeBuilderSession.builder) {
        const b = activeBuilderSession.builder;
        const pct = b.totalBlocks > 0 ? Math.round((b.placedCount / b.totalBlocks) * 100) : 0;
        parts.push(`🏗️ %${pct} (${b.placedCount}/${b.totalBlocks})`);
      }
    }

    // Birinci aktif bot telemetrisi (Can, Açlık, Ping, Koordinat)
    const firstOnlineSession = onlineBots[0];
    const firstBot = firstOnlineSession?.bot;

    // Can & Açlık
    if (rpcCfg.showHealth && firstBot) {
      const hp = typeof firstBot.health === 'number' ? Math.round(firstBot.health) : null;
      const food = typeof firstBot.food === 'number' ? Math.round(firstBot.food) : null;
      if (hp !== null && food !== null) {
        parts.push(`❤️ ${hp} • 🍖 ${food}`);
      } else if (hp !== null) {
        parts.push(`❤️ ${hp}/20`);
      }
    }

    // Ping / Gecikme
    if (rpcCfg.showPing && firstOnlineSession) {
      const ping = firstOnlineSession.ping || 0;
      if (ping > 0) {
        parts.push(`📶 ${ping}ms`);
      }
    }

    // Koordinatlar
    if (rpcCfg.showCoords && firstBot && firstBot.entity && firstBot.entity.position) {
      const p = firstBot.entity.position;
      parts.push(`📍 [${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}]`);
    }

    // Hesap Adı
    if (rpcCfg.showAccount && onlineBots.length > 0) {
      const firstAcc = config.accounts.find((a) => a.id === onlineBots[0].accountId);
      if (firstAcc) {
        parts.push(onlineBots.length > 1 ? `👤 ${firstAcc.username} (+${onlineBots.length - 1})` : `👤 ${firstAcc.username}`);
      }
    }

    // Özel Ek Durum Metni
    if (rpcCfg.customState) {
      parts.push(rpcCfg.customState);
    }

    if (parts.length > 0) {
      state = parts.join(' • ');
    } else if (onlineCount > 0) {
      state = 'Sunucuda Aktif';
    } else {
      state = 'SCT AFK Servisi Hazır';
    }

    // Butonlar (Discord RPC en fazla 2 buton destekler; label ve http/https url zorunludur)
    const buttons = [];
    if (rpcCfg.button1Label && rpcCfg.button1Url && /^https?:\/\//i.test(rpcCfg.button1Url)) {
      buttons.push({ label: rpcCfg.button1Label.substring(0, 32), url: rpcCfg.button1Url });
    }
    if (rpcCfg.button2Label && rpcCfg.button2Url && /^https?:\/\//i.test(rpcCfg.button2Url)) {
      buttons.push({ label: rpcCfg.button2Label.substring(0, 32), url: rpcCfg.button2Url });
    }

    const assets = {
      large_image: rpcCfg.largeImageUrl || 'https://files.catbox.moe/lg3ryp.jpg',
      large_text: (rpcCfg.largeImageText || 'SCT AFK Service').substring(0, 128)
    };

    // Küçük Görsel: Oyuncu kafa avatarı veya özel görsel
    if (rpcCfg.showAvatar !== false && onlineBots.length > 0) {
      const firstAcc = config.accounts.find((a) => a.id === onlineBots[0].accountId);
      if (firstAcc) {
        assets.small_image = `https://mc-heads.net/avatar/${encodeURIComponent(firstAcc.username)}/32`;
        const hpStr = firstBot && typeof firstBot.health === 'number' ? ` • ❤️ ${Math.round(firstBot.health)}` : '';
        assets.small_text = `${firstAcc.username}${hpStr} • ${onlineCount} Bot Aktif`;
      }
    } else if (rpcCfg.smallImageUrl) {
      assets.small_image = rpcCfg.smallImageUrl;
      assets.small_text = onlineCount > 0 ? `${onlineCount}/${totalCount} Hesap Aktif` : 'Çevrimdışı';
    }

    const activity = {
      name: 'SCT AFK Service',
      details: details.substring(0, 128),
      state: state.substring(0, 128),
      assets: assets
    };

    // Zaman Damgası (Canlı Süre Sayacı)
    if (rpcCfg.showTime !== false) {
      activity.timestamps = {
        start: rpcStartTime
      };
    }

    if (buttons.length > 0) {
      activity.buttons = buttons;
    }

    discordRpcClient.setActivity(activity);
  } catch (e) {}
}

// 20 saniyede bir Discord RPC durumunu otomatik yenile
setInterval(() => {
  try {
    if (discordRpcClient && discordRpcClient.ready && config.discordRpc?.enabled !== false) {
      updateDiscordRPC(true);
    }
  } catch (e) {}
}, 20000);

function sendDiscordWebhook(title, description, color = 0x00f2fe, accountId = null, forceTest = false) {
  return new Promise((resolve) => {
    if (!forceTest && (!config.discord || !config.discord.enabled)) return resolve(false);
    const webhookUrl = config.discord && config.discord.webhookUrl ? String(config.discord.webhookUrl).trim() : '';
    if (!webhookUrl || !webhookUrl.startsWith('https://')) return resolve(false);

    const acc = accountId ? config.accounts.find((a) => a.id === accountId) : null;
    const srvHost = config.server ? `${config.server.host}:${config.server.port || 25565}` : 'Bilinmiyor';

    const payload = JSON.stringify({
      username: 'SCT AFK Service',
      embeds: [
        {
          title,
          description,
          color,
          fields: [
            ...(acc ? [{ name: 'Hesap', value: `\`${acc.username}\``, inline: true }] : []),
            { name: 'Sunucu', value: `\`${srvHost}\``, inline: true }
          ],
          footer: { text: 'SCT AFK Service • Otomatik Bildirim Sistemi' },
          timestamp: new Date().toISOString()
        }
      ]
    });

    try {
      const u = new URL(webhookUrl);
      const req = https.request(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
        }
      );
      req.on('error', () => resolve(false));
      req.write(payload);
      req.end();
    } catch (e) {
      resolve(false);
    }
  });
}

const MC_NAMED_COLOR_CODES = {
  black: '§0',
  dark_blue: '§1',
  dark_green: '§2',
  dark_aqua: '§3',
  dark_red: '§4',
  dark_purple: '§5',
  gold: '§6',
  gray: '§7',
  dark_gray: '§8',
  blue: '§9',
  green: '§a',
  aqua: '§b',
  red: '§c',
  light_purple: '§d',
  yellow: '§e',
  white: '§f'
};

function flattenChatComponent(comp) {
  if (!comp) return '';
  if (typeof comp === 'string') {
    if (comp.startsWith('{') || comp.startsWith('[')) {
      try {
        return flattenChatComponent(JSON.parse(comp));
      } catch (e) {
        return comp;
      }
    }
    return comp;
  }
  if (Array.isArray(comp)) {
    return comp.map(flattenChatComponent).join('');
  }
  let prefix = '';
  if (comp.color) {
    const colLower = String(comp.color).toLowerCase();
    if (MC_NAMED_COLOR_CODES[colLower]) {
      prefix += MC_NAMED_COLOR_CODES[colLower];
    } else if (colLower.startsWith('#')) {
      prefix += '&' + colLower;
    }
  }
  if (comp.bold) prefix += '§l';
  if (comp.italic) prefix += '§o';
  if (comp.underlined) prefix += '§n';
  if (comp.strikethrough) prefix += '§m';

  let str = prefix + (comp.text || comp.translate || '');
  if (Array.isArray(comp.extra)) {
    for (const part of comp.extra) {
      str += flattenChatComponent(part);
    }
  }
  return str;
}

function formatAnyComponent(raw) {
  if (!raw) return '';
  if (typeof raw === 'object' && raw.type && raw.value !== undefined) {
    try {
      raw = nbt.simplify(raw);
    } catch (e) {
      raw = raw.value || raw;
    }
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return flattenChatComponent(parsed);
      } catch (e) {
        return raw;
      }
    }
    return raw;
  }
  if (typeof raw === 'object') {
    return flattenChatComponent(raw);
  }
  return String(raw);
}

function parseWindowTitle(win) {
  if (!win || !win.title) return 'Açık Menü (GUI)';
  try {
    const flattened = flattenChatComponent(win.title);
    if (flattened && flattened.trim()) {
      return flattened.trim();
    }
  } catch (e) {}
  return String(win.title);
}

function getItemCustomName(item) {
  if (!item) return '';
  if (item.customName) return flattenChatComponent(item.customName);
  try {
    const nbtObj = item.nbt;
    if (nbtObj) {
      const display = nbtObj.value?.display?.value || nbtObj.value?.display || nbtObj.display;
      if (display && display.Name) {
        const rawName = display.Name.value !== undefined ? display.Name.value : display.Name;
        return flattenChatComponent(rawName);
      }
    }
  } catch (e) {}
  return item.displayName || '';
}

function getItemLoreList(item) {
  if (!item) return [];
  if (Array.isArray(item.customLore) && item.customLore.length > 0) {
    return item.customLore.map(flattenChatComponent).filter(Boolean);
  }
  try {
    const nbtObj = item.nbt;
    if (nbtObj) {
      const display = nbtObj.value?.display?.value || nbtObj.value?.display || nbtObj.display;
      if (display && display.Lore) {
        const rawLore = display.Lore.value !== undefined ? display.Lore.value : display.Lore;
        const rawArr = Array.isArray(rawLore) ? rawLore : (rawLore?.value && Array.isArray(rawLore.value) ? rawLore.value : []);
        return rawArr.map((line) => {
          const val = line && line.value !== undefined ? line.value : line;
          return flattenChatComponent(val);
        }).filter(Boolean);
      }
    }
  } catch (e) {}
  return [];
}

function getItemLoreText(item) {
  const list = getItemLoreList(item);
  return list.join(' ');
}

function getItemDurability(item) {
  if (!item) return null;
  const max = item.maxDurability;
  if (!max || typeof max !== 'number' || max <= 0) return null;
  let used = 0;
  if (typeof item.durabilityUsed === 'number') {
    used = item.durabilityUsed;
  } else if (item.nbt?.value?.Damage?.value !== undefined) {
    used = Number(item.nbt.value.Damage.value);
  } else if (typeof item.metadata === 'number' && item.metadata > 0) {
    used = item.metadata;
  }
  const current = Math.max(0, max - used);
  const percent = Math.max(0, Math.min(100, Math.round((current / max) * 100)));
  return {
    current,
    max,
    used,
    percent
  };
}

function formatItemForClient(item, slotIndex) {
  if (!item) return null;
  const slot = item.slot !== undefined ? item.slot : slotIndex;
  const custom = getItemCustomName(item);
  const displayName = custom || item.displayName || item.name || 'Hava';
  const loreList = getItemLoreList(item);
  const durability = getItemDurability(item);
  return {
    slot,
    name: item.name || 'air',
    displayName,
    count: item.count || 1,
    lore: loreList,
    durability
  };
}

function stripMinecraftCodes(str) {
  if (!str) return '';
  return String(str).replace(/[§&][0-9a-fk-or]/gi, '').trim();
}

function cleanMinecraftPUA(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\uE000-\uF8FF]/gu, '')
    .replace(/[\u{E0000}-\u{E007F}\u{F0000}-\u{10FFFD}]/gu, '')
    .trim();
}

const MC_FORMATTING_COLORS = [
  '§0', '§1', '§2', '§3', '§4', '§5', '§6', '§7',
  '§8', '§9', '§a', '§b', '§c', '§d', '§e', '§f',
  '§k', '§l', '§m', '§n', '§o', '§r'
];

function initSessionScoreboard(session) {
  if (!session) return;
  if (!session.scoreboard) {
    session.scoreboard = {
      objectives: {},
      displayPositions: {},
      sidebarObjective: null,
      scores: {},
      teams: {},
      teamMemberToTeam: {}
    };
  }
}

function attachScoreboardTracker(bot, session, accountId) {
  if (!bot || !bot._client) return;
  initSessionScoreboard(session);
  const client = bot._client;
  const sb = session.scoreboard;

  const triggerUpdate = () => {
    debouncedBroadcastState(100);
  };

  // 1. OBJECTIVE: scoreboard_objective
  client.on('scoreboard_objective', (packet) => {
    try {
      const name = packet.name;
      if (!name) return;
      if (packet.action === 0) { // create
        const title = formatAnyComponent(packet.displayText) || name;
        sb.objectives[name] = { name, title, displayText: packet.displayText };
        if (!sb.scores[name]) sb.scores[name] = {};
        if (!sb.sidebarObjective) sb.sidebarObjective = name;
        triggerUpdate();
      } else if (packet.action === 1) { // remove
        delete sb.objectives[name];
        delete sb.scores[name];
        if (sb.sidebarObjective === name) {
          sb.sidebarObjective = Object.keys(sb.objectives)[0] || null;
        }
        triggerUpdate();
      } else if (packet.action === 2) { // update title
        if (sb.objectives[name]) {
          sb.objectives[name].title = formatAnyComponent(packet.displayText) || sb.objectives[name].title;
          sb.objectives[name].displayText = packet.displayText;
        } else {
          sb.objectives[name] = { name, title: formatAnyComponent(packet.displayText) || name, displayText: packet.displayText };
          if (!sb.scores[name]) sb.scores[name] = {};
        }
        triggerUpdate();
      }
    } catch (e) {}
  });

  // 2. DISPLAY OBJECTIVE: scoreboard_display_objective
  client.on('scoreboard_display_objective', (packet) => {
    try {
      const pos = packet.position;
      const objName = packet.name;
      sb.displayPositions[pos] = objName;
      sb.displayPositions[String(pos)] = objName;

      // Position 1 is sidebar (or string 'sidebar' or '1')
      if (pos === 1 || String(pos) === '1' || String(pos).toLowerCase() === 'sidebar') {
        sb.sidebarObjective = objName;
      }
      triggerUpdate();
    } catch (e) {}
  });

  // 3. SCORE: scoreboard_score (Supports both pre-1.20.3 action=0/1 and 1.20.3+ action=undefined)
  client.on('scoreboard_score', (packet) => {
    try {
      const objName = packet.scoreName;
      const itemName = packet.itemName;
      if (!objName || !itemName) return;

      if (!sb.scores[objName]) {
        sb.scores[objName] = {};
      }

      // Pre-1.20.3 explicit remove packet
      if (packet.action === 1) {
        delete sb.scores[objName][itemName];
      } else {
        let dn = '';
        if (packet.display_name) {
          dn = formatAnyComponent(packet.display_name);
        }
        sb.scores[objName][itemName] = {
          itemName,
          value: typeof packet.value === 'number' ? packet.value : 0,
          displayName: dn
        };
      }

      // Mineflayer compatibility fallback: feed into bot.scoreboards
      if (bot.scoreboards && bot.scoreboards[objName]) {
        try {
          if (packet.action === 1) {
            bot.scoreboards[objName].remove(itemName);
          } else {
            bot.scoreboards[objName].add(itemName, packet.value);
          }
        } catch (e) {}
      }

      triggerUpdate();
    } catch (e) {}
  });

  // 4. RESET SCORE: reset_score (Minecraft 1.20.3+)
  client.on('reset_score', (packet) => {
    try {
      const entity = packet.entity_name;
      const objName = packet.objective_name;
      if (!entity) return;

      if (objName) {
        if (sb.scores[objName]) {
          delete sb.scores[objName][entity];
        }
      } else {
        for (const k of Object.keys(sb.scores)) {
          delete sb.scores[k][entity];
        }
      }
      triggerUpdate();
    } catch (e) {}
  });

  // 5. TEAMS: teams / scoreboard_team
  const handleTeamPacket = (packet) => {
    try {
      if (!packet) return;
      const tName = packet.team;
      if (!tName) return;

      // Mode normalization (handles number 0..4, numeric string, and enum words 'add', 'remove', etc.)
      const TEAM_MODES = ['add', 'remove', 'change', 'join', 'leave'];
      let mode = packet.mode;
      if (typeof mode === 'string') {
        const idx = TEAM_MODES.indexOf(mode.toLowerCase());
        if (idx !== -1) mode = idx;
        else mode = parseInt(mode, 10);
      }
      if (typeof mode !== 'number' || isNaN(mode)) mode = 0;

      // Sanitize undefined NBT properties so subsequent Mineflayer listeners won't crash on fromNotch(undefined)
      const emptyNbt = { type: 'compound', name: '', value: {} };
      if (!packet.name) packet.name = emptyNbt;
      if (!packet.prefix) packet.prefix = emptyNbt;
      if (!packet.suffix) packet.suffix = emptyNbt;

      const players = Array.isArray(packet.players) ? packet.players : [];

      let team = sb.teams[tName];
      if (!team) {
        team = { name: tName, prefix: '', suffix: '', color: '', members: new Set() };
      }

      const colorStr = (typeof packet.formatting === 'number' && packet.formatting >= 0 && packet.formatting < MC_FORMATTING_COLORS.length)
        ? MC_FORMATTING_COLORS[packet.formatting]
        : '';

      if (mode === 0) { // create team
        team.name = formatAnyComponent(packet.name) || tName;
        team.prefix = formatAnyComponent(packet.prefix) || '';
        team.suffix = formatAnyComponent(packet.suffix) || '';
        team.color = colorStr;
        team.members = new Set(players);
        sb.teams[tName] = team;
        for (const p of players) {
          sb.teamMemberToTeam[p] = tName;
        }
      } else if (mode === 1) { // remove team
        if (sb.teams[tName]) {
          for (const m of sb.teams[tName].members) {
            delete sb.teamMemberToTeam[m];
          }
          delete sb.teams[tName];
        }
      } else if (mode === 2) { // update info (FastBoard line updates arrive here!)
        if (packet.prefix !== undefined) team.prefix = formatAnyComponent(packet.prefix) || '';
        if (packet.suffix !== undefined) team.suffix = formatAnyComponent(packet.suffix) || '';
        if (packet.name !== undefined) team.name = formatAnyComponent(packet.name) || team.name;
        if (packet.formatting !== undefined) team.color = colorStr;
        sb.teams[tName] = team;
      } else if (mode === 3) { // add players
        for (const p of players) {
          team.members.add(p);
          sb.teamMemberToTeam[p] = tName;
        }
        sb.teams[tName] = team;
      } else if (mode === 4) { // remove players
        for (const p of players) {
          team.members.delete(p);
          if (sb.teamMemberToTeam[p] === tName) {
            delete sb.teamMemberToTeam[p];
          }
        }
      }
      triggerUpdate();
    } catch (e) {}
  };

  client.prependListener('teams', handleTeamPacket);
  client.prependListener('scoreboard_team', handleTeamPacket);
}

function getScoreboardData(bot, session) {
  // 1. Önce sürümden bağımsız session.scoreboard'u kullan
  if (session && session.scoreboard) {
    const sb = session.scoreboard;
    let objName = sb.sidebarObjective;
    if (!objName || !sb.objectives[objName]) {
      objName = sb.displayPositions['1'] || sb.displayPositions[1] || sb.displayPositions['sidebar'];
    }
    if (!objName || !sb.objectives[objName]) {
      const objKeys = Object.keys(sb.objectives);
      if (objKeys.length > 0) {
        objName = objKeys[0];
      }
    }

    if (objName && sb.objectives[objName]) {
      const obj = sb.objectives[objName];
      const scoresMap = sb.scores[objName] || {};
      const scoreItems = Object.values(scoresMap);

      if (scoreItems.length > 0 || obj.title) {
        const sorted = [...scoreItems].sort((a, b) => (b.value || 0) - (a.value || 0));

        let extractedMoney = null;
        let extractedRank = null;
        let extractedIslandLevel = null;

        let rawTitle = obj.title || 'Scoreboard';
        let cleanTitle = cleanMinecraftPUA(stripMinecraftCodes(rawTitle));
        let title = cleanTitle.length > 0 ? cleanMinecraftPUA(rawTitle) : 'MINERTOWN';

        const lines = sorted.map((it) => {
          let formattedText = '';
          const rawItemName = it.itemName || it.name || '';
          const isPureColorCode = /^(?:§[0-9a-fk-or])+$/i.test(rawItemName);

          // 1. Packet display_name
          if (it.displayName && cleanMinecraftPUA(it.displayName).trim()) {
            formattedText = it.displayName;
          }

          // 2. session.scoreboard team mapping
          if (!formattedText) {
            const teamName = sb.teamMemberToTeam[rawItemName];
            const team = teamName ? sb.teams[teamName] : null;
            if (team) {
              const p = team.prefix || '';
              const s = team.suffix || '';
              if (isPureColorCode) {
                formattedText = p + (team.color || '') + s;
              } else {
                formattedText = p + (team.color || '') + rawItemName + s;
              }
            }
          }

          // 3. Fallback: Mineflayer teamMap
          if (!formattedText && bot && bot.teamMap && bot.teamMap[rawItemName]) {
            try {
              const mTeam = bot.teamMap[rawItemName];
              if (typeof mTeam.displayName === 'function') {
                const dn = mTeam.displayName(rawItemName);
                if (dn) {
                  let motd = typeof dn.toMotd === 'function' ? dn.toMotd() : dn.toString();
                  if (motd) {
                    if (isPureColorCode) {
                      formattedText = motd.replace(rawItemName, '');
                    } else {
                      formattedText = motd;
                    }
                  }
                }
              }
              if (!formattedText && mTeam.prefix) {
                const p = formatAnyComponent(mTeam.prefix);
                const s = formatAnyComponent(mTeam.suffix);
                formattedText = p + s;
              }
            } catch (e) {}
          }

          // 4. Fallback: if not pure color codes, use rawItemName
          if (!formattedText && !isPureColorCode) {
            formattedText = rawItemName;
          }

          formattedText = cleanMinecraftPUA(formattedText);

          const clean = stripMinecraftCodes(formattedText || '');
          const mMatch = clean.match(/(?:para|bakiye|coin|coins|money|dolares|bakiye\s*tl)\s*[:：]\s*([^\s]+)/i);
          if (mMatch && !extractedMoney) {
            extractedMoney = mMatch[1];
          }
          const rMatch = clean.match(/(?:rütbe|rutbe|rank)\s*[:：]\s*(.+)/i);
          if (rMatch && !extractedRank) {
            extractedRank = rMatch[1].trim();
          }
          const aMatch = clean.match(/(?:ada\s*seviye(?:si)?|island\s*level)\s*[:：]\s*(.+)/i);
          if (aMatch && !extractedIslandLevel) {
            extractedIslandLevel = aMatch[1].trim();
          }

          return {
            name: rawItemName,
            value: it.value,
            text: formattedText,
            plain: clean
          };
        });

        return {
          title: String(title),
          lines,
          money: extractedMoney,
          rank: extractedRank,
          islandLevel: extractedIslandLevel
        };
      }
    }
  }

  // 2. Geriye dönük uyumluluk: Mineflayer yerleşik scoreboard
  if (!bot) return null;

  let sidebar = null;
  if (bot.scoreboard) {
    sidebar = bot.scoreboard.sidebar || bot.scoreboard[1] || bot.scoreboard['1'] || bot.scoreboard['sidebar'];
  }
  if (!sidebar && bot.scoreboards) {
    const list = Object.values(bot.scoreboards);
    sidebar = list.find((s) => s.name === 'sidebar' || s.name === 'belowname') || list[0];
  }
  if (!sidebar) return null;

  let rawTitle = sidebar.title || 'Scoreboard';
  if (typeof rawTitle === 'object') {
    rawTitle = formatAnyComponent(rawTitle);
  }
  let cleanTitle = cleanMinecraftPUA(stripMinecraftCodes(rawTitle));
  let title = cleanTitle.length > 0 ? cleanMinecraftPUA(rawTitle) : 'MINERTOWN';

  const items = Array.isArray(sidebar.items) ? sidebar.items : (sidebar.itemsMap ? Object.values(sidebar.itemsMap) : []);
  if (!items || items.length === 0) {
    return {
      title: String(title),
      lines: [],
      money: null,
      rank: null,
      islandLevel: null
    };
  }

  // Değere göre azalan sırada sırala (Minecraft standardı: 15, 14, 13 ...)
  const sorted = [...items].sort((a, b) => (b.value || 0) - (a.value || 0));

  let extractedMoney = null;
  let extractedRank = null;
  let extractedIslandLevel = null;

  const lines = sorted.map((it) => {
    let formattedText = '';
    let plainText = '';
    const rawItemName = it.name || '';
    const isPureColorCode = /^(?:§[0-9a-fk-or])+$/i.test(rawItemName);

    try {
      const dn = it.displayName;
      if (dn) {
        if (typeof dn.toMotd === 'function') {
          formattedText = dn.toMotd();
        } else if (typeof dn.toAnsi === 'function') {
          formattedText = dn.toAnsi();
        } else if (typeof dn.toString === 'function') {
          formattedText = dn.toString();
        } else {
          formattedText = String(dn);
        }
        plainText = typeof dn.toString === 'function' ? dn.toString() : String(dn);
      } else {
        formattedText = !isPureColorCode ? rawItemName : '';
        plainText = !isPureColorCode ? rawItemName : '';
      }
    } catch (e) {
      formattedText = !isPureColorCode ? rawItemName : '';
      plainText = !isPureColorCode ? rawItemName : '';
    }

    if (bot.teamMap && bot.teamMap[rawItemName]) {
      try {
        const team = bot.teamMap[rawItemName];
        if (typeof team.displayName === 'function') {
          const teamDn = team.displayName(rawItemName);
          if (teamDn) {
            let motd = typeof teamDn.toMotd === 'function' ? teamDn.toMotd() : (typeof teamDn.toString === 'function' ? teamDn.toString() : '');
            if (motd) {
              formattedText = isPureColorCode ? motd.replace(rawItemName, '') : motd;
            }
            if (typeof teamDn.toString === 'function') {
              plainText = isPureColorCode ? teamDn.toString().replace(rawItemName, '') : teamDn.toString();
            }
          }
        }
      } catch (e) {}
    }

    formattedText = cleanMinecraftPUA(formattedText);

    const clean = stripMinecraftCodes(plainText || formattedText || '');
    const mMatch = clean.match(/(?:para|bakiye|coin|coins|money|dolares|bakiye\s*tl)\s*[:：]\s*([^\s]+)/i);
    if (mMatch && !extractedMoney) {
      extractedMoney = mMatch[1];
    }
    const rMatch = clean.match(/(?:rütbe|rutbe|rank)\s*[:：]\s*(.+)/i);
    if (rMatch && !extractedRank) {
      extractedRank = rMatch[1].trim();
    }
    const aMatch = clean.match(/(?:ada\s*seviye|ada\s*seviyesi|island\s*level)\s*[:：]\s*(.+)/i);
    if (aMatch && !extractedIslandLevel) {
      extractedIslandLevel = aMatch[1].trim();
    }

    return {
      name: rawItemName,
      value: it.value,
      text: formattedText || plainText || '',
      plain: clean
    };
  });

  return {
    title: String(title),
    lines,
    money: extractedMoney,
    rank: extractedRank,
    islandLevel: extractedIslandLevel
  };
}

function getPublicState() {
  const botsState = {};
  for (const acc of config.accounts) {
    const s = sessions.get(acc.id);
    if (!s) {
      botsState[acc.id] = {
        status: 'offline',
        autoMine: false,
        autoAttack: false,
        autoRightClick: false,
        autoChest: false,
        autoFarm: false,
        autoTill: false,
        autoPlant: false,
        autoChainTillPlant: acc.autoChainTillPlant !== false,
        sneakLock: false,
        ping: 0,
        stats: {
          blocksMined: 0,
          mobsAttacked: 0,
          captchasSolved: 0,
          chestsDeposited: 0,
          cropsHarvested: 0,
          blocksTilled: 0,
          cropsPlanted: 0,
          farmerSalesCount: 0,
          repairsCount: 0,
          connectedSince: null
        },
        autoFarmerSell: acc.autoFarmerSell || { enabled: false, intervalSec: 120 },
        isFarmerSelling: false,
        lastFarmerSellTime: 0,
        heldItem: null,
        inventory: [],
        openWindow: null,
        scoreboard: null,
        players: [],
        clientBrand: resolveAccountBrand(acc),
        serverBrand: null,
        hwid: acc.hwid || '',
        builder: getPublicBuilderSummary(null, acc.id)
      };
    } else {
      const bot = s.bot;
      const pos =
        bot && bot.entity && bot.entity.position
          ? {
              x: Math.floor(bot.entity.position.x),
              y: Math.floor(bot.entity.position.y),
              z: Math.floor(bot.entity.position.z)
            }
          : null;
      const players = bot && bot.players ? Object.keys(bot.players) : [];
      const ping =
        bot && s.status === 'online' && bot.player && typeof bot.player.ping === 'number'
          ? bot.player.ping
          : 0;

      let heldItem = null;
      let inventory = [];
      let openWindow = null;

      if (bot && s.status === 'online') {
        if (bot.heldItem) {
          heldItem = formatItemForClient(bot.heldItem, bot.heldItem.slot);
        } else {
          const handSlot = getActiveHandSlot(bot);
          if (handSlot >= 0 && bot.inventory && bot.inventory.slots) {
            const it = bot.inventory.slots[handSlot];
            if (it) heldItem = formatItemForClient(it, handSlot);
          }
        }

        if (bot.inventory && typeof bot.inventory.items === 'function') {
          inventory = bot.inventory.items().map((it) => formatItemForClient(it, it.slot)).filter(Boolean);
        }

        if (bot.currentWindow) {
          const win = bot.currentWindow;
          const containerEnd = win.inventoryStart || Math.min(win.slots.length, 54);
          const windowSlots = [];
          for (let i = 0; i < containerEnd; i++) {
            const it = win.slots[i];
            if (it) {
              const formatted = formatItemForClient(it, i);
              if (formatted) windowSlots.push(formatted);
            }
          }
          openWindow = {
            title: parseWindowTitle(win),
            slotCount: containerEnd,
            items: windowSlots
          };
        }
      }

      botsState[acc.id] = {
        status: s.status,
        autoMine: Boolean(s.autoMine),
        autoAttack: Boolean(s.autoAttack),
        autoRightClick: Boolean(s.autoRightClick),
        autoChest: Boolean(s.autoChest),
        autoFarm: Boolean(s.autoFarm),
        autoTill: Boolean(s.autoTill),
        autoPlant: Boolean(s.autoPlant),
        autoChainTillPlant: s.builder ? s.builder.autoChainTillPlant !== false : acc.autoChainTillPlant !== false,
        sneakLock: Boolean(s.sneakLock),
        ping,
        stats: s.stats || {
          blocksMined: 0,
          mobsAttacked: 0,
          captchasSolved: 0,
          chestsDeposited: 0,
          cropsHarvested: 0,
          blocksTilled: 0,
          cropsPlanted: 0,
          farmerSalesCount: 0,
          repairsCount: 0,
          connectedSince: null
        },
        autoFarmerSell: acc.autoFarmerSell || { enabled: false, intervalSec: 120 },
        isFarmerSelling: Boolean(s.isFarmerSelling),
        lastFarmerSellTime: s.lastFarmerSellTime || 0,
        health: bot && typeof bot.health === 'number' ? Math.round(bot.health) : 20,
        food: bot && typeof bot.food === 'number' ? Math.round(bot.food) : 20,
        version: bot && bot.version ? bot.version : null,
        position: pos,
        yaw: bot && bot.entity && typeof bot.entity.yaw === 'number' ? bot.entity.yaw : 0,
        pitch: bot && bot.entity && typeof bot.entity.pitch === 'number' ? bot.entity.pitch : 0,
        heldItem,
        inventory,
        openWindow,
        scoreboard: getScoreboardData(bot, s),
        players,
        clientBrand: resolveAccountBrand(acc),
        serverBrand: bot && bot.game && bot.game.serverBrand ? bot.game.serverBrand : null,
        hwid: acc.hwid || '',
        builder: getPublicBuilderSummary(s, acc.id)
      };
    }
  }

  return {
    keyauth: getPublicKeyAuthStatus(),
    config,
    bots: botsState,
    update: {
      currentBuildId: ENGINE_BUILD_ID,
      ...updateCheckState
    }
  };
}

const HOSTILE_MOB_NAMES = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman', 'witch',
  'slime', 'magma_cube', 'blaze', 'ghast', 'pillager', 'vindicator', 'evoker',
  'ravager', 'vex', 'warden', 'piglin_brute', 'wither_skeleton', 'drowned',
  'husk', 'stray', 'phantom', 'silverfish', 'endermite', 'guardian', 'elder_guardian',
  'shulker', 'hoglin', 'zoglin', 'breeze', 'bogged'
]);

function buildRadarSnapshot(accountId, query = {}) {
  const acc = config.accounts.find((a) => a.id === accountId) || config.accounts[0];
  if (!acc) return { online: false };
  const s = sessions.get(acc.id);
  const bot = s && s.bot;
  if (!bot || !bot.entity || !bot.entity.position || s.status !== 'online') {
    return {
      online: false,
      accountId: acc.id,
      username: acc.username,
      clientBrand: resolveAccountBrand(acc),
      hwid: acc.hwid || ''
    };
  }

  const radius = Math.max(6, Math.min(18, Number(query.radius) || 12));
  const scanMode = query.mode === 'slice' ? 'slice' : 'surface';
  const yOffset = Math.max(-4, Math.min(4, Number(query.yOffset) || 0));

  const pos = bot.entity.position;
  const baseVec = pos.floored();
  const bx = baseVec.x;
  const by = baseVec.y;
  const bz = baseVec.z;

  const grid = [];
  for (let dz = -radius; dz <= radius; dz++) {
    const row = [];
    for (let dx = -radius; dx <= radius; dx++) {
      let blockName = 'air';
      let relY = 0;

      if (scanMode === 'slice') {
        const bAt = bot.blockAt(baseVec.offset(dx, yOffset, dz));
        if (bAt && bAt.name && bAt.name !== 'air' && bAt.name !== 'cave_air' && bAt.name !== 'void_air') {
          blockName = bAt.name;
          relY = yOffset;
        } else {
          const bBelow = bot.blockAt(baseVec.offset(dx, yOffset - 1, dz));
          if (bBelow && bBelow.name && bBelow.name !== 'air' && bBelow.name !== 'cave_air' && bBelow.name !== 'void_air') {
            blockName = bBelow.name;
            relY = yOffset - 1;
          }
        }
      } else {
        for (let dy = 2; dy >= -6; dy--) {
          const b = bot.blockAt(baseVec.offset(dx, dy, dz));
          if (b && b.name && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air') {
            blockName = b.name;
            relY = dy;
            break;
          }
        }
      }
      row.push({ n: blockName, y: relY });
    }
    grid.push(row);
  }

  const entities = [];
  if (bot.entities) {
    for (const ent of Object.values(bot.entities)) {
      if (!ent || ent === bot.entity || !ent.position) continue;
      const eName = (ent.name || '').toLowerCase();
      if (eName === 'experience_orb' || eName === 'arrow') continue;

      const dx = ent.position.x - pos.x;
      const dy = ent.position.y - pos.y;
      const dz = ent.position.z - pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 45) continue;

      let category = 'passive';
      if (ent.type === 'player') {
        category = 'player';
      } else if (eName === 'item' || ent.type === 'object') {
        category = 'item';
      } else if (HOSTILE_MOB_NAMES.has(eName) || ent.type === 'hostile') {
        category = 'hostile';
      }

      const label = ent.username || ent.displayName || ent.name || 'Varlık';
      entities.push({
        id: ent.id,
        category,
        label,
        x: Math.floor(ent.position.x),
        y: Math.floor(ent.position.y),
        z: Math.floor(ent.position.z),
        dx: Number(dx.toFixed(2)),
        dy: Number(dy.toFixed(1)),
        dz: Number(dz.toFixed(2)),
        dist: Number(dist.toFixed(1)),
        yaw: typeof ent.yaw === 'number' ? ent.yaw : 0
      });
    }
  }
  entities.sort((a, b) => a.dist - b.dist);

  return {
    online: true,
    accountId: acc.id,
    username: acc.username,
    radius,
    mode: scanMode,
    bot: {
      x: bx,
      y: by,
      z: bz,
      exactX: Number(pos.x.toFixed(2)),
      exactY: Number(pos.y.toFixed(2)),
      exactZ: Number(pos.z.toFixed(2)),
      yaw: typeof bot.entity.yaw === 'number' ? bot.entity.yaw : 0,
      pitch: typeof bot.entity.pitch === 'number' ? bot.entity.pitch : 0,
      dimension: (bot.game && bot.game.dimension) || 'overworld',
      clientBrand: resolveAccountBrand(acc),
      serverBrand: (bot.game && bot.game.serverBrand) || null,
      hwid: acc.hwid || ''
    },
    grid,
    entities: entities.slice(0, 40)
  };
}

let broadcastDebounceTimer = null;
let lastStateBroadcastTime = 0;
const MIN_STATE_BROADCAST_INTERVAL_MS = 140;

function debouncedBroadcastState(delay = 120) {
  if (broadcastDebounceTimer) return;
  broadcastDebounceTimer = setTimeout(() => {
    broadcastDebounceTimer = null;
    broadcastState();
  }, delay);
}

function flushBroadcastStateNow() {
  if (broadcastDebounceTimer) {
    clearTimeout(broadcastDebounceTimer);
    broadcastDebounceTimer = null;
  }
  lastStateBroadcastTime = Date.now();
  broadcastSSE('state', getPublicState());
  updateDiscordRPC();
}

function broadcastState(immediate = false) {
  if (immediate) {
    flushBroadcastStateNow();
    return;
  }
  const now = Date.now();
  const elapsed = now - lastStateBroadcastTime;
  if (elapsed >= MIN_STATE_BROADCAST_INTERVAL_MS) {
    flushBroadcastStateNow();
  } else if (!broadcastDebounceTimer) {
    broadcastDebounceTimer = setTimeout(() => {
      broadcastDebounceTimer = null;
      flushBroadcastStateNow();
    }, Math.max(30, MIN_STATE_BROADCAST_INTERVAL_MS - elapsed));
  }
}

function addLog(accountId, tag, message, colorFn = chalk.white) {
  const time = new Date().toLocaleTimeString('tr-TR');
  const acc = config.accounts.find((a) => a.id === accountId);
  const username = acc ? acc.username : '';

  const entry = {
    time,
    accountId,
    username,
    tag,
    message: String(message)
  };

  recentLogs.push(entry);
  if (recentLogs.length > 400) recentLogs.shift();

  const prefix = username ? chalk.cyan(`[${username}] `) : '';
  console.log(`${chalk.gray(`[${time}]`)} ${prefix}${colorFn(`[${tag}]`)} ${message}`);

  broadcastSSE('log', entry);
}

function buildSmartRegisterCommand(message, account) {
  const password = account.password || '';
  const email = account.email || 'ornek@gmail.com';
  const fallbackTemplate = (config.autoAuth && config.autoAuth.registerCommand) || '/register {password} {email}';

  if (!config.autoAuth || config.autoAuth.smartDetect === false) {
    return fallbackTemplate
      .replace(/\{password\}/g, password)
      .replace(/\{email\}/g, email);
  }

  const bracketPattern = /\/(register|reg|kayit|kayıt)\s+((?:[<\[({][^>\]})]+[>\]})]\s*)+)/i;
  const match = message.match(bracketPattern);

  if (match) {
    const cmdPrefix = `/${match[1].toLowerCase() === 'kayıt' ? 'kayit' : match[1].toLowerCase()}`;
    const rawParams = match[2];
    const tokens = rawParams.match(/[<\[({]([^>\]})]+)[>\]})]/g) || [];

    const mappedArgs = [];
    for (const token of tokens) {
      const t = token.toLowerCase();
      if (t.includes('mail') || t.includes('posta') || t.includes('@')) {
        mappedArgs.push(email);
      } else if (
        t.includes('şifre') ||
        t.includes('sifre') ||
        t.includes('pass') ||
        t.includes('parola') ||
        t.includes('tekrar') ||
        t.includes('confirm')
      ) {
        mappedArgs.push(password);
      }
    }

    if (mappedArgs.length > 0) {
      return `${cmdPrefix} ${mappedArgs.join(' ')}`;
    }
  }

  const lower = message.toLowerCase();
  const mentionsEmail =
    lower.includes('eposta') ||
    lower.includes('e-posta') ||
    lower.includes('email') ||
    lower.includes('e-mail') ||
    lower.includes('mail');

  const mentionsRepeatPass =
    lower.includes('şifre tekrar') ||
    lower.includes('sifre tekrar') ||
    lower.includes('şifre şifre') ||
    lower.includes('sifre sifre') ||
    lower.includes('confirm password');

  if (mentionsEmail) {
    if (mentionsRepeatPass) {
      return `/register ${password} ${password} ${email}`;
    }
    return `/register ${password} ${email}`;
  }

  if (mentionsRepeatPass) {
    return `/register ${password} ${password}`;
  }

  return fallbackTemplate
    .replace(/\{password\}/g, password)
    .replace(/\{email\}/g, email);
}

function getOrCreateSession(accountId) {
  if (!sessions.has(accountId)) {
    sessions.set(accountId, {
      accountId,
      bot: null,
      status: 'offline',
      autoMine: false,
      autoAttack: false,
      autoRightClick: false,
      autoChest: false,
      autoFarm: false,
      autoTill: false,
      autoPlant: false,
      sneakLock: false,
      isDropping: false,
      isEating: false,
      isDepositing: false,
      isFarmingCrop: false,
      farmingStartTime: 0,
      lastAutoSellTime: 0,
      lastFarmPos: null,
      lastFarmMoveTime: 0,
      tillTimer: null,
      tillLoopId: 0,
      tillCurrentPath: null,
      tillTargetDirtPos: null,
      tillBlacklist: null,
      plantTimer: null,
      plantLoopId: 0,
      plantCurrentPath: null,
      plantTargetDirtPos: null,
      plantBlacklist: null,
      lastHealth: 20,
      lastCaptchaTime: 0,
      stats: {
        blocksMined: 0,
        mobsAttacked: 0,
        captchasSolved: 0,
        chestsDeposited: 0,
        blocksPlaced: 0,
        cropsHarvested: 0,
        blocksTilled: 0,
        cropsPlanted: 0,
        farmerSalesCount: 0,
        repairsCount: 0,
        connectedSince: null
      },
      farmerSellTimer: null,
      isFarmerSelling: false,
      lastFarmerSellTime: 0,
      builder: createDefaultBuilderState(accountId),
      scoreboard: {
        objectives: {},
        displayPositions: {},
        sidebarObjective: null,
        scores: {},
        teams: {},
        teamMemberToTeam: {}
      },
      builderTimer: null,
      mineTimer: null,
      farmTimer: null,
      attackInterval: null,
      rightClickInterval: null,
      chestInterval: null,
      autoCmdInterval: null,
      afkInterval: null,
      reconnectTimeout: null,
      authFallbackTimeout: null,
      manualStop: false,
      hasAuthenticated: false,
      lastAuthTime: 0
    });
  }
  return sessions.get(accountId);
}

function clearSessionTimers(session) {
  session.farmLoopId = (session.farmLoopId || 0) + 1;
  session.farmCurrentPath = null;
  session.farmTargetCropPos = null;
  session.tillLoopId = (session.tillLoopId || 0) + 1;
  session.tillCurrentPath = null;
  session.tillTargetDirtPos = null;
  if (session.tillTimer) {
    clearTimeout(session.tillTimer);
    session.tillTimer = null;
  }
  session.plantLoopId = (session.plantLoopId || 0) + 1;
  session.plantCurrentPath = null;
  session.plantTargetDirtPos = null;
  if (session.plantTimer) {
    clearTimeout(session.plantTimer);
    session.plantTimer = null;
  }
  if (session.afkInterval) {
    clearInterval(session.afkInterval);
    session.afkInterval = null;
  }
  if (session.builderTimer) {
    clearTimeout(session.builderTimer);
    session.builderTimer = null;
  }
  if (session.mineTimer) {
    clearTimeout(session.mineTimer);
    session.mineTimer = null;
  }
  if (session.farmTimer) {
    clearTimeout(session.farmTimer);
    session.farmTimer = null;
  }
  if (session.farmerSellTimer) {
    clearTimeout(session.farmerSellTimer);
    session.farmerSellTimer = null;
  }
  session.isFarmerSelling = false;
  session.isFarmingCrop = false;
  if (session.attackInterval) {
    clearInterval(session.attackInterval);
    session.attackInterval = null;
  }
  if (session.rightClickInterval) {
    clearInterval(session.rightClickInterval);
    session.rightClickInterval = null;
  }
  if (session.chestInterval) {
    clearInterval(session.chestInterval);
    session.chestInterval = null;
  }
  if (session.autoCmdInterval) {
    clearInterval(session.autoCmdInterval);
    session.autoCmdInterval = null;
  }
  if (session.reconnectTimeout) {
    clearTimeout(session.reconnectTimeout);
    session.reconnectTimeout = null;
  }
  if (session.authFallbackTimeout) {
    clearTimeout(session.authFallbackTimeout);
    session.authFallbackTimeout = null;
  }
  session.pendingMenuCaptcha = null;
  session.isSolvingCaptcha = false;
  session.isMiningBlock = false;
  session.blocksMinedStreak = 0;
  if (session.bot) {
    try {
      session.bot.setControlState('forward', false);
      session.bot.setControlState('back', false);
      session.bot.setControlState('left', false);
      session.bot.setControlState('right', false);
      session.bot.setControlState('jump', false);
      session.bot.setControlState('sprint', false);
      session.bot.setControlState('sneak', session.sneakLock || false);
      if (typeof session.bot.clearControlStates === 'function') {
        session.bot.clearControlStates();
      }
    } catch (e) {}
  }
}

// --- 1.20.3+ NBT VE GELİŞMİŞ CHAT METİN ÇÖZÜCÜ (KICK VE SUNUCU MESAJLARI İÇİN) ---
function extractTextFromChat(chatObj) {
  if (!chatObj) return '';
  if (typeof chatObj === 'string') return chatObj;

  // 1.20.3+ sohbet bileşenleri NBT bileşiği olarak sarılı gelebilir
  if (typeof chatObj.type === 'string' && Object.prototype.hasOwnProperty.call(chatObj, 'value')) {
    const ic = chatObj.value;
    if (typeof ic === 'string') return ic;
    if (Array.isArray(ic)) return ic.map(extractTextFromChat).join('');
    if (ic && typeof ic === 'object' && Array.isArray(ic.value)) {
      return ic.value.map(extractTextFromChat).join('');
    }
    return extractTextFromChat(ic);
  }

  let text = '';
  if (chatObj.text) text += extractTextFromChat(chatObj.text);
  if (chatObj.translate) text += extractTextFromChat(chatObj.translate);

  const ek = chatObj.extra;
  if (Array.isArray(ek)) {
    ek.forEach((item) => {
      text += extractTextFromChat(item);
    });
  } else if (ek) {
    text += extractTextFromChat(ek);
  }

  if (!text && typeof chatObj.toString === 'function') {
    const s = chatObj.toString();
    if (s && s !== '[object Object]') text = s;
  }

  return text;
}

// --- GÜVENLİ OYUN İÇİ KOMUT GÖNDERİCİ (Yalnızca 'play' aşamasında gönderir) ---
function sendChatSafely(accountId, message, delayMs = 0) {
  const session = sessions.get(accountId);
  if (!session || !message) return;

  const execute = () => {
    let attempts = 0;
    const interval = setInterval(() => {
      const currentSession = sessions.get(accountId);
      const currentBot = currentSession?.bot;
      if (!currentBot || currentSession.status !== 'online') {
        clearInterval(interval);
        return;
      }

      // Sadece play (oyun içi) durumundayken paketi gönder
      if (currentBot._client && currentBot._client.state === 'play') {
        clearInterval(interval);
        try {
          currentBot.chat(message);
        } catch (e) {
          addLog(accountId, 'HATA', `Sohbet paketi gönderilemedi: ${e.message}`, chalk.red);
        }
      } else {
        attempts++;
        if (attempts > 30) {
          clearInterval(interval);
          addLog(accountId, 'HATA', `Komut gönderimi iptal edildi (Süre aşımı / Durum 'play' değil): ${message}`, chalk.red);
        }
      }
    }, 500);
  };

  if (delayMs > 0) {
    setTimeout(execute, delayMs);
  } else {
    execute();
  }
}

// --- 1. OTO-ALET (AUTO-TOOL) VE İNSANSI GÜVENLİ BLOK KIRMA ---
function isContainerOrStorageBlock(name) {
  if (!name) return false;
  const n = String(name).toLowerCase().replace('minecraft:', '');
  return (
    n.includes('chest') ||
    n.includes('shulker') ||
    n === 'barrel' ||
    n === 'hopper' ||
    n === 'dropper' ||
    n === 'dispenser' ||
    n === 'furnace' ||
    n === 'blast_furnace' ||
    n === 'smoker' ||
    n === 'brewing_stand' ||
    n === 'enchanting_table' ||
    n.includes('anvil') ||
    n === 'crafting_table'
  );
}

function isDiggableTargetBlock(block) {
  if (!block || !block.name) return false;
  // Sandık, varil veya depolama bloklarını KESİNLİKLE kazma!
  if (isContainerOrStorageBlock(block.name)) return false;
  const nonSolid = [
    'air',
    'cave_air',
    'void_air',
    'water',
    'flowing_water',
    'lava',
    'flowing_lava',
    'bedrock',
    'barrier',
    'structure_void'
  ];
  return !nonSolid.includes(block.name);
}

function findBlockInFront(bot, session) {
  if (!bot || !bot.entity) return null;

  const eyeHeight = bot.entity.eyeHeight || 1.62;
  const eyePos = bot.entity.position.offset(0, eyeHeight, 0);

  // Botun temel nişan açısını al (Kafanın sağa/sola/aşağı/yukarı sapmasını engeller)
  const yaw = (session && session.baseYaw !== undefined && session.baseYaw !== null) ? session.baseYaw : bot.entity.yaw;
  const pitch = (session && session.basePitch !== undefined && session.basePitch !== null) ? session.basePitch : bot.entity.pitch;

  // Yatay ileri yön vektörü (Ön hat istikameti)
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const forwardLen = Math.sqrt(forwardX * forwardX + forwardZ * forwardZ) || 1;
  const normForwardX = forwardX / forwardLen;
  const normForwardZ = forwardZ / forwardLen;

  const visitedKeys = new Set();

  // 1. AŞAMA: Doğrudan nişangah 3D ışın taraması (baseYaw / basePitch)
  // Işın boyunca en yakından en uzağa doğru tara (0.5m - 4.5m)
  try {
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const rayDir = new Vec3(-sinY * cosP, sinP, -cosY * cosP).normalize();

    for (let d = 0.5; d <= 4.5; d += 0.08) {
      const p = eyePos.offset(rayDir.x * d, rayDir.y * d, rayDir.z * d).floored();
      const key = `${p.x},${p.y},${p.z}`;
      if (visitedKeys.has(key)) continue;
      visitedKeys.add(key);

      const b = bot.blockAt(p);
      if (!b) continue;

      // Kırılamayan bloklar (bedrock, barrier vb.) ışını durdurur, arkasına geçilmez
      if (b.name === 'bedrock' || b.name === 'barrier' || b.name === 'structure_void') {
        break;
      }

      // Hava, su veya lav ise içinden geç ve arkasındaki blokları tara!
      if (
        b.name === 'air' ||
        b.name === 'cave_air' ||
        b.name === 'void_air' ||
        b.name === 'water' ||
        b.name === 'flowing_water' ||
        b.name === 'lava' ||
        b.name === 'flowing_lava'
      ) {
        continue;
      }

      // Kazılabilir ilk hedef bloğu bulduk!
      if (isDiggableTargetBlock(b)) {
        if (session) {
          session.lastTargetY = b.position.y;
        }
        return b;
      }
    }
  } catch (e) {}

  // 2. AŞAMA: Öndeki ilk blok kırılmışsa (hava/su/lav), aynı hat üzerindeki ARKADAKİ blokları tara!
  // Bot kafasını sağa/sola çevirmez; baktığı yatay hatta (forward) arkaya doğru sırayla bakar.
  // Bu sayede öndeki blok kırıldığında o tekrar oluşana kadar arkasındaki 2., 3., 4. blokları sırayla kazar.
  try {
    const targetYList = [];
    if (session && typeof session.lastTargetY === 'number') {
      targetYList.push(session.lastTargetY);
      targetYList.push(session.lastTargetY + 1);
      targetYList.push(session.lastTargetY - 1);
    } else {
      const footY = Math.floor(bot.entity.position.y);
      targetYList.push(footY, footY + 1, footY + 2);
    }

    // Yakından uzağa doğru (d = 0.8'den 4.5'e kadar) hattaki blokları tara
    for (let d = 0.8; d <= 4.5; d += 0.35) {
      const checkX = Math.floor(bot.entity.position.x + normForwardX * d);
      const checkZ = Math.floor(bot.entity.position.z + normForwardZ * d);

      for (const y of targetYList) {
        const p = new Vec3(checkX, y, checkZ);
        const key = `${p.x},${p.y},${p.z}`;
        if (visitedKeys.has(key)) continue;
        visitedKeys.add(key);

        const b = bot.blockAt(p);
        if (!b) continue;

        if (b.name === 'bedrock' || b.name === 'barrier') continue;

        if (isDiggableTargetBlock(b)) {
          const distToEye = b.position.offset(0.5, 0.5, 0.5).distanceTo(eyePos);
          if (distToEye <= 4.55) {
            if (session) {
              session.lastTargetY = b.position.y;
            }
            return b;
          }
        }
      }
    }
  } catch (e) {}

  return null;
}

const romanMap = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

function getItemEfficiency(item) {
  if (!item) return 0;
  let maxLvl = 0;

  // 1. item.enchants kontrolü (Dizi veya Obje olabilir)
  try {
    const enchs = item.enchants;
    if (Array.isArray(enchs)) {
      for (const e of enchs) {
        if (!e) continue;
        const name = String(e.name || e.id || '').toLowerCase();
        if (name.includes('efficiency') || name.includes('verimlilik') || name === '32') {
          const lvl = Number(e.lvl || e.level || 0);
          if (lvl > maxLvl) maxLvl = lvl;
        }
      }
    } else if (enchs && typeof enchs === 'object') {
      if (Array.isArray(enchs.enchantments)) {
        for (const e of enchs.enchantments) {
          const name = String(e.enchantment || e.id || e.name || '').toLowerCase();
          if (name.includes('efficiency') || name.includes('verimlilik')) {
            const lvl = Number(e.level || e.lvl || 0);
            if (lvl > maxLvl) maxLvl = lvl;
          }
        }
      } else if (enchs.levels && typeof enchs.levels === 'object') {
        for (const [k, v] of Object.entries(enchs.levels)) {
          if (String(k).toLowerCase().includes('efficiency') || String(k).toLowerCase().includes('verimlilik')) {
            const lvl = Number(v);
            if (lvl > maxLvl) maxLvl = lvl;
          }
        }
      } else {
        for (const [k, v] of Object.entries(enchs)) {
          if (String(k).toLowerCase().includes('efficiency') || String(k).toLowerCase().includes('verimlilik')) {
            const lvl = typeof v === 'number' ? v : Number(v?.lvl || v?.level || 0);
            if (lvl > maxLvl) maxLvl = lvl;
          }
        }
      }
    }
  } catch (e) {}

  // 2. NBT üzerinden doğrudan kontrol (prismarine-item enchants hata verse dahi)
  try {
    if (item.nbt) {
      const nbtVal = item.nbt.value || item.nbt;
      const enchList =
        nbtVal.Enchantments?.value?.value ||
        nbtVal.Enchantments?.value ||
        nbtVal.ench?.value?.value ||
        nbtVal.ench?.value;
      if (Array.isArray(enchList)) {
        for (const e of enchList) {
          const eVal = e.value || e;
          const id = String(eVal.id?.value || eVal.id || '').toLowerCase();
          const lvl = Number(eVal.lvl?.value || eVal.lvl || 0);
          if (id.includes('efficiency') || id === '32' || id === 'minecraft:efficiency') {
            if (lvl > maxLvl) maxLvl = lvl;
          }
        }
      }
    }
  } catch (e) {}

  // 3. Lore (Açıklama) üzerinden kontrol (Özel Skyblock eşyaları ve Türkçe sunucular için)
  try {
    let lores = [];
    if (Array.isArray(item.customLore)) lores = item.customLore;
    else if (Array.isArray(item.lore)) lores = item.lore;
    else if (item.nbt?.value?.display?.value?.Lore?.value?.value) {
      lores = item.nbt.value.display.value.Lore.value.value;
    }
    for (const line of lores) {
      const str = String(line).replace(/§[0-9a-fk-or]/gi, '').toLowerCase();
      const m = str.match(/(?:efficiency|verimlilik)\s*([0-9]+|[ivx]+)/i);
      if (m) {
        const val = m[1].toLowerCase();
        const num = /^\d+$/.test(val) ? parseInt(val, 10) : (romanMap[val] || 0);
        if (num > maxLvl) maxLvl = num;
      }
    }
  } catch (e) {}

  return maxLvl;
}

function getVisibleBlockFace(bot, block) {
  if (!bot || !bot.entity || !block) return 1;
  try {
    const eyeHeight = bot.entity.eyeHeight || 1.62;
    const eyePos = bot.entity.position.offset(0, eyeHeight, 0);
    const blockCenter = block.position.offset(0.5, 0.5, 0.5);
    const dx = eyePos.x - blockCenter.x;
    const dy = eyePos.y - blockCenter.y;
    const dz = eyePos.z - blockCenter.z;

    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const absZ = Math.abs(dz);

    // 0: Bottom (-Y), 1: Top (+Y), 2: North (-Z), 3: South (+Z), 4: West (-X), 5: East (+X)
    if (absY > absX && absY > absZ) {
      return dy > 0 ? 1 : 0;
    } else if (absX > absZ) {
      return dx > 0 ? 5 : 4;
    } else {
      return dz > 0 ? 3 : 2;
    }
  } catch (e) {
    return 1;
  }
}

function calculateSafeDigTime(bot, block) {
  if (!bot || !block) return 240;
  try {
    const held = bot.heldItem;
    const effLvl = getItemEfficiency(held);

    const safeEnchants = [];
    if (effLvl > 0) {
      safeEnchants.push({ name: 'efficiency', lvl: effLvl });
    }

    try {
      const headSlot = bot.getEquipmentDestSlot ? bot.getEquipmentDestSlot('head') : 5;
      const headItem = bot.inventory ? bot.inventory.slots[headSlot] : null;
      if (headItem) {
        const aq = (headItem.enchants || []).find && headItem.enchants.find((e) => (e.name || '').includes('aqua'));
        if (aq) safeEnchants.push({ name: 'aqua_affinity', lvl: aq.lvl || 1 });
      }
    } catch (e) {}

    // Skyblock adalarında bot kuru zemindedir, jeneratör suyu veya zıplama yüzünden 5x/25x ceza uygulanmaz!
    const inWater = false;
    const notOnGround = false;
    const creative = bot.game?.gameMode === 'creative';

    if (creative) return 60;

    let time = 240;
    try {
      time = block.digTime(
        held ? held.type : null,
        false,
        false,
        false,
        safeEnchants,
        bot.entity?.effects || {}
      );
    } catch (e) {
      time = 240;
    }

    if (!Number.isFinite(time) || isNaN(time) || time <= 0) {
      time = 240;
    }

    const bName = (block.name || '').toLowerCase();

    // Blok türüne göre akıllı Skyblock sınırlandırmaları (bekleme yapmaması için tavan sınırlar)
    const isObsidian = bName.includes('obsidian') || bName.includes('crying_obsidian') || bName.includes('ancient_debris') || bName.includes('respawn_anchor');
    const isDeepslateOre = bName.includes('deepslate') && (bName.includes('ore') || bName.includes('raw_'));
    const isOre = bName.includes('ore') || bName.includes('raw_') || bName.includes('amethyst') || bName.includes('gilded_blackstone');

    if (isObsidian) {
      // Obsidiyen / Antik Kalıntı: Asla 9-47 saniye bekletme! Max 1100ms, min 280ms
      time = Math.min(Math.max(time, 280), 1100);
    } else if (isDeepslateOre) {
      // Deepslate Madenleri: Max 500ms, min 160ms
      time = Math.min(Math.max(time, 160), 500);
    } else if (isOre) {
      // Normal Madenler (Elmas, Zümrüt, Demir, Altın, Kömür vb.): Max 380ms, min 140ms
      time = Math.min(Math.max(time, 140), 380);
    } else {
      // Normal Taş / Kırıktaş / Toprak vb.: Max 250ms, min 120ms
      time = Math.min(Math.max(time, 120), 250);
    }

    return time;
  } catch (err) {
    return 240;
  }
}

async function equipBestToolForBlock(bot, block) {
  if (!bot || !bot.inventory || !block) return;
  try {
    const items = bot.inventory.items();
    if (!items || items.length === 0) return;

    const bName = (block.name || '').toLowerCase();
    let desiredSuffix = '_pickaxe';
    if (
      bName.includes('log') ||
      bName.includes('wood') ||
      bName.includes('plank') ||
      bName.includes('pumpkin') ||
      bName.includes('melon')
    ) {
      desiredSuffix = '_axe';
    } else if (
      bName.includes('dirt') ||
      bName.includes('grass') ||
      bName.includes('sand') ||
      bName.includes('gravel') ||
      bName.includes('clay') ||
      bName.includes('snow')
    ) {
      desiredSuffix = '_shovel';
    } else if (bName.includes('leaves') || bName.includes('wool') || bName.includes('cobweb')) {
      desiredSuffix = 'shears';
    }

    const tierOrder = ['netherite', 'diamond', 'iron', 'golden', 'stone', 'wooden'];
    const matchingTools = items.filter((it) => it.name && it.name.endsWith(desiredSuffix));
    if (matchingTools.length === 0) return;

    // Eldeki alet zaten netherite veya uygun bir aletse ve bloğu hasat edebiliyorsa koru
    const held = bot.heldItem;
    if (held && held.name && held.name.endsWith(desiredSuffix)) {
      const heldCanHarvest = typeof block.canHarvest === 'function' ? block.canHarvest(held.type) : true;
      if (heldCanHarvest) {
        // Netherite ise her zaman koru
        if (held.name.startsWith('netherite')) return;

        const heldEff = getItemEfficiency(held);
        const hasBetterInInv = matchingTools.some((t) => {
          const tCan = typeof block.canHarvest === 'function' ? block.canHarvest(t.type) : true;
          if (!tCan) return false;
          const tEff = getItemEfficiency(t);
          if (tEff > heldEff) return true;
          const tTier = tierOrder.findIndex((x) => t.name.startsWith(x));
          const hTier = tierOrder.findIndex((x) => held.name.startsWith(x));
          return tTier !== -1 && hTier !== -1 && tTier < hTier && tEff >= heldEff;
        });
        if (!hasBetterInInv) return;
      }
    }

    matchingTools.sort((a, b) => {
      // 0. Alet bu bloğu hasat edebiliyor mu?
      const canA = typeof block.canHarvest === 'function' ? (block.canHarvest(a.type) ? 1 : 0) : 1;
      const canB = typeof block.canHarvest === 'function' ? (block.canHarvest(b.type) ? 1 : 0) : 1;
      if (canB !== canA) return canB - canA;

      // 1. Verimlilik (Efficiency) seviyesi
      const effA = getItemEfficiency(a);
      const effB = getItemEfficiency(b);
      if (effB !== effA) return effB - effA;

      // 2. Alet Materyal Kademesi
      const tierA = tierOrder.findIndex((t) => a.name.startsWith(t));
      const tierB = tierOrder.findIndex((t) => b.name.startsWith(t));
      return (tierA === -1 ? 99 : tierA) - (tierB === -1 ? 99 : tierB);
    });

    const best = matchingTools[0];
    if (held && held.name === best.name && held.slot === best.slot) return;

    await bot.equip(best, 'hand');
  } catch (e) {}
}

// --- OTO-TAMİR (DEMİRCİ MENÜSÜ & /tamir) SİSTEMİ ---
function checkNeedsRepair(bot, session, accountId) {
  if (!bot || !bot.entity || session.status !== 'online') return false;
  const acc = config.accounts.find((a) => a.id === accountId);
  if (!acc || acc.autoRepair === false) return false;

  const held = bot.heldItem;
  if (!held) return false;

  const dur = getItemDurability(held);
  if (!dur || !dur.max || dur.max <= 0) return false;

  const threshold = typeof acc.autoRepairThreshold === 'number' ? acc.autoRepairThreshold : 15;
  const isCritical = dur.percent <= threshold || dur.current <= Math.min(25, Math.floor(dur.max * 0.15));
  return Boolean(isCritical && dur.current > 0);
}

function findRepairSlotInWindow(win) {
  if (!win || !win.slots) return -1;
  const containerEnd = typeof win.inventoryStart === 'number' ? win.inventoryStart : 27;

  // 1. Smithing Table (Demirci Masası) eşleşmesi
  for (let s = 0; s < containerEnd; s++) {
    const it = win.slots[s];
    if (!it) continue;
    const name = (it.name || '').toLowerCase();
    if (name === 'smithing_table' || name.includes('smithing_table')) {
      return s;
    }
  }

  // 2. İsim veya Lore içinde "ELİNDEKİ" ve "TAMİR" geçen eşya
  for (let s = 0; s < containerEnd; s++) {
    const it = win.slots[s];
    if (!it) continue;
    const custom = normalizeTr(getItemCustomName(it) || it.displayName || '');
    const lore = normalizeTr(getItemLoreText(it) || '');
    if (
      (custom.includes('elindeki') && custom.includes('tamir')) ||
      (lore.includes('elindeki') && lore.includes('tamir')) ||
      custom.includes('tamir et')
    ) {
      return s;
    }
  }

  // 3. Fallback: Demirci menüsünde slot 11 standarttır
  if (win.slots[11]) {
    return 11;
  }

  return -1;
}

async function executeAutoRepairRoutine(bot, session, accountId, force = false) {
  if (!bot || !bot.entity || session.status !== 'online') return false;
  if (session.isRepairing) return false;

  const acc = config.accounts.find((a) => a.id === accountId);
  if (!acc || (acc.autoRepair === false && !force)) return false;

  const now = Date.now();
  // Başarısızlık spam koruması (25 saniye)
  if (!force && session.lastRepairFailed && session.lastRepairAttemptTime && (now - session.lastRepairAttemptTime < 25000)) {
    return false;
  }

  const heldBefore = bot.heldItem;
  if (!heldBefore && !force) return false;

  const durBefore = getItemDurability(heldBefore);
  if (!durBefore && !force) return false;

  if (!force) {
    const threshold = typeof acc.autoRepairThreshold === 'number' ? acc.autoRepairThreshold : 15;
    const isCritical = durBefore && (durBefore.percent <= threshold || durBefore.current <= Math.min(25, Math.floor(durBefore.max * 0.15)));
    if (!isCritical) return false;
  }

  session.isRepairing = true;
  session.lastRepairAttemptTime = now;

  // Aktif kazım varsa durdur
  if (session.bot && session.bot.targetDigBlock) {
    try {
      session.bot.stopDigging();
    } catch (e) {}
    session.bot.targetDigBlock = null;
  }
  session.isMiningBlock = false;

  const toolTitle = heldBefore ? (getItemCustomName(heldBefore) || heldBefore.displayName || heldBefore.name) : 'Eldeki Alet';
  const durSummary = durBefore ? `%${durBefore.percent} (${durBefore.current}/${durBefore.max})` : 'Kritik';

  addLog(
    accountId,
    'TAMİR',
    `🔧 [${toolTitle}] dayanıklılığı kritik seviyede [${durSummary}]! /tamir menüsü açılıyor...`,
    chalk.yellowBright
  );

  const repairCmd = (acc.autoRepairCommand && acc.autoRepairCommand.trim()) ? acc.autoRepairCommand.trim() : '/tamir';

  try {
    // Menü açılmasını bekle (6 saniye zaman aşımı)
    const windowPromise = new Promise((resolve) => {
      let resolved = false;
      const onWin = (w) => {
        if (resolved) return;
        resolved = true;
        bot.removeListener('windowOpen', onWin);
        resolve(w);
      };
      bot.once('windowOpen', onWin);
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          bot.removeListener('windowOpen', onWin);
          resolve(null);
        }
      }, 6000);
    });

    bot.chat(repairCmd);

    const win = await windowPromise;
    if (!win) {
      addLog(accountId, 'TAMİR', `⚠️ "${repairCmd}" komutu gönderildi ancak tamir menüsü 6 saniyede açılmadı!`, chalk.redBright);
      session.lastRepairFailed = true;
      return false;
    }

    addLog(accountId, 'TAMİR', `📖 "${parseWindowTitle(win)}" menüsü açıldı. Eşyalar taranıyor...`, chalk.cyan);

    // Eşyaların yüklenmesi için kısa bekleme (300ms)
    await new Promise((r) => setTimeout(r, 300));

    // Menüdeki "ELINDEKI EŞYAYI TAMIR ET" butonunu tespit et
    const targetSlot = findRepairSlotInWindow(win);

    if (targetSlot === -1 || !win.slots[targetSlot]) {
      addLog(accountId, 'TAMİR', '⚠️ Tamir menüsünde "Elindeki Eşyayı Tamir Et" butonu bulunamadı!', chalk.redBright);
      session.lastRepairFailed = true;
      try { bot.closeWindow(win); } catch (e) {}
      return false;
    }

    const targetItem = win.slots[targetSlot];
    const btnTitle = getItemCustomName(targetItem) || targetItem.displayName || targetItem.name || `Slot ${targetSlot}`;
    addLog(accountId, 'TAMİR', `🔨 Butona tıklanıyor: "${btnTitle}" (Slot: ${targetSlot})...`, chalk.cyanBright);

    // Butona sol tık yap
    await bot.clickWindow(targetSlot, 0, 0);

    // Sunucunun işlemi onaylaması için bekle (450ms)
    await new Promise((r) => setTimeout(r, 450));

    // Menüyü kapat
    try {
      bot.closeWindow(win);
    } catch (e) {}

    await new Promise((r) => setTimeout(r, 200));

    // Tamir durumunu doğrula
    const heldAfter = bot.heldItem;
    const durAfter = getItemDurability(heldAfter);

    if (durAfter && durBefore && (durAfter.current > durBefore.current || durAfter.percent >= 90)) {
      session.lastRepairFailed = false;
      addLog(
        accountId,
        'TAMİR',
        `✅ ${toolTitle} başarıyla onarıldı! Yeni Dayanıklılık: %${durAfter.percent} (${durAfter.current}/${durAfter.max}). Farm ve kazıma devam ediliyor...`,
        chalk.greenBright
      );
      triggerSoundAlert('notify', accountId, 'Alet Tamir Edildi');
      if (session.stats) {
        session.stats.repairsCount = (session.stats.repairsCount || 0) + 1;
      }
      broadcastState();
      return true;
    } else {
      addLog(
        accountId,
        'TAMİR',
        `⚠️ Tamir butonuna tıklandı fakat eşya onarılmadı (Yetersiz bakiye/ücret veya sunucu limiti olabilir). Kazıma devam ediliyor.`,
        chalk.yellowBright
      );
      session.lastRepairFailed = true;
      return false;
    }
  } catch (err) {
    addLog(accountId, 'TAMİR', `❌ Tamir sırasında hata oluştu: ${err.message}`, chalk.red);
    session.lastRepairFailed = true;
    return false;
  } finally {
    session.isRepairing = false;
  }
}

// =========================================================================
// OTO ÇİFTÇİ NPC DEPO SATIŞ MODÜLÜ (Görsel 1-5 Otomasyonu)
// =========================================================================

/**
 * Varlık adından veya meta verilerinden Türkçe/İngilizce normalize edilmiş metin çıkarır
 */
function extractEntityNormalizedText(e) {
  if (!e) return '';
  let str = '';
  if (e.username) str += ' ' + e.username;
  if (e.displayName) str += ' ' + e.displayName;
  if (e.name) str += ' ' + e.name;
  if (e.customName) {
    if (typeof e.customName === 'string') {
      str += ' ' + e.customName;
    } else if (typeof e.customName === 'object') {
      try {
        str += ' ' + (e.customName.text || JSON.stringify(e.customName));
      } catch (_) {}
    }
  }
  if (Array.isArray(e.metadata)) {
    for (const m of e.metadata) {
      if (typeof m === 'string') {
        str += ' ' + m;
      } else if (m && typeof m === 'object') {
        try {
          str += ' ' + (m.text || JSON.stringify(m));
        } catch (_) {}
      }
    }
  }
  return str.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ç/g, 'c')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ğ/g, 'g');
}

/**
 * 5.5 blok yakınlıktaki Çiftçi NPC'sini (veya üzerindeki CIFTCI hologramının altındaki NPC'yi) bulur
 */
function findNearbyFarmerNPC(bot, maxDist = 5.5) {
  if (!bot || !bot.entity || !bot.entity.position || !bot.entities) return null;
  const botPos = bot.entity.position;
  const allEnts = Object.values(bot.entities).filter(
    (e) => e && e !== bot.entity && e.id !== bot.entity.id && e.position
  );

  const nearby = allEnts
    .map((e) => ({ entity: e, dist: botPos.distanceTo(e.position), text: extractEntityNormalizedText(e) }))
    .filter((item) => item.dist <= maxDist)
    .sort((a, b) => a.dist - b.dist);

  // 1. Doğrudan adında / özel adında "ciftci" veya "farmer" geçen insan/köylü/mob varlığı
  for (const item of nearby) {
    const e = item.entity;
    const isHumanoidOrMob = e.name === 'player' || e.name === 'villager' || e.type === 'player' || e.type === 'mob';
    if (isHumanoidOrMob && (item.text.includes('ciftci') || item.text.includes('farmer'))) {
      return e;
    }
  }

  // 2. Hologram ArmorStand tespiti: Üzerinde "ciftci" veya "depo:" yazan hologram standının altındaki NPC'yi bul
  for (const item of nearby) {
    if (item.text.includes('ciftci') || (item.text.includes('depo') && (item.text.includes('seviye') || item.text.includes('durum')))) {
      const standPos = item.entity.position;
      const under = nearby.find((cand) => {
        const c = cand.entity;
        if (c.id === item.entity.id) return false;
        const isLiving = c.name === 'player' || c.name === 'villager' || c.type === 'player' || c.type === 'mob';
        if (!isLiving) return false;
        const dx = Math.abs(c.position.x - standPos.x);
        const dz = Math.abs(c.position.z - standPos.z);
        const dy = standPos.y - c.position.y;
        return dx <= 1.5 && dz <= 1.5 && dy >= -0.5 && dy <= 3.5;
      });
      if (under) return under.entity;
      return item.entity;
    }
  }

  // 3. Yakındaki köylü (villager) varlığı
  for (const item of nearby) {
    if (item.entity.name === 'villager') {
      return item.entity;
    }
  }

  // 4. Yakındaki ilk insan/oyuncu NPC'si (4.0m mesafe içi)
  for (const item of nearby) {
    if (item.entity.name === 'player' && item.dist <= 4.0) {
      return item.entity;
    }
  }

  return null;
}

/**
 * İlk menünün (CIFTCI YONETIMI) açılmasını bekler
 */
function waitForFarmerWindow(bot, timeoutMs = 6500) {
  return new Promise((resolve) => {
    let resolved = false;
    let timer = null;
    let pollTimer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (pollTimer) clearInterval(pollTimer);
      bot.removeListener('windowOpen', onWin);
    };

    const onWin = (w) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(w);
    };

    bot.once('windowOpen', onWin);

    pollTimer = setInterval(() => {
      if (resolved) return;
      if (bot.currentWindow) {
        resolved = true;
        cleanup();
        resolve(bot.currentWindow);
      }
    }, 120);

    timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(bot.currentWindow || null);
    }, timeoutMs);
  });
}

/**
 * İkinci menünün (CIFTCI DEPOSU) açılmasını veya mevcut pencerenin güncellenmesini bekler
 */
function waitForFarmerStorageWindow(bot, prevWindowId, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let resolved = false;
    let timer = null;
    let pollTimer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (pollTimer) clearInterval(pollTimer);
      bot.removeListener('windowOpen', onWin);
    };

    const onWin = (w) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(w);
    };

    bot.once('windowOpen', onWin);

    pollTimer = setInterval(() => {
      if (resolved) return;
      const cur = bot.currentWindow;
      if (cur) {
        const title = parseWindowTitle(cur).toLowerCase();
        if (title.includes('deposu') || cur.id !== prevWindowId) {
          resolved = true;
          cleanup();
          resolve(cur);
          return;
        }
        if (cur.slots && cur.slots[53] && (cur.slots[53].name === 'gold_ingot' || (cur.slots[53].displayName && cur.slots[53].displayName.toLowerCase().includes('sat')))) {
          resolved = true;
          cleanup();
          resolve(cur);
          return;
        }
      }
    }, 120);

    timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(bot.currentWindow || null);
    }, timeoutMs);
  });
}

/**
 * Çiftçi NPC'sine sağ tıklar, Sandık (DEPO) ikonuna basar ve Depodaki "TÜMÜNÜ SAT" (Altın Külçesi) ikonuna tıklayarak satar.
 */
async function executeFarmerSellRoutine(accountId, isManual = false) {
  const session = getOrCreateSession(accountId);
  const bot = session.bot;
  if (!bot || !bot.entity || session.status !== 'online') {
    if (isManual) {
      addLog(accountId, 'ÇİFTÇİ', 'Bot çevrimdışı olduğu için çiftçi satışı yapılamadı.', chalk.yellow);
    }
    return false;
  }

  if (session.isFarmerSelling) return false;
  if (!isManual && (session.isDepositing || session.isEating || session.isRepairing)) {
    return false;
  }

  session.isFarmerSelling = true;

  // Maden kazımı açıksa geçici olarak durdur
  if (session.mineTimer) {
    clearTimeout(session.mineTimer);
    session.mineTimer = null;
  }
  if (bot.targetDigBlock) {
    try {
      bot.stopDigging();
    } catch (_) {}
    bot.targetDigBlock = null;
  }

  const prevYaw = (session.baseYaw !== undefined && session.baseYaw !== null) ? session.baseYaw : (bot.entity ? bot.entity.yaw : null);
  const prevPitch = (session.basePitch !== undefined && session.basePitch !== null) ? session.basePitch : (bot.entity ? bot.entity.pitch : null);
  const hadSneakLock = Boolean(session.sneakLock);

  try {
    // Açık kalmış eski bir pencere varsa temiz kapat
    if (bot.currentWindow) {
      try { bot.closeWindow(bot.currentWindow); } catch (_) {}
      await new Promise((r) => setTimeout(r, 180));
    }

    // 1. /çiftçi komutunu gir ve 1. Menüyü (ÇİFTÇİ YÖNETİMİ) bekle
    addLog(accountId, 'ÇİFTÇİ', '🌾 "/çiftçi" komutu girilerek çiftçi yönetim menüsü açılıyor...', chalk.cyanBright);
    const win1Promise = waitForFarmerWindow(bot, 6500);
    try {
      bot.chat('/çiftçi');
    } catch (e) {
      addLog(accountId, 'ÇİFTÇİ', `❌ "/çiftçi" komutu gönderilemedi: ${e.message}`, chalk.red);
      return false;
    }

    const win1 = await win1Promise;
    if (!win1) {
      addLog(accountId, 'ÇİFTÇİ', '⚠️ "/çiftçi" komutu girildi ancak çiftçi menüsü açılmadı.', chalk.redBright);
      return false;
    }

    addLog(accountId, 'ÇİFTÇİ', `📋 "${parseWindowTitle(win1)}" menüsü açıldı. Sandık (DEPO) ikonu aranıyor...`, chalk.cyan);
    await new Promise((r) => setTimeout(r, 250));

    // 4. Menüde Sandık (DEPO) butonunu bul (Görsel 2-3)
    let chestSlot = -1;
    const containerEnd1 = win1.inventoryStart || Math.min(win1.slots.length, 36);
    for (let i = 0; i < containerEnd1; i++) {
      const it = win1.slots[i];
      if (!it) continue;
      const itName = (it.name || '').toLowerCase();
      const itCustom = (getItemCustomName(it) || it.displayName || '').toLowerCase();
      const itLore = (getItemLoreText(it) || '').toLowerCase();
      if (
        itName.includes('chest') ||
        itCustom.includes('depo') ||
        itLore.includes('ciftcinin') ||
        itLore.includes('topladigi') ||
        itLore.includes('urunleri')
      ) {
        chestSlot = i;
        break;
      }
    }
    // Görsel 3: 2. Satır, 2. Sütun (Slot 10)
    if (chestSlot === -1 && win1.slots[10]) {
      chestSlot = 10;
    }

    if (chestSlot === -1) {
      addLog(accountId, 'ÇİFTÇİ', '⚠️ Çiftçi menüsünde "DEPO" (Sandık) butonu bulunamadı!', chalk.redBright);
      try { bot.closeWindow(win1); } catch (_) {}
      return false;
    }

    // 5. Sandık butonuna tıkla ve 2. Menüyü (CIFTCI DEPOSU) bekle (Görsel 4-5)
    addLog(accountId, 'ÇİFTÇİ', `📦 Sandık butonuna tıklandı (Slot: ${chestSlot}). Çiftçi deposu açılıyor...`, chalk.cyanBright);
    const win2Promise = waitForFarmerStorageWindow(bot, win1.id, 6000);
    await bot.clickWindow(chestSlot, 0, 0);
    const win2 = await win2Promise;
    await new Promise((r) => setTimeout(r, 300));

    const activeWin2 = win2 || bot.currentWindow;
    if (!activeWin2) {
      addLog(accountId, 'ÇİFTÇİ', '⚠️ Çiftçi deposu penceresi zamanında açılmadı!', chalk.redBright);
      return false;
    }

    addLog(accountId, 'ÇİFTÇİ', `💰 "${parseWindowTitle(activeWin2)}" açıldı. "TÜMÜNÜ SAT" (Altın Külçesi) aranıyor...`, chalk.cyan);

    // 6. Depoda "TÜMÜNÜ SAT" (Altın Külçesi) butonunu bul (Görsel 4-5)
    let sellSlot = -1;
    const containerEnd2 = activeWin2.inventoryStart || Math.min(activeWin2.slots.length, 54);
    for (let i = 0; i < containerEnd2; i++) {
      const it = activeWin2.slots[i];
      if (!it) continue;
      const itName = (it.name || '').toLowerCase();
      const itCustom = (getItemCustomName(it) || it.displayName || '').toLowerCase();
      const itLore = (getItemLoreText(it) || '').toLowerCase();
      if (
        itName.includes('gold_ingot') ||
        itCustom.includes('tumunu sat') ||
        itCustom.includes('tümünü sat') ||
        itCustom.includes('sat') ||
        itLore.includes('paraya cevir') ||
        itLore.includes('tikla ve sat') ||
        itLore.includes('tahmini deger')
      ) {
        sellSlot = i;
        break;
      }
    }
    // Görsel 5: 6. Satır, 9. Sütun (Slot 53)
    if (sellSlot === -1 && activeWin2.slots[53]) {
      sellSlot = 53;
    }

    if (sellSlot === -1) {
      addLog(accountId, 'ÇİFTÇİ', '⚠️ Çiftçi deposunda "TÜMÜNÜ SAT" butonu bulunamadı!', chalk.redBright);
      try { bot.closeWindow(activeWin2); } catch (_) {}
      return false;
    }

    // 7. Altın külçesine tıkla (Tümünü Sat)
    addLog(accountId, 'ÇİFTÇİ', `✨ "TÜMÜNÜ SAT" butonuna tıklandı (Slot: ${sellSlot}). Hasatlar paraya çevriliyor...`, chalk.greenBright);
    await bot.clickWindow(sellSlot, 0, 0);
    await new Promise((r) => setTimeout(r, 450));

    // 8. Menüyü kapat
    try {
      bot.closeWindow(activeWin2);
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));

    // 9. İstatistikleri ve bildirimleri güncelle
    session.lastFarmerSellTime = Date.now();
    if (!session.stats) session.stats = {};
    session.stats.farmerSalesCount = (session.stats.farmerSalesCount || 0) + 1;
    addLog(accountId, 'ÇİFTÇİ', '✅ 💰 Çiftçi deposundaki tüm hasatlar başarıyla satıldı!', chalk.greenBright);
    triggerSoundAlert('notify', accountId, 'Çiftçi Satışı Yapıldı');
    broadcastState();
    return true;
  } catch (err) {
    addLog(accountId, 'ÇİFTÇİ', `❌ Çiftçi satışı sırasında hata oluştu: ${err.message}`, chalk.red);
    return false;
  } finally {
    // 10. Çömelme ve bakış açısını eski haline getir
    if (hadSneakLock && bot.entity) {
      bot.setControlState('sneak', true);
    }
    if (prevYaw !== null && prevPitch !== null && bot.entity) {
      try {
        await bot.look(prevYaw, prevPitch, true);
      } catch (_) {}
    }
    session.isFarmerSelling = false;
  }
}

/**
 * Kullanıcı tarafından belirlenen süre aralığında (intervalSec) otomatik çiftçi satışı yapar
 */
function startFarmerSellLoop(accountId) {
  const session = getOrCreateSession(accountId);
  if (session.farmerSellTimer) {
    clearTimeout(session.farmerSellTimer);
    session.farmerSellTimer = null;
  }
  const acc = config.accounts.find((a) => a.id === accountId);
  if (!acc || !acc.autoFarmerSell || !acc.autoFarmerSell.enabled) return;

  const intervalSec = Math.max(5, Number(acc.autoFarmerSell.intervalSec) || 120);
  const intervalMs = intervalSec * 1000;

  session.farmerSellTimer = setTimeout(async () => {
    session.farmerSellTimer = null;
    if (session.status === 'online' && session.bot && !session.isFarmerSelling && !session.isDepositing && !session.isEating && !session.isRepairing) {
      try {
        await executeFarmerSellRoutine(accountId);
      } catch (err) {
        console.error('[ÇİFTÇİ SATIŞ DÖNGÜ HATA]', err);
      }
    }
    startFarmerSellLoop(accountId);
  }, intervalMs);
}

function stopFarmerSellLoop(accountId) {
  const session = getOrCreateSession(accountId);
  if (session.farmerSellTimer) {
    clearTimeout(session.farmerSellTimer);
    session.farmerSellTimer = null;
  }
  session.isFarmerSelling = false;
}

async function safeDigBlock(bot, block, session) {
  if (!bot || !block || !bot._client) return false;

  // 1. Bakılan yüzeyi belirle (0: alt, 1: üst, 2: kuzey, 3: güney, 4: batı, 5: doğu)
  const face = getVisibleBlockFace(bot, block);

  // 2. İnsansı hedefleme: Bloğun merkezine doğal bakış (Kafayı asla tavana veya zemine çevirmez)
  try {
    const jitterX = (Math.random() - 0.5) * 0.04;
    const jitterY = (Math.random() - 0.5) * 0.04;
    const jitterZ = (Math.random() - 0.5) * 0.04;
    const targetLook = block.position.offset(0.5 + jitterX, 0.5 + jitterY, 0.5 + jitterZ);
    await bot.lookAt(targetLook, true);
  } catch (e) {}

  // 3. Tahmini kazma süresi hesapla (Skyblock tavan süreleri ile optimize)
  const digTimeMs = calculateSafeDigTime(bot, block);

  // 4. 1.19+ sequence numarası yönetimi
  bot._sctSequence = ((bot._sctSequence || 0) + 1) & 0x7FFFFFFF;
  const seq = bot._sctSequence;

  const eventName = `blockUpdate:${block.position}`;
  let swingTimer = null;
  let pollTimer = null;
  let status2Sent = false;

  const sendStatus2 = () => {
    if (status2Sent) return;
    status2Sent = true;
    try {
      bot._client.write('block_dig', {
        status: 2,
        location: block.position,
        face: face,
        sequence: seq
      });
    } catch (e) {}
  };

  try {
    // 5. Kazmayı Başlat (status: 0) - Başlangıç ve bitiş yüzeyi BİREBİR AYNIDIR
    try {
      bot._client.write('block_dig', {
        status: 0,
        location: block.position,
        face: face,
        sequence: seq
      });
      bot.swingArm();
    } catch (e) {
      return false;
    }

    // Kazım sürerken düzenli kol sallama
    swingTimer = setInterval(() => {
      try { bot.swingArm(); } catch (e) {}
    }, 160);

    // 6. DİNAMİK KIRILMA TAKİBİ:
    // Sunucu bloğu erken kırdıysa (veya maden kırıldığı anda) bekleme yapmadan HEMEN tamamla!
    const success = await new Promise((resolve) => {
      let resolved = false;

      const finishSuccess = () => {
        if (resolved) return;
        resolved = true;
        sendStatus2();
        cleanup();
        resolve(true);
      };

      const onUpdate = (oldBlock, newBlock) => {
        const newName = newBlock ? (newBlock.name || '') : '';
        if (!newBlock || newName !== block.name) {
          finishSuccess();
        }
      };

      bot.on(eventName, onUpdate);

      // Her 25ms'de bir yerel dünya durumunu anlık sorgula
      pollTimer = setInterval(() => {
        try {
          const cur = bot.blockAt(block.position);
          if (!cur || cur.name !== block.name) {
            finishSuccess();
          }
        } catch (e) {}
      }, 25);

      // digTimeMs dolduğunda bitirme paketini (status: 2) gönder
      const digTimer = setTimeout(() => {
        sendStatus2();

        // status: 2 gönderildikten sonra sunucunun onayını maksimum 80ms bekle
        const ackTimer = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          cleanup();
          resolve(true);
        }, 80);

        timeoutRefs.push(ackTimer);
      }, digTimeMs);

      const timeoutRefs = [digTimer];

      const cleanup = () => {
        bot.removeListener(eventName, onUpdate);
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        for (const t of timeoutRefs) {
          clearTimeout(t);
        }
      };
    });

    return success;
  } finally {
    if (swingTimer) {
      clearInterval(swingTimer);
      swingTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    sendStatus2();

    // Kazım bittikten veya herhangi bir hata durumunda bakış açısını daima kilitli hatta (baseYaw / basePitch) geri çek
    if (session && session.baseYaw !== undefined && session.basePitch !== undefined && session.baseYaw !== null && session.basePitch !== null) {
      try {
        await bot.look(session.baseYaw, session.basePitch, true);
      } catch (e) {}
    }
  }
}

async function performHumanMicroPause(bot, session) {
  if (!bot || !bot.entity) return;
  if (session && (session.isDepositing || session.isDropping)) return;
  const baseYaw = (session && session.baseYaw !== undefined && session.baseYaw !== null) ? session.baseYaw : bot.entity.yaw;
  const basePitch = (session && session.basePitch !== undefined && session.basePitch !== null) ? session.basePitch : bot.entity.pitch;

  try {
    // Geçici çok küçük kafa titremesi (±1 derece)
    const tempYaw = baseYaw + (Math.random() - 0.5) * 0.03;
    const tempPitch = Math.max(-1.3, Math.min(1.3, basePitch + (Math.random() - 0.5) * 0.02));
    await bot.look(tempYaw, tempPitch, true);

    // Kısa bir çömelme (sneak) simülasyonu
    bot.setControlState('sneak', true);
    await new Promise((r) => setTimeout(r, 180 + Math.floor(Math.random() * 120)));
  } catch (e) {
  } finally {
    if (!session || !session.sneakLock) {
      try { bot.setControlState('sneak', false); } catch (e) {}
    }
    // KESİNLİKLE ana kırma açısına geri dön! Kümülatif sapma engellenir
    try {
      await bot.look(baseYaw, basePitch, true);
    } catch (e) {}
  }
}

async function performEvasionRoutine(bot, session) {
  if (!bot || !bot.entity) return;
  if (session && (session.isDepositing || session.isDropping)) return;
  const baseYaw = (session && session.baseYaw !== undefined && session.baseYaw !== null) ? session.baseYaw : bot.entity.yaw;
  const basePitch = (session && session.basePitch !== undefined && session.basePitch !== null) ? session.basePitch : bot.entity.pitch;

  try {
    bot.setControlState('sneak', true);
    await bot.look(baseYaw + 0.35, Math.max(-0.5, basePitch - 0.25), true);
    await new Promise((r) => setTimeout(r, 600));

    await bot.look(baseYaw - 0.3, basePitch, true);
    await new Promise((r) => setTimeout(r, 600));

    bot.setControlState('sneak', false);
  } catch (e) {
  } finally {
    // KESİNLİKLE ana kırma açısına geri dön!
    try {
      await bot.look(baseYaw, basePitch, true);
    } catch (e) {}
  }
}

function handleMiningWarning(accountId, text) {
  if (!text) return;
  const norm = normalizeTr(text);
  if (
    norm.includes('supheli afk madencilik') ||
    norm.includes('afk madencilik tespit') ||
    norm.includes('madencilik yapmayin') ||
    (norm.includes('afk') && norm.includes('madencilik')) ||
    (norm.includes('supheli') && (norm.includes('kazim') || norm.includes('kırma') || norm.includes('kirma'))) ||
    norm.includes('auto mine') ||
    norm.includes('suspicious mining')
  ) {
    const session = sessions.get(accountId);
    if (!session || !session.bot) return;

    addLog(
      accountId,
      'OTO-KAZIM',
      '⚠️ Sunucudan "Şüpheli AFK Madencilik" uyarısı tespit edildi! Güvenlik için kazım 8.5 saniye durduruldu ve insansı kaçınma hareketi yapılıyor.',
      chalk.redBright
    );
    triggerSoundAlert('mention', accountId, 'AFK Madencilik Uyarısı!');

    if (!config.discord || config.discord.notifyWarning !== false) {
      const acc = config.accounts.find((a) => a.id === accountId);
      sendDiscordWebhook(
        '[UYARI] Şüpheli AFK Madencilik Algılandı',
        `Hesap: \`${acc ? acc.username : accountId}\`\nSunucu uyarısı: \`${text}\`\nBot otomatik olarak kaçınma hareketine geçti ve 8.5 sn beklemeye alındı.`,
        0xff9800,
        accountId
      );
    }

    try {
      if (session.bot.targetDigBlock) session.bot.stopDigging();
      session.bot.targetDigBlock = null;
    } catch (e) {}
    session.isMiningBlock = false;

    performEvasionRoutine(session.bot, session);

    if (session.mineTimer) {
      clearTimeout(session.mineTimer);
      session.mineTimer = null;
    }

    if (session.autoMine) {
      session.mineTimer = setTimeout(() => {
        if (session.autoMine && session.bot && session.status === 'online') {
          addLog(accountId, 'OTO-KAZIM', 'Güvenlik bekleme süresi bitti. Doğal açılarla kazıma devam ediliyor.', chalk.green);
          startAutoMineLoop(accountId);
        }
      }, 8500);
    }
  }
}

function startAutoMineLoop(accountId) {
  const session = getOrCreateSession(accountId);
  if (session.mineTimer) {
    clearTimeout(session.mineTimer);
    session.mineTimer = null;
  }
  session.autoMine = true;
  session.isMiningBlock = false;
  if (!session.blocksMinedStreak) session.blocksMinedStreak = 0;
  session.lastNoBlockLogTime = 0;

  // Botun mevcut nişangah açısını (yaw/pitch) temel hat (baseYaw / basePitch) olarak sabitle!
  if (session.bot && session.bot.entity) {
    if (session.baseYaw === undefined || session.baseYaw === null) {
      session.baseYaw = session.bot.entity.yaw;
    }
    if (session.basePitch === undefined || session.basePitch === null) {
      session.basePitch = session.bot.entity.pitch;
    }
  }

  const step = async () => {
    if (!session.autoMine) return;

    const bot = session.bot;
    if (
      !bot ||
      !bot.entity ||
      session.status !== 'online' ||
      session.isDropping ||
      session.isEating ||
      session.isDepositing ||
      session.isSolvingCaptcha ||
      session.isRepairing
    ) {
      session.mineTimer = setTimeout(step, 400);
      return;
    }

    if (bot.currentWindow) {
      session.mineTimer = setTimeout(step, 500);
      return;
    }

    // Deadlock koruması: Kazım aşırı uzun süre takılı kaldıysa kilidi sıfırla
    if (session.isMiningBlock) {
      const maxMiningWait = Math.max((session.expectedDigTimeMs || 1000) * 2 + 3000, 12000);
      if (Date.now() - (session.miningStartTime || 0) > maxMiningWait) {
        session.isMiningBlock = false;
        bot.targetDigBlock = null;
      } else {
        session.mineTimer = setTimeout(step, 150);
        return;
      }
    }

    // Hedef bloğu bul
    const targetBlock = findBlockInFront(bot, session);

    if (targetBlock) {
      session.isMiningBlock = true;
      session.miningStartTime = Date.now();
      session.lastMinedPos = targetBlock.position;
      try {
        session.expectedDigTimeMs = calculateSafeDigTime(bot, targetBlock);
      } catch (e) {
        session.expectedDigTimeMs = 300;
      }

      try {
        const acc = config.accounts.find((a) => a.id === accountId);
        if (!acc || acc.autoTool !== false) {
          await equipBestToolForBlock(bot, targetBlock);
        }

        // --- OTO-TAMİR KONTROLÜ (Kazmaya başlamadan önce) ---
        if (checkNeedsRepair(bot, session, accountId)) {
          session.isMiningBlock = false;
          const repaired = await executeAutoRepairRoutine(bot, session, accountId);
          if (repaired) {
            session.mineTimer = setTimeout(step, 80);
            return;
          }
        }

        // Maden logu (Taş ve cobblestone harici maden çıktığında kullanıcıyı bilgilendir)
        const bName = targetBlock.name.toLowerCase();
        const isSpecialOre = bName.includes('ore') || bName.includes('raw_') || bName.includes('amethyst') || bName === 'obsidian';
        if (isSpecialOre && session.lastLoggedOrePos !== `${targetBlock.position.x},${targetBlock.position.y},${targetBlock.position.z}:${bName}`) {
          session.lastLoggedOrePos = `${targetBlock.position.x},${targetBlock.position.y},${targetBlock.position.z}:${bName}`;
          addLog(
            accountId,
            'OTO-KAZIM',
            `💎 Jeneratörde maden çıktı: ${targetBlock.displayName || targetBlock.name}, kazılıyor...`,
            chalk.cyanBright
          );
        }

        const success = await safeDigBlock(bot, targetBlock, session);
        if (success) {
          session.blocksMinedStreak = (session.blocksMinedStreak || 0) + 1;
          if (session.stats) {
            session.stats.blocksMined = (session.stats.blocksMined || 0) + 1;
            broadcastState();
          }

          // Bloğu kırdıktan sonra alet kritik eşiğe indiyse sonraki bloğa geçmeden hemen tamir et
          if (checkNeedsRepair(bot, session, accountId)) {
            await executeAutoRepairRoutine(bot, session, accountId);
          }
        }
      } catch (err) {
      } finally {
        session.isMiningBlock = false;
      }

      if (session.autoMine) {
        // Blok hala oradaysa (örn. maden henüz tamamen kırılmadıysa) beklemeden 30ms içinde vurmaya devam et!
        const curStillThere = bot.blockAt(targetBlock.position);
        const isStillSameBlock = curStillThere && curStillThere.name === targetBlock.name;
        const nextDelay = isStillSameBlock ? 30 : 40;
        session.mineTimer = setTimeout(step, nextDelay);
      }
    } else {
      // Blok henüz oluşmadıysa ve eldeki alet tamir istiyorsa jeneratör bekleme süresinde hemen tamir et!
      if (checkNeedsRepair(bot, session, accountId)) {
        await executeAutoRepairRoutine(bot, session, accountId);
      }
      // Blok henüz oluşmadıysa (örneğin cobblestone jeneratörü su+lavın birleşmesini bekliyorsa)
      // Botun bakışını daima kilitli hatta (baseYaw / basePitch) sabit tut!
      if (session.baseYaw !== undefined && session.basePitch !== undefined && session.baseYaw !== null && session.basePitch !== null) {
        try {
          bot.look(session.baseYaw, session.basePitch, true);
        } catch (e) {}
      }
      const now = Date.now();
      if (!session.lastNoBlockLogTime || now - session.lastNoBlockLogTime > 12000) {
        session.lastNoBlockLogTime = now;
        addLog(
          accountId,
          'OTO-KAZIM',
          'Önünüzdeki jeneratör bloğunun yenilenmesi bekleniyor...',
          chalk.gray
        );
      }
      session.mineTimer = setTimeout(step, 80);
    }
  };

  step();
}

function stopAutoMineLoop(accountId) {
  const session = getOrCreateSession(accountId);
  session.autoMine = false;
  session.isMiningBlock = false;
  session.baseYaw = null;
  session.basePitch = null;
  session.lastTargetY = null;
  session.lockedMinePos = null;
  session.lockedMineEmptySince = null;
  if (session.mineTimer) {
    clearTimeout(session.mineTimer);
    session.mineTimer = null;
  }
  if (session.bot) {
    try {
      if (session.bot.targetDigBlock) session.bot.stopDigging();
    } catch (e) {}
    session.bot.targetDigBlock = null;
    try {
      session.bot.setControlState('sneak', false);
    } catch (e) {}
  }
}

// --- 2. OTOMATİK MOB KESME (YALNIZCA ÖNÜNDEKİ HEDEF) VE OTO SAĞ TIK ---
function isLivingMobEntity(ent, botEntity) {
  if (!ent || ent === botEntity || !ent.position) return false;
  if (ent.type === 'player' || ent.type === 'object' || ent.type === 'orb' || ent.type === 'other') return false;
  const eName = (ent.name || '').toLowerCase();
  if (eName === 'armor_stand' || eName === 'item' || eName === 'arrow' || eName === 'experience_orb') return false;
  return ent.type === 'mob' || ent.type === 'hostile' || ent.type === 'animal' || ent.type === 'water_creature';
}

function getMobDirectlyInFront(bot, maxReach = 3.5) {
  if (!bot || !bot.entity || !bot.entity.position) return null;

  // 1) Önce doğrudan nişangahın (crosshair) üzerindeki canlı hedefi kontrol et
  if (typeof bot.entityAtCursor === 'function') {
    try {
      const cursorEnt = bot.entityAtCursor(maxReach);
      if (isLivingMobEntity(cursorEnt, bot.entity)) {
        return cursorEnt;
      }
    } catch (e) {}
  }

  // 2) Yedek: Botun kafasını döndürmeden, yalnızca tam önündeki dar görüş konisinde (cos >= 0.90, ~25°) bulunan en yakın mobu bul
  const eyePos = bot.entity.position.offset(0, bot.entity.height || 1.62, 0);
  const yaw = bot.entity.yaw || 0;
  const pitch = bot.entity.pitch || 0;
  const lookX = -Math.sin(yaw) * Math.cos(pitch);
  const lookY = Math.sin(pitch);
  const lookZ = -Math.cos(yaw) * Math.cos(pitch);

  let bestEnt = null;
  let minDist = maxReach;

  for (const ent of Object.values(bot.entities)) {
    if (!isLivingMobEntity(ent, bot.entity)) continue;
    const dist = bot.entity.position.distanceTo(ent.position);
    if (dist > minDist) continue;

    const targetCenter = ent.position.offset(0, (ent.height || 1.0) * 0.5, 0);
    const dx = targetCenter.x - eyePos.x;
    const dy = targetCenter.y - eyePos.y;
    const dz = targetCenter.z - eyePos.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.001 || len > maxReach) continue;

    const cosAngle = (dx * lookX + dy * lookY + dz * lookZ) / len;
    if (cosAngle >= 0.90) {
      minDist = dist;
      bestEnt = ent;
    }
  }

  return bestEnt;
}

function startAutoAttackLoop(accountId) {
  const session = getOrCreateSession(accountId);
  if (session.attackInterval) {
    clearInterval(session.attackInterval);
    session.attackInterval = null;
  }
  if (!session.autoAttack) return;

  session.attackInterval = setInterval(async () => {
    const bot = session.bot;
    const isBuilderActive = Boolean(session.builder && session.builder.status === 'building');
    if (!bot || !bot.entity || session.status !== 'online' || session.isEating || session.isDepositing || session.isRepairing || isBuilderActive) return;

    // Eldeki silah / aletin dayanıklılığı kritik eşikteyse saldırıyı durdur ve tamir et
    if (checkNeedsRepair(bot, session, accountId)) {
      await executeAutoRepairRoutine(bot, session, accountId);
      return;
    }

    // KillAura kullanılmaz: Bot kafasını çevirmeden yalnızca tam önündeki moba vurur
    const targetMob = getMobDirectlyInFront(bot, 3.5);
    if (targetMob) {
      try {
        bot.attack(targetMob);
        if (session.stats) {
          session.stats.mobsAttacked = (session.stats.mobsAttacked || 0) + 1;
          broadcastState();
        }
      } catch (e) {}
    }
  }, 650);
}

function startAutoRightClickLoop(accountId) {
  const session = getOrCreateSession(accountId);
  if (session.rightClickInterval) {
    clearInterval(session.rightClickInterval);
    session.rightClickInterval = null;
  }
  if (!session.autoRightClick) return;

  session.rightClickInterval = setInterval(() => {
    const bot = session.bot;
    const isBuilderActive = Boolean(session.builder && session.builder.status === 'building');
    if (!bot || !bot.entity || session.status !== 'online' || session.isEating || session.isDepositing || session.isDropping || isBuilderActive) return;
    try {
      bot.activateItem();
    } catch (e) {}
  }, 850);
}

// --- 3. ZAMANLAYICILI OTO-KOMUT (ÖR: /sell all) ---
function startAutoCommandLoop(accountId) {
  const session = getOrCreateSession(accountId);
  if (session.autoCmdInterval) {
    clearInterval(session.autoCmdInterval);
    session.autoCmdInterval = null;
  }

  const acc = config.accounts.find((a) => a.id === accountId);
  if (!acc || !acc.autoCommandEnabled || !acc.autoCommandText) return;

  const sec = Math.max(5, Number(acc.autoCommandIntervalSec) || 180);
  session.autoCmdInterval = setInterval(() => {
    const currentAcc = config.accounts.find((a) => a.id === accountId);
    if (!session.bot || session.status !== 'online' || !currentAcc || !currentAcc.autoCommandEnabled) return;

    const cmds = String(currentAcc.autoCommandText)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    cmds.forEach((cmd, idx) => {
      setTimeout(() => {
        if (session.bot && session.status === 'online') {
          addLog(accountId, 'OTO-KOMUT', `[Zamanlayıcı] ${cmd}`, chalk.yellow);
          session.bot.chat(cmd);
        }
      }, idx * 1200);
    });
  }, sec * 1000);
}

// --- 4. OTOMATİK YEMEK YEME (AUTO-EAT) & CAN KORUMASI ---
async function checkHealthAndHunger(accountId) {
  const session = sessions.get(accountId);
  const acc = config.accounts.find((a) => a.id === accountId);
  if (!session || !session.bot || !acc || session.status !== 'online') return;

  const bot = session.bot;
  if (typeof bot.health !== 'number' || bot.health <= 0) return;

  const threshold = Number(acc.panicHealth) || 6;

  // 1. GÜVENLİ İYİLEŞME MODU (Safe Recovery Mode)
  // Eğer bot oyuna zaten kritik canla (<= threshold) girdiyse (örneğin kurtarılmış fakat canı henüz dolmamışsa):
  // Hemen çıkış yapıp sonsuz döngüye girmemesi için güvenli iyileşme moduna alınır.
  if (session.initialSpawnHealth === undefined || session.initialSpawnHealth === null) {
    session.initialSpawnHealth = bot.health;
    session.spawnTime = Date.now();
    if (bot.health <= threshold) {
      session.safeRecoveryMode = true;
      addLog(
        accountId,
        'CAN-GÜVENLİĞİ',
        `🛡️ Bot düşük can ile (${Math.round(bot.health)}/20) oyuna girdi. Güvenli İyileşme Modu aktif: Yeni hasar almadığı sürece oyunda kalacak ve yemek yiyerek canını tazeleyecek.`,
        chalk.cyanBright
      );
    }
  }

  // Can güvenli eşiğin üstüne çıktıysa iyileşme modundan çık
  if (session.safeRecoveryMode && bot.health > threshold) {
    session.safeRecoveryMode = false;
    session.initialSpawnHealth = null;
    addLog(
      accountId,
      'CAN-GÜVENLİĞİ',
      `💚 Can güvenli seviyeye ulaştı (${Math.round(bot.health)}/20). Normal can koruması devrede.`,
      chalk.greenBright
    );
  }

  // 2. CAN KORUMASI (Panic Disconnect)
  if (acc.panicDisconnect) {
    if (session.safeRecoveryMode) {
      // Güvenli İyileşme Modundayken: Yalnızca YENİ HASAR ALIRSA (can girdiği andakinden daha da düşerse) çıkış yap!
      if (bot.health < session.initialSpawnHealth - 0.2) {
        const msg = `Güvenli iyileşme modundayken YENİ HASAR alındı (${Math.round(bot.health)}/20 < ${Math.round(session.initialSpawnHealth)})! Can Koruması devreye girdi, sunucudan çıkılıyor...`;
        addLog(accountId, 'UYARI', msg, chalk.redBright);
        triggerSoundAlert('damage', accountId, msg);
        if (!config.discord || config.discord.notifyPanic !== false) {
          sendDiscordWebhook('[KRITIK] Can Koruması Devreye Girdi!', msg, 0xff5252, accountId);
        }
        stopBot(accountId);
        return;
      }
    } else {
      // Normal moddayken: Can kritik seviyenin altına düştüğünde çıkış yap
      if (bot.health <= threshold) {
        const msg = `Can kritik seviyeye düştü (${Math.round(bot.health)}/20 <= ${threshold})! Can Koruması devreye girdi, sunucudan çıkılıyor...`;
        addLog(accountId, 'UYARI', msg, chalk.redBright);
        triggerSoundAlert('damage', accountId, msg);
        if (!config.discord || config.discord.notifyPanic !== false) {
          sendDiscordWebhook('[KRITIK] Can Koruması Devreye Girdi!', msg, 0xff5252, accountId);
        }
        stopBot(accountId);
        return;
      }
    }
  }

  // 3. AKILLI OTOMATİK YEMEK YEME (AUTO-EAT)
  // Canı eksikse (< 20) canın hızla yenilenmesi için açlık < 20 olduğu anda hemen yer!
  const targetFoodThreshold = (bot.health < 20) ? 19 : 15;
  if (acc.autoEat !== false && typeof bot.food === 'number' && bot.food <= targetFoodThreshold && !session.isEating && !session.isDropping) {
    const items = bot.inventory ? bot.inventory.items() : [];
    const foodItem = items.find((it) => FOOD_ITEMS.has(it.name));
    if (!foodItem) return;

    session.isEating = true;
    const prevHeld = bot.heldItem;

    if (bot.targetDigBlock) {
      try {
        bot.stopDigging();
      } catch (e) {}
    }

    try {
      await bot.equip(foodItem, 'hand');
      addLog(accountId, 'OTO-YEMEK', `${foodItem.displayName || foodItem.name} yeniyor (Açlık: ${Math.round(bot.food)}/20, Can: ${Math.round(bot.health)}/20)...`, chalk.green);
      await bot.consume();
      if (prevHeld && session.bot) {
        const stillHasPrev = bot.inventory.items().find((i) => i.slot === prevHeld.slot || i.name === prevHeld.name);
        if (stillHasPrev) {
          await bot.equip(stillHasPrev, 'hand');
        }
      }
    } catch (e) {
      // Yeme işlemi bölündüyse yoksay
    } finally {
      session.isEating = false;
      broadcastState();
    }
  }
}

function getActiveHandSlot(bot) {
  if (!bot || !bot.inventory) return -1;
  if (typeof bot.quickBarSlot === 'number' && bot.quickBarSlot >= 0 && bot.quickBarSlot <= 8) {
    return 36 + bot.quickBarSlot;
  }
  if (bot.heldItem && typeof bot.heldItem.slot === 'number') {
    return bot.heldItem.slot;
  }
  return -1;
}

function isItemActiveHand(bot, item) {
  if (!bot || !item) return false;
  if (bot.heldItem) {
    if (item === bot.heldItem) return true;
    if (typeof item.slot === 'number' && typeof bot.heldItem.slot === 'number' && item.slot === bot.heldItem.slot) {
      return true;
    }
  }
  const handSlot = getActiveHandSlot(bot);
  if (handSlot !== -1 && item.slot === handSlot) return true;
  return false;
}

function isEquippedArmorOrOffhand(slot) {
  if (typeof slot !== 'number') return false;
  // Yuvalar: 5 (kask), 6 (göğüslük), 7 (pantolon), 8 (bot), 45 (sol el / off-hand)
  return (slot >= 5 && slot <= 8) || slot === 45;
}

async function dropAllInventory(accountId) {
  const session = getOrCreateSession(accountId);
  const bot = session.bot;
  if (!bot || !bot.inventory || session.status !== 'online') {
    addLog(accountId, 'UYARI', 'Bot çevrimiçi olmadığı için envanter boşaltılamadı.', chalk.yellow);
    return;
  }

  if (session.isDropping) return;

  const allItems = bot.inventory.items();
  if (!allItems || allItems.length === 0) {
    addLog(accountId, 'ENVANTER', 'Envanter zaten boş.', chalk.yellow);
    return;
  }

  // Aktif eldeki eşyayı (kazma vb.) ve giyili zırhları/sol eli koru
  const dropCandidates = allItems.filter(
    (it) => !isItemActiveHand(bot, it) && !isEquippedArmorOrOffhand(it.slot)
  );

  const activeItem = bot.heldItem;
  const heldDesc = activeItem ? (activeItem.displayName || activeItem.name) : null;

  if (dropCandidates.length === 0) {
    addLog(
      accountId,
      'ENVANTER',
      `Boşaltılacak eşya bulunamadı (${heldDesc ? `eldeki "${heldDesc}" ve ` : ''}donanımlar korundu).`,
      chalk.yellow
    );
    return;
  }

  session.isDropping = true;
  if (bot.targetDigBlock) {
    try {
      bot.stopDigging();
    } catch (e) {}
  }

  addLog(
    accountId,
    'ENVANTER',
    `Envanterdeki ${dropCandidates.length} eşya yığını yere atılıyor...${heldDesc ? ` (Eldeki "${heldDesc}" korunuyor)` : ''}`,
    chalk.cyan
  );

  let droppedCount = 0;
  for (const item of dropCandidates) {
    if (!session.bot || session.status !== 'online') break;
    // Güvenlik teyidi: Aktif elde tutulan eşya asla yere atılmaz
    if (isItemActiveHand(bot, item) || isEquippedArmorOrOffhand(item.slot)) continue;
    try {
      await bot.tossStack(item);
      droppedCount++;
      await new Promise((r) => setTimeout(r, 120));
    } catch (err) {}
  }

  session.isDropping = false;
  addLog(
    accountId,
    'ENVANTER',
    `Envanter boşaltıldı (${droppedCount} yığın atıldı${heldDesc ? `, eldeki "${heldDesc}" korundu` : ''}).`,
    chalk.green
  );
  broadcastState();
}

// --- 5. OTOMATİK SANDIK BOŞALTMA (AUTO-CHEST DEPOSIT) ---
function isKeptToolOrFood(itemName) {
  if (!itemName) return false;
  const n = itemName.toLowerCase();
  if (FOOD_ITEMS.has(n)) return true;
  if (
    n.endsWith('_pickaxe') ||
    n.endsWith('_axe') ||
    n.endsWith('_shovel') ||
    n.endsWith('_sword') ||
    n.endsWith('_hoe') ||
    n.endsWith('_helmet') ||
    n.endsWith('_chestplate') ||
    n.endsWith('_leggings') ||
    n.endsWith('_boots') ||
    n === 'shears' ||
    n === 'bow' ||
    n === 'crossbow' ||
    n === 'shield' ||
    n === 'totem_of_undying' ||
    n === 'fishing_rod' ||
    n === 'elytra'
  ) {
    return true;
  }
  return false;
}

function isFarmContainerBlockName(name) {
  if (!name || typeof name !== 'string') return false;
  const bName = name.toLowerCase();
  return (
    bName === 'chest' ||
    bName === 'trapped_chest' ||
    bName === 'barrel' ||
    bName === 'shulker_box' ||
    bName.endsWith('_shulker_box')
  );
}

function findNearestContainerBlock(bot, maxDist = 5.2) {
  if (!bot || !bot.entity || !bot.entity.position) return null;
  const pos = bot.entity.position;
  const eyePos = pos.offset(0, 1.62, 0);
  const r = Math.ceil(maxDist);
  let bestBlock = null;
  let bestDist = maxDist;

  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const checkPos = pos.offset(dx, dy, dz).floored();
        const b = bot.blockAt(checkPos);
        if (!b || !b.name) continue;
        if (isFarmContainerBlockName(b.name)) {
          const center = checkPos.offset(0.5, 0.5, 0.5);
          const d = Math.min(pos.distanceTo(center), eyePos.distanceTo(center));
          if (d < bestDist) {
            bestDist = d;
            bestBlock = b;
          }
        }
      }
    }
  }
  return bestBlock;
}

/**
 * Sandık / konteyner bloklarını KESİNLİKLE düz sağ tık (sneak/shift olmadan) açar.
 * Shift sağ tık yapıldığında QuickShop/ChestShop gibi sunucu eklentilerinin market düzenleme
 * veya satın alma/satma menülerine girmesini tamamen engeller.
 */
async function safelyOpenContainer(bot, chestBlock, session, timeoutMs = 5000) {
  if (!bot || !chestBlock) throw new Error('Geçersiz bot veya sandık hedefi');

  const hadSneakLock = session ? Boolean(session.sneakLock) : false;

  // 1. Botun istemci tarafındaki çömelme/shift durumunu iptal et
  if (typeof bot.setControlState === 'function') {
    bot.setControlState('sneak', false);
  }

  // 2. Sunucuya da doğrudan ve garanti "çömelmeyi bırak" (stop_sneaking) paketi gönder
  if (bot._client && bot.entity) {
    try {
      if (bot.supportFeature && bot.supportFeature('newPlayerInputPacket')) {
        bot._client.write('player_input', { inputs: { shift: false, jump: false } });
      } else {
        bot._client.write('entity_action', {
          entityId: bot.entity.id,
          actionId: 1, // 1 = stop_sneaking (Mojang Notchian protokolü)
          jumpBoost: 0
        });
      }
    } catch (e) {}
  }

  // 3. Sunucunun ve eklentilerin botun dik durduğunu (düz duruş) kesin olarak işlemesi için 80ms bekle
  await new Promise((r) => setTimeout(r, 80));

  // 4. Sandığa insansı şekilde bak
  try {
    await bot.lookAt(chestBlock.position.offset(0.5, 0.5, 0.5), true);
  } catch (e) {}

  // 5. Sandığı düz sağ tık ile aç (zaman aşımı korumalı)
  const container = await Promise.race([
    bot.openContainer(chestBlock),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Sandık açılma yanıtı zaman aşımına uğradı (5sn)')), timeoutMs)
    )
  ]);

  return { container, hadSneakLock };
}

async function depositToNearbyChest(accountId, onlyWhenFull = false) {
  const session = getOrCreateSession(accountId);
  const bot = session.bot;
  if (!bot || !bot.inventory || session.status !== 'online') {
    if (!onlyWhenFull) {
      addLog(accountId, 'SANDIK', 'Bot çevrimiçi olmadığı için sandığa aktarım yapılamadı.', chalk.yellow);
    }
    return;
  }

  if (session.isDepositing || session.isDropping || session.isEating) return;

  const allItems = bot.inventory.items();
  const depositable = allItems.filter(
    (it) => !isKeptToolOrFood(it.name) && !isItemActiveHand(bot, it) && !isEquippedArmorOrOffhand(it.slot)
  );

  if (depositable.length === 0) {
    if (!onlyWhenFull) {
      const heldDesc = bot.heldItem ? `eldeki "${bot.heldItem.displayName || bot.heldItem.name}", ` : '';
      addLog(
        accountId,
        'SANDIK',
        `Envanterde sandığa aktarılacak eşya yok (${heldDesc}aletler ve yemekler korunur).`,
        chalk.yellow
      );
    }
    return;
  }

  if (onlyWhenFull && depositable.length < 20) {
    return;
  }

  const chestBlock = findNearestContainerBlock(bot);
  if (!chestBlock) {
    if (!onlyWhenFull) {
      addLog(accountId, 'SANDIK', '4.5 blok yakınlıkta sandık, varil veya shulker kutusu bulunamadı!', chalk.red);
    }
    return;
  }

  // 1. Sandığa dönmeden önce mevcut bakış açısını ve kazılan maden koordinatını kaydet
  const prevYaw = session.baseYaw !== undefined && session.baseYaw !== null ? session.baseYaw : (bot.entity ? bot.entity.yaw : null);
  const prevPitch = session.basePitch !== undefined && session.basePitch !== null ? session.basePitch : (bot.entity ? bot.entity.pitch : null);
  const savedMiningBlockPos = session.lockedMinePos ? session.lockedMinePos.clone() : (session.lastMinedPos ? session.lastMinedPos.clone() : null);

  session.isDepositing = true;
  session.isMiningBlock = false;
  if (session.mineTimer) {
    clearTimeout(session.mineTimer);
    session.mineTimer = null;
  }

  // Kazma işlemi devam ediyorsa derhal iptal et
  if (bot.targetDigBlock) {
    try {
      bot.stopDigging();
    } catch (e) {}
    bot.targetDigBlock = null;
  }

  let hadSneakLock = false;
  try {
    // DÜZ SAĞ TIK İLE SANDIĞI AÇ (Kesinlikle shift/sneak olmadan)
    const opened = await safelyOpenContainer(bot, chestBlock, session);
    const container = opened.container;
    hadSneakLock = opened.hadSneakLock;
    let movedStacks = 0;

    // Açılan container içerisinde aktif el yuvasını hesapla:
    const activeQuickBar = typeof bot.quickBarSlot === 'number' ? bot.quickBarSlot : 0;
    const handSlotInContainer = container.hotbarStart + activeQuickBar;

    // Yalnızca oyuncunun envanter/hotbar yuvalarını tara
    for (let slot = container.inventoryStart; slot < container.inventoryEnd; slot++) {
      if (!session.bot || session.status !== 'online') break;

      // 1. KESİNLİKLE AKTİF ELDEKİ YUVAYI ATLA (örn. kazma)
      if (slot === handSlotInContainer) continue;

      const slotItem = container.slots[slot];
      if (!slotItem) continue;

      // 2. Alet, silah, zırh veya yemek ise koru
      if (isKeptToolOrFood(slotItem.name)) continue;

      // 3. Shift-click ile doğrudan sandığa aktar
      const prevCount = slotItem.count;
      try {
        await bot.clickWindow(slot, 0, 1);
        await new Promise((r) => setTimeout(r, 90));

        // Eğer eşya aktarılmadıysa (sandık dolmuşsa) işlemi sonlandır
        const afterItem = container.slots[slot];
        if (afterItem && afterItem.count === prevCount) {
          break;
        }
        movedStacks++;
      } catch (err) {
        break;
      }
    }

    try {
      container.close();
    } catch (e) {}

    const heldDesc = bot.heldItem ? ` (Eldeki "${bot.heldItem.displayName || bot.heldItem.name}" korundu)` : '';
    if (movedStacks > 0) {
      if (session.stats) {
        session.stats.chestsDeposited = (session.stats.chestsDeposited || 0) + movedStacks;
      }
      addLog(accountId, 'OTO-SANDIK', `Yakındaki sandığa ${movedStacks} eşya yığını aktarıldı.${heldDesc}`, chalk.green);
    } else if (!onlyWhenFull) {
      addLog(accountId, 'SANDIK', 'Sandık dolu olduğu veya aktarılacak eşya kalmadığı için işlem tamamlandı.', chalk.yellow);
    }
  } catch (err) {
    if (!onlyWhenFull) {
      addLog(accountId, 'SANDIK', `Sandık açılamadı: ${err.message}`, chalk.red);
    }
  } finally {
    session.isDepositing = false;

    // Eğer kullanıcının özel eğilme kilidi (sneakLock) açıksa, sandık işlemi bittikten sonra geri aç
    if (hadSneakLock && session.bot && session.status === 'online') {
      try {
        session.bot.setControlState('sneak', true);
      } catch (e) {}
    }

    // 2. Sandık işlemi bittiğinde kafayı eski maden/blok açısına geri çevir
    if (session.bot && session.bot.entity && session.status === 'online') {
      try {
        if (session.baseYaw !== undefined && session.basePitch !== undefined && session.baseYaw !== null && session.basePitch !== null) {
          await session.bot.look(session.baseYaw, session.basePitch, true);
        } else if (savedMiningBlockPos) {
          // Önceden kazdığı bloğun pozisyonuna bak
          await session.bot.lookAt(savedMiningBlockPos.offset(0.5, 0.5, 0.5), true);
        } else if (prevYaw !== null && prevPitch !== null) {
          // Orijinal yaw ve pitch açısına geri dön
          await session.bot.look(prevYaw, prevPitch, true);
        }
      } catch (e) {}
    }

    broadcastState();

    // 3. Eğer blok kırma (oto-kazım) açıksa, kafayı çevirdikten sonra kazmaya kaldığı yerden devam et
    if (session.autoMine && session.status === 'online') {
      if (session.mineTimer) clearTimeout(session.mineTimer);
      session.mineTimer = setTimeout(() => {
        if (session.autoMine && session.bot && session.status === 'online') {
          startAutoMineLoop(accountId);
        }
      }, 350);
    }
  }
}

function startAutoChestLoop(accountId) {
  const session = getOrCreateSession(accountId);
  if (session.chestInterval) {
    clearInterval(session.chestInterval);
    session.chestInterval = null;
  }
  if (!session.autoChest) return;

  session.chestInterval = setInterval(() => {
    if (!session.autoChest || session.status !== 'online') return;
    depositToNearbyChest(accountId, true);
  }, 10000);
}

// --- 5.4. OTOMATİK TARLA & HASAT SİSTEMİ (AUTO-FARM: BUĞDAY, HAVUÇ, PATATES, PANCAR) ---
// YALNIZCA Patates, Buğday, Havuç ve Pancar desteklenir. Diğer hiçbir blok/ekin kırılmaz.
const CROP_HARVEST_CONFIG = {
  wheat: { maxAge: 7, seeds: ['wheat_seeds', 'seeds'], soil: ['farmland'] },
  carrots: { maxAge: 7, seeds: ['carrot', 'carrots'], soil: ['farmland'] },
  potatoes: { maxAge: 7, seeds: ['potato', 'potatoes'], soil: ['farmland'] },
  carrot: { maxAge: 7, seeds: ['carrot', 'carrots'], soil: ['farmland'] },
  potato: { maxAge: 7, seeds: ['potato', 'potatoes'], soil: ['farmland'] },
  beetroots: { maxAge: 3, seeds: ['beetroot_seeds', 'beetroot_seed'], soil: ['farmland'] },
  beetroot: { maxAge: 3, seeds: ['beetroot_seeds', 'beetroot_seed'], soil: ['farmland'] }
};

function wrapAngleRad(angle) {
  let a = angle;
  while (a < -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}

function smoothHumanLook(bot, targetYaw, targetPitch = 0.3, maxTurn = 1.15) {
  if (!bot || !bot.entity) return 0;
  const curYaw = bot.entity.yaw;
  const curPitch = bot.entity.pitch;

  const dyaw = wrapAngleRad(targetYaw - curYaw);

  // Hızlı fakat sarsıntısız dönüş (dairesel yörüngeye / kendi etrafında dönmeye engel olur)
  const clampedDyaw = Math.max(-maxTurn, Math.min(maxTurn, dyaw));
  const newYaw = curYaw + clampedDyaw;

  // Tarlaya bakış açısı: İnsan benzeri hafif aşağı bakış (~15 - 30 derece)
  const naturalPitch = Math.max(0.20, Math.min(0.50, targetPitch));
  const dpitch = naturalPitch - curPitch;
  const clampedDpitch = Math.max(-0.35, Math.min(0.35, dpitch));
  const newPitch = curPitch + clampedDpitch;

  try {
    bot.look(newYaw, newPitch, true);
  } catch (e) {}

  return Math.abs(wrapAngleRad(targetYaw - newYaw));
}

function normalizeTurkishText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/[İıI]/g, 'i')
    .replace(/[Şş]/g, 's')
    .replace(/[Çç]/g, 'c')
    .replace(/[Öö]/g, 'o')
    .replace(/[Üü]/g, 'u')
    .replace(/[Ğğ]/g, 'g')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isHarvestLimitPaused(session) {
  if (!session) return false;
  const now = Date.now();
  if (session.chatLimitPausedUntil && session.chatLimitPausedUntil > now) return true;
  if (session.isHarvestPausedByLimit) return true;
  if (session.actionBarPausedUntil && session.actionBarPausedUntil > now) return true;
  if (session.isHarvestPausedByActionBar) return true;
  return false;
}

function pauseAutoFarmForLimit(accountId, waitMs, reason = 'chat') {
  const session = getOrCreateSession(accountId);
  const now = Date.now();
  const pauseUntil = now + waitMs + 2000;

  if (reason === 'chat') {
    session.chatLimitPausedUntil = pauseUntil;
    session.harvestLimitPausedUntil = pauseUntil;
    session.isHarvestPausedByLimit = true;
  } else {
    // Chat limiti aktifken action bar chat limitini EZEMEZ
    if (session.chatLimitPausedUntil && session.chatLimitPausedUntil > now) return;
    session.actionBarPausedUntil = pauseUntil;
    session.isHarvestPausedByActionBar = true;
  }

  // İn-flight eylemleri, döngüleri ve yürüyüşü DERHAL İPTAL ET
  session.farmLoopId = (session.farmLoopId || 0) + 1;
  session.farmCurrentPath = null;
  session.farmTargetCropPos = null;
  if (session.farmTimer) {
    clearTimeout(session.farmTimer);
    session.farmTimer = null;
  }

  if (session.bot) {
    try {
      session.bot.setControlState('forward', false);
      session.bot.setControlState('back', false);
      session.bot.setControlState('left', false);
      session.bot.setControlState('right', false);
      session.bot.setControlState('jump', false);
      session.bot.setControlState('sprint', false);
      if (typeof session.bot.clearControlStates === 'function') {
        session.bot.clearControlStates();
      }
    } catch (e) {}
  }

  const minsLeft = Math.ceil(waitMs / 60000);
  const logMsg = reason === 'chat'
    ? `⏳ Hasat limitine ulaşıldı! Hasat işlemi durduruldu, bekleniyor: ~${minsLeft} dakika (Chat uyarısı)`
    : `⏳ Hasat hakkı 0! Yenilenme süresi bekleniyor: ~${minsLeft} dakika (Action Bar)`;

  if (!session.lastChatLimitLog || now - session.lastChatLimitLog > 3000) {
    session.lastChatLimitLog = now;
    addLog(accountId, 'OTO-HASAT', logMsg, chalk.yellowBright);
  }

  broadcastState();

  // Otomatik yeniden başlatma zamanlayıcısı (Resume Timer)
  if (reason === 'chat') {
    if (session.harvestLimitResumeTimer) clearTimeout(session.harvestLimitResumeTimer);
    session.harvestLimitResumeTimer = setTimeout(() => {
      session.harvestLimitResumeTimer = null;
      session.chatLimitPausedUntil = 0;
      session.harvestLimitPausedUntil = 0;
      session.isHarvestPausedByLimit = false;
      if (session.bot && session.status === 'online') {
        addLog(
          accountId,
          'OTO-HASAT',
          '⚡ Hasat limiti bekleme süresi doldu! Hasat işlemi otomatik olarak devam ettiriliyor.',
          chalk.greenBright
        );
        session.autoFarm = true;
        startAutoFarmLoop(accountId);
        broadcastState();
      }
    }, waitMs + 2000);
  } else {
    if (session.actionBarResumeTimer) clearTimeout(session.actionBarResumeTimer);
    session.actionBarResumeTimer = setTimeout(() => {
      session.actionBarResumeTimer = null;
      session.actionBarPausedUntil = 0;
      session.isHarvestPausedByActionBar = false;
      if (!isHarvestLimitPaused(session) && session.bot && session.status === 'online') {
        addLog(
          accountId,
          'OTO-HASAT',
          '⚡ Hasat hakkı yenilendi! Hasat işlemi otomatik olarak devam ettiriliyor.',
          chalk.greenBright
        );
        session.autoFarm = true;
        startAutoFarmLoop(accountId);
        broadcastState();
      }
    }, waitMs + 1000);
  }
}

function handleHarvestLimitMessage(session, message, accountId) {
  if (!session || !message || typeof message !== 'string') return;
  const norm = normalizeTurkishText(message);
  const isLimitMatch =
    norm.includes('hasat limit') ||
    norm.includes('limitine ulastin') ||
    norm.includes('limitine ulastiniz') ||
    (norm.includes('hasat') && norm.includes('limit')) ||
    norm.includes('beklemen gereken') ||
    norm.includes('beklemeniz gereken') ||
    norm.includes('hasat hakkin bitti');

  if (!isLimitMatch) return;

  // Görsel 1: LIMIT » HASAT LIMITINE ULAŞTIN! BEKLEMEN GEREKEN: 28 DK
  let waitMs = 60 * 1000; // Varsayılan 1 dakika
  const timerMatch = norm.match(/beklemen(?:iz)?\s+gereken[^\d]*(\d+)\s*(dk|dakika|sn|saniye|saat|h|m|s)?/i);
  if (timerMatch) {
    const val = parseInt(timerMatch[1], 10);
    const unit = (timerMatch[2] || 'dk').toLowerCase();
    if (unit.startsWith('saat') || unit === 'h') {
      waitMs = val * 3600 * 1000;
    } else if (unit.startsWith('sn') || unit.startsWith('saniye') || unit === 's') {
      waitMs = val * 1000;
    } else {
      waitMs = val * 60 * 1000;
    }
  } else {
    const mmssMatch = norm.match(/beklemen(?:iz)?\s+gereken[^\d]*(\d+):(\d+)/i);
    if (mmssMatch) {
      const m = parseInt(mmssMatch[1], 10);
      const s = parseInt(mmssMatch[2], 10);
      waitMs = (m * 60 + s) * 1000;
    } else {
      const genMatch = norm.match(/(\d+)\s*(dk|dakika|sn|saniye|saat)/i);
      if (genMatch) {
        const val = parseInt(genMatch[1], 10);
        const unit = genMatch[2].toLowerCase();
        if (unit.startsWith('saat')) {
          waitMs = val * 3600 * 1000;
        } else if (unit.startsWith('sn') || unit.startsWith('saniye')) {
          waitMs = val * 1000;
        } else {
          waitMs = val * 60 * 1000;
        }
      }
    }
  }

  // Minimum bekleme 30 saniye
  waitMs = Math.max(waitMs, 30000);

  pauseAutoFarmForLimit(accountId, waitMs, 'chat');
}

function handleHarvestActionBar(session, message, accountId) {
  if (!session || !message || typeof message !== 'string') return;

  // MUTLAK KURAL: Chat hasat limiti (örneğin 28 dakika) aktifse,
  // Action bar ASLA ve ASLA hasatı yeniden başlatamaz veya duraklamayı kaldıramaz!
  const now = Date.now();
  if (session.chatLimitPausedUntil && session.chatLimitPausedUntil > now) {
    return;
  }
  if (session.isHarvestPausedByLimit) {
    return;
  }

  const norm = normalizeTurkishText(message);
  if (!norm.includes('hasat hakki') && !norm.includes('yenilenme')) return;

  // Görsel 2: HASAT HAKKIN: 0 | YENİLENME: 10:24 | EKİN: Patates &8l ⚡
  const rightsMatch = norm.match(/hasat\s+hakki?n?[^\d]*(\d+)/i);
  const timerMatch = norm.match(/yenilenme[^\d]*(\d+)(?::(\d+))?/i);

  if (rightsMatch) {
    const rights = parseInt(rightsMatch[1], 10);
    if (rights > 0) {
      if (session.isHarvestPausedByActionBar) {
        if (session.actionBarResumeTimer) clearTimeout(session.actionBarResumeTimer);
        session.actionBarPausedUntil = 0;
        session.isHarvestPausedByActionBar = false;
        if (!isHarvestLimitPaused(session) && session.bot && session.status === 'online') {
          addLog(
            accountId,
            'OTO-HASAT',
            `⚡ Hasat hakkı yenilendi (${rights} hak)! Hasat işlemine devam ediliyor.`,
            chalk.greenBright
          );
          session.autoFarm = true;
          startAutoFarmLoop(accountId);
          broadcastState();
        }
      }
      return;
    }

    // Hak 0 ise yenilenme süresine göre duraklat
    if (timerMatch) {
      let waitMs = 0;
      if (timerMatch[2] !== undefined) {
        // MM:SS
        const m = parseInt(timerMatch[1], 10);
        const s = parseInt(timerMatch[2], 10);
        waitMs = (m * 60 + s) * 1000;
      } else {
        waitMs = parseInt(timerMatch[1], 10) * 1000;
      }

      if (waitMs > 0) {
        pauseAutoFarmForLimit(accountId, waitMs, 'actionbar');
      } else if (waitMs === 0) {
        if (session.isHarvestPausedByActionBar) {
          if (session.actionBarResumeTimer) clearTimeout(session.actionBarResumeTimer);
          session.actionBarPausedUntil = 0;
          session.isHarvestPausedByActionBar = false;
          if (!isHarvestLimitPaused(session) && session.bot && session.status === 'online') {
            addLog(
              accountId,
              'OTO-HASAT',
              `⚡ Yenilenme süresi doldu! Hasat işlemine devam ediliyor.`,
              chalk.greenBright
            );
            session.autoFarm = true;
            startAutoFarmLoop(accountId);
            broadcastState();
          }
        }
      }
    }
  }
}

function getBlockAge(block) {
  if (!block) return -1;
  if (block._properties && block._properties.age !== undefined) {
    const parsed = parseInt(block._properties.age, 10);
    if (!isNaN(parsed)) return parsed;
  }
  if (block.metadata !== undefined && typeof block.metadata === 'number') {
    return block.metadata;
  }
  return -1;
}

function isCropHarvestable(bot, block) {
  if (!bot || !block || !block.name) return false;
  const name = block.name.toLowerCase();

  // YALNIZCA Buğday, Havuç, Patates ve Pancar
  if (CROP_HARVEST_CONFIG[name]) {
    const age = getBlockAge(block);
    return age >= CROP_HARVEST_CONFIG[name].maxAge;
  }
  return false;
}

function isBotInventoryFull(bot) {
  if (!bot || !bot.inventory) return false;
  if (typeof bot.inventory.emptySlotCount === 'function') {
    return bot.inventory.emptySlotCount() <= 1;
  }
  if (typeof bot.inventory.firstEmptyInventorySlot === 'function') {
    return bot.inventory.firstEmptyInventorySlot() === null;
  }
  let emptyCount = 0;
  for (let s = 9; s <= 44; s++) {
    if (!bot.inventory.slots[s]) emptyCount++;
  }
  return emptyCount <= 1;
}

// --- TARLA AYDINLATMA VE ENGEL BLOKLARI ---
const FARM_LIGHTING_BLOCKS = new Set([
  'sea_lantern',
  'glowstone',
  'shroomlight',
  'redstone_lamp',
  'jack_o_lantern',
  'ochre_froglight',
  'pearlescent_froglight',
  'verdant_froglight',
  'lantern',
  'soul_lantern',
  'torch',
  'wall_torch',
  'soul_torch',
  'soul_wall_torch',
  'end_rod',
  'lightning_rod',
  'campfire',
  'soul_campfire',
  'magma_block',
  'crying_obsidian',
  'beacon',
  'conduit'
]);

function isLightingOrObstacleBlock(block) {
  if (!block || !block.name) return false;
  const name = block.name.toLowerCase();
  if (FARM_LIGHTING_BLOCKS.has(name)) return true;
  if (
    name.includes('lantern') ||
    name.includes('torch') ||
    name.includes('lamp') ||
    name.includes('glow') ||
    name.includes('shroomlight') ||
    name.includes('froglight')
  ) {
    return true;
  }
  return false;
}

// --- ENGEL VE YOL GEÇİRGENLİK KURALLARI (A* PATHFINDER) ---
function isBlockPassable(block) {
  if (!block || !block.name) return true;
  const name = block.name.toLowerCase();
  if (name === 'air' || name === 'cave_air' || name === 'void_air') return true;
  // Hasat edilen ekinler ve içinden geçilebilir objeler
  if (name === 'wheat' || name === 'carrots' || name === 'potatoes' || name === 'carrot' || name === 'potato' || name === 'beetroots' || name === 'beetroot') return true;
  if (name.includes('grass') || name.includes('flower') || name.includes('sapling')) return true;
  if (name.includes('torch') || name.includes('rail') || name.includes('carpet')) return true;
  if (name === 'water' || name === 'vine' || name === 'ladder' || name.includes('sign')) return true;
  if (block.boundingBox === 'empty') return true;
  return false;
}

function isBlockWalkableFloor(block, session = null) {
  if (!block || !block.name) return false;
  const name = block.name.toLowerCase();
  if (
    name === 'air' ||
    name === 'cave_air' ||
    name === 'void_air' ||
    name === 'lava' ||
    name === 'flowing_lava' ||
    name === 'water' ||
    name === 'flowing_water' ||
    name === 'fire' ||
    name === 'soul_fire' ||
    name === 'cactus' ||
    name === 'sweet_berry_bush' ||
    name === 'cobweb' ||
    name === 'powder_snow' ||
    name === 'magma_block' ||
    name === 'campfire' ||
    name === 'soul_campfire'
  ) {
    return false;
  }
  // Boş hitbox'lı (meşale, kızıltaş, şalter, düğme, tabela, ip, ekin vb.) bloklar asla zemin olamaz!
  if (block.boundingBox === 'empty' || isBlockPassable(block)) return false;
  // Çitler (fences) ve duvarlar (walls) 1.5 blok yüksekliğindedir, asla üzerine çıkılamaz veya zıplanamaz!
  if (name.includes('fence') || name.includes('wall') || name.includes('gate') || name.includes('iron_bars')) return false;
  // Tarla modlarında aydınlatma blokları (deniz feneri, ışıktaşı vb.) yürünebilir zemin sayılmaz;
  // ancak Oto-İnşa (builder) sırasında tam katı ışık blokları (sea_lantern, glowstone, shroomlight, redstone_lamp) üzerinde yürünebilir.
  const isBuilderActive = Boolean(session && session.builder && session.builder.status === 'building');
  if (!isBuilderActive && isLightingOrObstacleBlock(block)) return false;
  if (
    isBuilderActive &&
    (name.includes('lantern') && name !== 'sea_lantern' && name !== 'jack_o_lantern')
  ) {
    return false;
  }
  return true;
}

function isWalkablePosition(bot, pos, session = null) {
  const foot = bot.blockAt(pos);
  const head = bot.blockAt(pos.offset(0, 1, 0));
  const floor = bot.blockAt(pos.offset(0, -1, 0));

  // Ayak ve kafa seviyesi tamamen açık olmalıdır (blok, yarım blok, çit olamaz)
  if (!isBlockPassable(foot) || !isBlockPassable(head)) return false;
  // Ayak seviyesinde aydınlatma bloğu olamaz
  if (isLightingOrObstacleBlock(foot)) return false;
  // Basılan zemin sağlam olmalı ve çit/duvar/lav/aydınlatma olmamalıdır
  if (!isBlockWalkableFloor(floor, session)) return false;
  return true;
}

function shouldJumpOverStep(bot, session = null) {
  if (!bot || !bot.entity || !bot.entity.position) return false;
  if (bot.entity.onGround === false && Math.abs(bot.entity.velocity ? bot.entity.velocity.y : 0) > 0.08) {
    return false;
  }

  const pos = bot.entity.position;
  const yaw = bot.entity.yaw;
  const sin = -Math.sin(yaw);
  const cos = -Math.cos(yaw);

  const footY = Math.floor(pos.y + 0.2);
  const blockAboveHead = bot.blockAt(new Vec3(Math.floor(pos.x), footY + 2, Math.floor(pos.z)));
  if (!isBlockPassable(blockAboveHead)) return false;

  const distances = [0.65, 0.45];
  for (const d of distances) {
    const aheadX = Math.floor(pos.x + sin * d);
    const aheadZ = Math.floor(pos.z + cos * d);

    if (aheadX !== Math.floor(pos.x) || aheadZ !== Math.floor(pos.z)) {
      const blockAtFoot = bot.blockAt(new Vec3(aheadX, footY, aheadZ));
      const blockAboveFoot = bot.blockAt(new Vec3(aheadX, footY + 1, aheadZ));
      const blockAboveStep = bot.blockAt(new Vec3(aheadX, footY + 2, aheadZ));

      // Aydınlatma bloğunun veya fenerin üzerine ASLA zıplama!
      if (isLightingOrObstacleBlock(blockAtFoot) || isLightingOrObstacleBlock(blockAboveFoot)) {
        return false;
      }

      const isFootSolid = blockAtFoot && !isBlockPassable(blockAtFoot);
      const isFenceOrWall = blockAtFoot && (
        blockAtFoot.name.includes('fence') ||
        blockAtFoot.name.includes('wall') ||
        blockAtFoot.name.includes('gate') ||
        blockAtFoot.name.includes('iron_bars')
      );
      const isStepPassable = isBlockPassable(blockAboveFoot);
      const isStepHeadPassable = isBlockPassable(blockAboveStep);

      if (isFootSolid && !isFenceOrWall && isStepPassable && isStepHeadPassable) {
        return true;
      }
    }
  }

  if (bot.entity.isCollidedHorizontally) {
    const aheadX = Math.floor(pos.x + sin * 0.5);
    const aheadZ = Math.floor(pos.z + cos * 0.5);
    const blockAtFoot = bot.blockAt(new Vec3(aheadX, footY, aheadZ));
    const blockAboveFoot = bot.blockAt(new Vec3(aheadX, footY + 1, aheadZ));

    if (isLightingOrObstacleBlock(blockAtFoot) || isLightingOrObstacleBlock(blockAboveFoot)) {
      return false;
    }

    const isFenceOrWall = blockAtFoot && (
      blockAtFoot.name.includes('fence') ||
      blockAtFoot.name.includes('wall') ||
      blockAtFoot.name.includes('gate') ||
      blockAtFoot.name.includes('iron_bars')
    );
    if (!isFenceOrWall && isBlockPassable(blockAboveFoot)) {
      return true;
    }
  }

  return false;
}

function tryJumpOverStep(bot, session = null) {
  if (!bot) return;
  if (shouldJumpOverStep(bot, session)) {
    bot.setControlState('jump', true);
    setTimeout(() => {
      if (bot) bot.setControlState('jump', false);
    }, 250);
  }
}

function isNearIslandEdge(bot) {
  if (!bot || !bot.entity || !bot.entity.position) return false;
  return isBotOverhangingOrNearEdge(bot);
}

function isSafeToStep(bot, yaw, session = null, options = {}) {
  if (!bot || !bot.entity || !bot.entity.position) return true;
  const pos = bot.entity.position;
  const sin = -Math.sin(yaw);
  const cos = -Math.cos(yaw);

  const curFootY = Math.floor(pos.y + 0.2);
  const curFloorY = curFootY - 1;
  const isBuilderBuilding = Boolean(session && session.builder && session.builder.status === 'building');
  const allowStepDown = options && typeof options.allowStepDown === 'boolean'
    ? options.allowStepDown
    : !isBuilderBuilding;

  // Öne doğru mesafeleri kontrol et (0.38m, 0.65m ve 0.90m)
  for (const d of [0.38, 0.65, 0.90]) {
    const aheadX = Math.floor(pos.x + sin * d);
    const aheadZ = Math.floor(pos.z + cos * d);

    if (aheadX === Math.floor(pos.x) && aheadZ === Math.floor(pos.z)) continue;

    const floorBlock = bot.blockAt(new Vec3(aheadX, curFloorY, aheadZ));
    const footBlock = bot.blockAt(new Vec3(aheadX, curFootY, aheadZ));

    // Önündeki blok 1 blok yukarı basamaksa (merdiven, yarım blok, basamak toprak)
    const isStepUp = footBlock && !isBlockPassable(footBlock) && !footBlock.name.includes('fence') && !footBlock.name.includes('wall');
    if (isStepUp) {
      // Tarla modunda basamak bir aydınlatma bloğu ise (sea_lantern vb.), üzerine ASLA çıkma!
      if (!isBuilderBuilding && isLightingOrObstacleBlock(footBlock)) {
        return false;
      }
      const stepHead = bot.blockAt(new Vec3(aheadX, curFootY + 1, aheadZ));
      const stepCeil = bot.blockAt(new Vec3(aheadX, curFootY + 2, aheadZ));
      if (isBlockPassable(stepHead) && isBlockPassable(stepCeil)) {
        continue; // 1 blok yukarı çıkış güvenli
      }
      return false;
    }

    // Aksi halde floorBlock yürünebilir bir zemin olmalıdır.
    if (!floorBlock || !isBlockWalkableFloor(floorBlock, session)) {
      if (allowStepDown) {
        const stepDownFloor = bot.blockAt(new Vec3(aheadX, curFloorY - 1, aheadZ));
        const stepDownFoot = bot.blockAt(new Vec3(aheadX, curFloorY, aheadZ));
        const stepDownHead = bot.blockAt(new Vec3(aheadX, curFloorY + 1, aheadZ));
        if (
          stepDownFloor &&
          isBlockWalkableFloor(stepDownFloor, session) &&
          (isBuilderBuilding || !isLightingOrObstacleBlock(stepDownFloor)) &&
          isBlockPassable(stepDownFoot) &&
          isBlockPassable(stepDownHead)
        ) {
          continue; // Doğrulanmış 1 blok basamak inişi güvenli
        }
      }
      return false; // Katman kenarı, boşluk veya ada kenarı -> DUR!
    }
  }

  return true;
}

/**
 * Bot tarladaki 1 blok yüksekliğindeki aydınlatma (fener/lamba vb.) veya yükselti üzerindeyse
 * derhal etraftaki güvenli tarlaya inmesini sağlar.
 */
function checkAndDescendFromFarmObstacle(bot, session) {
  if (!bot || !bot.entity || !bot.entity.position) return false;
  const pos = bot.entity.position;
  const footY = Math.floor(pos.y + 0.25);

  const curFloor = bot.blockAt(new Vec3(Math.floor(pos.x), footY - 1, Math.floor(pos.z)));
  const isOnObstacle = curFloor && isLightingOrObstacleBlock(curFloor);

  if (!isOnObstacle) return false;

  // Bot aydınlatma bloğu (sea_lantern, glowstone, lantern vb.) üzerinde kilitlenmiş; yanındaki tarlaya in
  const targetGroundY = footY - 1;
  const curX = Math.floor(pos.x);
  const curZ = Math.floor(pos.z);

  const candidates = [
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 },
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 1, dz: 1 },
    { dx: -1, dz: 1 },
    { dx: 1, dz: -1 },
    { dx: -1, dz: -1 }
  ];

  for (const c of candidates) {
    const nx = curX + c.dx;
    const nz = curZ + c.dz;
    const ground = bot.blockAt(new Vec3(nx, targetGroundY - 1, nz));
    const foot = bot.blockAt(new Vec3(nx, targetGroundY, nz));
    const head = bot.blockAt(new Vec3(nx, targetGroundY + 1, nz));

    if (
      ground &&
      isBlockWalkableFloor(ground, session) &&
      !isLightingOrObstacleBlock(ground) &&
      isBlockPassable(foot) &&
      !isLightingOrObstacleBlock(foot) &&
      isBlockPassable(head)
    ) {
      const targetPos = new Vec3(nx + 0.5, targetGroundY, nz + 0.5);
      const dx = targetPos.x - pos.x;
      const dz = targetPos.z - pos.z;
      const targetYaw = Math.atan2(-dx, -dz);
      smoothHumanLook(bot, targetYaw, 0.35);
      bot.setControlState('sneak', false);
      bot.setControlState('forward', true);
      setTimeout(() => {
        if (bot) bot.setControlState('forward', false);
      }, 250);
      return true;
    }
  }

  return false;
}

// --- AKILLI A* YOL BULUCU (ENGELLERİN VE ÇİTLERİN ETRAFINDAN DOLAŞIR) ---
function findFarmPath(bot, startPos, goalPos, session = null, maxNodes = 2500, goalRadius = 1.85) {
  if (!bot || !startPos || !goalPos) return null;

  // Eğer hedef blok bir zemin bloğuysa (farmland, dirt, grass_block vb.) ve üstü açıksa,
  // yürünebilir ayak seviyesi goalPos.y + 1'dir.
  const goalBlock = bot.blockAt(goalPos);
  const goalAbove = bot.blockAt(goalPos.offset(0, 1, 0));
  const goalFootY =
    goalBlock && !isBlockPassable(goalBlock) && isBlockPassable(goalAbove)
      ? goalPos.y + 1
      : goalPos.y;
  const goalFootVec = new Vec3(goalPos.x, goalFootY, goalPos.z);

  const isGoal = (pos) => {
    const dx = pos.x + 0.5 - (goalPos.x + 0.5);
    const dy = pos.y - goalFootY;
    const dz = pos.z + 0.5 - (goalPos.z + 0.5);
    return (dx * dx + dz * dz) <= goalRadius * goalRadius && Math.abs(dy) <= 1.5;
  };

  if (isGoal(startPos)) return [];

  const openSet = [{ pos: startPos, g: 0, f: startPos.distanceTo(goalFootVec) }];
  const cameFrom = new Map();
  const gScore = new Map();
  gScore.set(startPos.toString(), 0);
  const closedSet = new Set();

  const neighbors = [
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 }
  ];

  let nodesCount = 0;
  let closestNode = startPos;
  let minH = startPos.distanceTo(goalFootVec);

  while (openSet.length > 0 && nodesCount < maxNodes) {
    nodesCount++;
    openSet.sort((a, b) => a.f - b.f);
    const cur = openSet.shift();
    const curKey = cur.pos.toString();

    if (isGoal(cur.pos)) {
      const path = [cur.pos];
      let k = curKey;
      while (cameFrom.has(k)) {
        const prev = cameFrom.get(k);
        path.unshift(prev);
        k = prev.toString();
      }
      return path.slice(1);
    }

    closedSet.add(curKey);

    const h = cur.pos.distanceTo(goalFootVec);
    if (h < minH) {
      minH = h;
      closestNode = cur.pos;
    }

    for (const n of neighbors) {
      const nx = cur.pos.x + n.dx;
      const nz = cur.pos.z + n.dz;
      const y = cur.pos.y;

      const candidates = [];

      // 1. Düz hareket (dy = 0)
      const candFlat = new Vec3(nx, y, nz);
      if (isWalkablePosition(bot, candFlat, session)) {
        candidates.push({ pos: candFlat, cost: 1.0 });
      }

      // 2. Bir blok yukarı çıkış (dy = +1, basamak/teras)
      // Kafanın üzerinde tavan/yarım blok ENGELİ YOKSA ve basamak çit/duvar DEĞİLSE
      const candUp = new Vec3(nx, y + 1, nz);
      const headCeilClear = isBlockPassable(bot.blockAt(cur.pos.offset(0, 2, 0)));
      const stepObstacle = bot.blockAt(new Vec3(nx, y, nz));
      const isStepFence = stepObstacle && (
        stepObstacle.name.includes('fence') ||
        stepObstacle.name.includes('wall') ||
        stepObstacle.name.includes('gate') ||
        isLightingOrObstacleBlock(stepObstacle)
      );
      if (headCeilClear && !isStepFence && isWalkablePosition(bot, candUp, session)) {
        candidates.push({ pos: candUp, cost: 1.4 });
      }

      // 3. Bir blok aşağı iniş (dy = -1)
      const candDown = new Vec3(nx, y - 1, nz);
      const spaceAboveClear = isBlockPassable(bot.blockAt(new Vec3(nx, y, nz)));
      if (spaceAboveClear && isWalkablePosition(bot, candDown, session)) {
        candidates.push({ pos: candDown, cost: 1.2 });
      }

      for (const cand of candidates) {
        const candKey = cand.pos.toString();
        if (closedSet.has(candKey)) continue;

        const tentativeG = cur.g + cand.cost;
        if (!gScore.has(candKey) || tentativeG < gScore.get(candKey)) {
          cameFrom.set(candKey, cur.pos);
          gScore.set(candKey, tentativeG);
          const f = tentativeG + cand.pos.distanceTo(goalFootVec) * 1.15;
          const existing = openSet.find((item) => item.pos.toString() === candKey);
          if (!existing) {
            openSet.push({ pos: cand.pos, g: tentativeG, f });
          } else {
            existing.g = tentativeG;
            existing.f = f;
          }
        }
      }
    }
  }

  // Tam hedefe ulaşılamadıysa ama daha yakın bir konuma yol bulunduysa oraya git
  if (minH < startPos.distanceTo(goalFootVec) - 1.2) {
    const path = [closestNode];
    let k = closestNode.toString();
    while (cameFrom.has(k)) {
      const prev = cameFrom.get(k);
      path.unshift(prev);
      k = prev.toString();
    }
    return path.slice(1);
  }

  return null;
}

/**
 * Kendi etrafında dönmeyi (yörüngeye girmeyi) engelleyen ve akıcı yürüyüş sağlayan yönelim yardımcısı.
 * Keskin dönüşlerde (> ~50 derece / 0.85 rad) ileri tuşunu geçici duraklatır; hafif yön düzeltmelerinde
 * takılmadan ve laglanmadan akıcı yürüyüşü ('forward' ve 'sprint') sürdürür.
 */
function alignAndStepForward(bot, targetYaw, session = null, dyStep = 0) {
  if (!bot || !bot.entity) return false;
  const remYaw = smoothHumanLook(bot, targetYaw, 0.35, 1.85);

  // Sadece hedeften tamamen farklı bir yöne bakıyorsa (> 50 derece) keskin dönüş için durakla
  if (remYaw > 0.85) {
    bot.setControlState('forward', false);
    bot.setControlState('sprint', false);
    bot.setControlState('jump', false);
    return true;
  }

  if (!isSafeToStep(bot, targetYaw, session)) {
    bot.setControlState('forward', false);
    bot.setControlState('sprint', false);
    bot.setControlState('jump', false);
    return false;
  }

  // Tarla/hasat/çapa/ekim adımlarında normal yürüme/koşma hızını sağla (sneak'i kapat)
  if (!session || !session.sneakLock) {
    bot.setControlState('sneak', false);
  }

  bot.setControlState('forward', true);
  if (remYaw < 0.40) {
    bot.setControlState('sprint', true);
  } else {
    bot.setControlState('sprint', false);
  }

  if (bot.entity.onGround && (dyStep >= 0.35 || shouldJumpOverStep(bot, session))) {
    bot.setControlState('jump', true);
  } else if (!bot.entity.onGround || dyStep < 0.20) {
    bot.setControlState('jump', false);
  }
  return true;
}

/**
 * Tarla modları (Oto-Çapa, Oto-Ekim, Oto-Hasat ve Tarla Sandığı) için birleşik,
 * kendi etrafında dönmeyen ve uzak hedeflerde takılmayan A* yürüyüş yöneticisi.
 * Dönüş değerleri: 'reached' | 'walking' | 'unreachable'
 */
function stepFarmWalkTowardsTarget(
  bot,
  session,
  targetBlockPos,
  statePrefix,
  reachEyeDist = 3.65,
  reachHorizDist = 3.45,
  targetTopYOffset = 0.95
) {
  if (!bot || !bot.entity || !bot.entity.position || !session || !targetBlockPos) {
    return 'unreachable';
  }

  const myPos = bot.entity.position;
  const eyePos = myPos.offset(0, bot.entity.height || 1.62, 0);
  const targetCenter = targetBlockPos.offset(0.5, targetTopYOffset, 0.5);
  const eyeDist = eyePos.distanceTo(targetCenter);
  const horizDist = Math.hypot(targetBlockPos.x + 0.5 - myPos.x, targetBlockPos.z + 0.5 - myPos.z);

  if (eyeDist <= reachEyeDist && horizDist <= reachHorizDist) {
    bot.setControlState('forward', false);
    bot.setControlState('jump', false);
    bot.setControlState('sprint', false);
    if (!session || !session.sneakLock) {
      bot.setControlState('sneak', false);
    }
    return 'reached';
  }

  const pathKey = `${statePrefix}CurrentPath`;
  const idxKey = `${statePrefix}PathIndex`;
  const targetStrKey = `${statePrefix}NavTargetStr`;
  const bestDistKey = `${statePrefix}NavBestDist`;
  const lastProgKey = `${statePrefix}NavLastProgressTime`;
  const replanCountKey = `${statePrefix}NavReplanCount`;

  const curTargetStr = targetBlockPos.toString();
  const now = Date.now();

  if (session[targetStrKey] !== curTargetStr) {
    session[targetStrKey] = curTargetStr;
    session[bestDistKey] = horizDist;
    session[lastProgKey] = now;
    session[replanCountKey] = 0;
    session[pathKey] = null;
    session[idxKey] = 0;
  } else {
    if (typeof session[bestDistKey] !== 'number' || horizDist < session[bestDistKey] - 0.28) {
      session[bestDistKey] = horizDist;
      session[lastProgKey] = now;
    } else if (now - (session[lastProgKey] || now) > 1500) {
      // 1.5 saniyedir hedefe net olarak yaklaşamadıysa rotayı yeniden hesapla
      session[pathKey] = null;
      session[idxKey] = 0;
      session[lastProgKey] = now;
      session[replanCountKey] = (session[replanCountKey] || 0) + 1;
      if (session[replanCountKey] >= 3) {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
        return 'unreachable';
      }
    }
  }

  const botFootPos = new Vec3(
    Math.floor(myPos.x),
    Math.floor(myPos.y + 0.25),
    Math.floor(myPos.z)
  );
  const goalRadius = Math.min(2.0, Math.max(1.35, reachHorizDist - 1.15));

  // Rota yoksa veya kısmi rota bittiyse hemen yeni A* rotası hesapla
  if (!Array.isArray(session[pathKey]) || session[pathKey].length === 0 || (session[idxKey] || 0) >= session[pathKey].length) {
    session[pathKey] = findFarmPath(bot, botFootPos, targetBlockPos, session, 2500, goalRadius);
    session[idxKey] = 0;
  }

  const path = session[pathKey];
  if (Array.isArray(path) && path.length > 0) {
    let idx = session[idxKey] || 0;

    // Zaten ulaşılmış veya geride kalmış ara düğümleri hızlıca geç
    while (idx < path.length) {
      const wp = path[idx];
      const dWp = Math.hypot(wp.x + 0.5 - myPos.x, wp.z + 0.5 - myPos.z);
      if (dWp < 0.85) {
        idx++;
        continue;
      }
      if (idx + 1 < path.length) {
        const nextWp = path[idx + 1];
        const dNext = Math.hypot(nextWp.x + 0.5 - myPos.x, nextWp.z + 0.5 - myPos.z);
        if (dNext < dWp && dNext < 1.35) {
          idx++;
          continue;
        }
      }
      break;
    }

    session[idxKey] = idx;

    if (idx < path.length) {
      const wp = path[idx];
      const dx = wp.x + 0.5 - myPos.x;
      const dz = wp.z + 0.5 - myPos.z;
      const targetYaw = Math.atan2(-dx, -dz);
      const dyStep = wp.y - myPos.y;

      const stepped = alignAndStepForward(bot, targetYaw, session, dyStep);
      if (!stepped) {
        session[pathKey] = null;
      }
      return 'walking';
    } else {
      session[pathKey] = null;
    }
  }

  // Eğer hedef çok yakındaysa (<= 3.8m) doğrudan hedefe dönerek güvenli adım at
  if (horizDist <= 3.8) {
    const dx = targetBlockPos.x + 0.5 - myPos.x;
    const dz = targetBlockPos.z + 0.5 - myPos.z;
    const targetYaw = Math.atan2(-dx, -dz);
    alignAndStepForward(bot, targetYaw, session, 0);
    return 'walking';
  }

  // Uzak hedefe A* yolu hiç bulunamadıysa
  bot.setControlState('forward', false);
  bot.setControlState('jump', false);
  return 'unreachable';
}

function findHarvestableCropsAroundBot(bot, radius = 4.2, session = null) {
  if (!bot || !bot.entity || !bot.entity.position) return [];
  const botPos = bot.entity.position;
  const eyePos = botPos.offset(0, 1.6, 0);
  const maxReach = Math.min(typeof radius === 'number' && radius > 0 ? radius : 4.2, 4.4);

  const r = Math.ceil(maxReach);
  const baseX = Math.floor(botPos.x);
  const baseY = Math.floor(botPos.y);
  const baseZ = Math.floor(botPos.z);
  const results = [];
  const now = Date.now();

  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const targetPos = new Vec3(baseX + dx, baseY + dy, baseZ + dz);
        const center = targetPos.offset(0.5, 0.5, 0.5);
        const dist = eyePos.distanceTo(center);
        if (dist > maxReach) continue;

        if (session && session.cropDigAttempts) {
          const key = `${targetPos.x},${targetPos.y},${targetPos.z}`;
          const lastAttempt = session.cropDigAttempts.get(key);
          if (lastAttempt && now - lastAttempt < 4000) continue;
        }

        const block = bot.blockAt(targetPos);
        if (!block || !block.name || block.name === 'air') continue;

        if (isCropHarvestable(bot, block)) {
          results.push({ block, dist });
        }
      }
    }
  }

  // En yakındakileri önce topla
  results.sort((a, b) => a.dist - b.dist);
  return results.map((item) => item.block);
}

function findNearestRipeCrop(bot, maxRadius = 64) {
  if (!bot || !bot.entity || !bot.entity.position) return null;
  const botPos = bot.entity.position;
  const eyePos = botPos.offset(0, 1.6, 0);
  const baseX = Math.floor(botPos.x);
  const baseY = Math.floor(botPos.y + 0.25);
  const baseZ = Math.floor(botPos.z);

  const limitR = Math.min(Math.max(Math.ceil(maxRadius), 16), 80);
  const dyList = [0, -1, 1, -2, 2, -3, 3];
  let nearest = null;
  let minDistance = Infinity;

  for (let r = 0; r <= limitR; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (const dy of dyList) {
          const targetPos = new Vec3(baseX + dx, baseY + dy, baseZ + dz);
          const block = bot.blockAt(targetPos);
          if (!block || !block.name || block.name === 'air') continue;
          if (isCropHarvestable(bot, block)) {
            const center = targetPos.offset(0.5, 0.5, 0.5);
            const d = eyePos.distanceTo(center);
            if (d < minDistance) {
              minDistance = d;
              nearest = block;
            }
          }
        }
      }
    }
    if (nearest && r >= 2) {
      return nearest;
    }
  }
  return nearest;
}

async function fastHarvestCrop(bot, session, targetBlock, accountId, acc) {
  if (!bot || !targetBlock || !session.autoFarm || session.status !== 'online') return false;
  if (isHarvestLimitPaused(session) || session.isHarvestPausedByLimit || session.isHarvestPausedByActionBar) return false;

  const blockName = (targetBlock.name || '').toLowerCase();
  const cropConf = CROP_HARVEST_CONFIG[blockName];
  if (!cropConf) return false;

  if (!session.cropDigAttempts) session.cropDigAttempts = new Map();
  const cropPosKey = `${targetBlock.position.x},${targetBlock.position.y},${targetBlock.position.z}`;
  session.cropDigAttempts.set(cropPosKey, Date.now());
  if (session.cropDigAttempts.size > 200) {
    const cleanBefore = Date.now() - 6000;
    for (const [k, v] of session.cropDigAttempts.entries()) {
      if (v < cleanBefore) session.cropDigAttempts.delete(k);
    }
  }

  // 1. Alet Durumu ve Tamir Kontrolü (Kazmaya başlamadan önce)
  if (checkNeedsRepair(bot, session, accountId)) {
    const repaired = await executeAutoRepairRoutine(bot, session, accountId);
    if (repaired) return false;
  }

  if (isHarvestLimitPaused(session)) return false;

  // 2. Anlık Kırma Paketleri (Buğday, Havuç, Patates 0 hardness'tır, anında kırılır)
  const cropPos = targetBlock.position.clone();
  const face = 1; // Üst yüzey
  bot._sctSequence = ((bot._sctSequence || 0) + 1) & 0x7FFFFFFF;
  const seq = bot._sctSequence;

  const myPos = bot.entity.position;
  const dx = targetBlock.position.x + 0.5 - myPos.x;
  const dz = targetBlock.position.z + 0.5 - myPos.z;
  const targetYaw = Math.atan2(-dx, -dz);
  smoothHumanLook(bot, targetYaw, 0.35);

  try {
    bot._client.write('block_dig', {
      status: 0,
      location: targetBlock.position,
      face: face,
      sequence: seq
    });
    bot.swingArm('right');

    bot._client.write('block_dig', {
      status: 2,
      location: targetBlock.position,
      face: face,
      sequence: seq
    });
  } catch (err) {
    return false;
  }

  if (isHarvestLimitPaused(session)) return false;

  session.stats.cropsHarvested = (session.stats.cropsHarvested || 0) + 1;
  if (session.stats.cropsHarvested % 15 === 0 || session.stats.cropsHarvested === 1) {
    addLog(
      accountId,
      'OTO-HASAT',
      `🌾 Hasat toplandı: ${targetBlock.displayName || targetBlock.name} (Toplam: ${session.stats.cropsHarvested})`,
      chalk.green
    );
  }
  broadcastState();

  // 3. Otomatik Yeniden Ekiş (Auto-Replant)
  const autoReplant = acc ? (acc.autoReplant !== false) : true;
  if (autoReplant && session.autoFarm && !isHarvestLimitPaused(session) && session.status === 'online') {
    await new Promise((r) => setTimeout(r, 35));
    if (!session.autoFarm || isHarvestLimitPaused(session) || session.status !== 'online') return true;

    const soilBlock = bot.blockAt(cropPos.offset(0, -1, 0));
    if (soilBlock && cropConf.soil.includes(soilBlock.name.toLowerCase())) {
      const seedItem = bot.inventory ? bot.inventory.items().find((i) => cropConf.seeds.includes(i.name.toLowerCase())) : null;
      if (seedItem) {
        try {
          await bot.equip(seedItem, 'hand');
          if (typeof bot._genericPlace === 'function') {
            await bot._genericPlace(soilBlock, new Vec3(0, 1, 0), { swingArm: 'right', forceLook: 'ignore' });
          } else if (typeof bot._placeBlockWithOptions === 'function') {
            await bot._placeBlockWithOptions(soilBlock, new Vec3(0, 1, 0), { swingArm: 'right', forceLook: 'ignore' });
          } else {
            await bot.placeBlock(soilBlock, new Vec3(0, 1, 0));
          }
        } catch (plantErr) {}
      }
    }
  }

  return true;
}

function startAutoFarmLoop(accountId) {
  const session = getOrCreateSession(accountId);
  if (session.farmTimer) {
    clearTimeout(session.farmTimer);
    session.farmTimer = null;
  }
  if (!session.autoFarm) return;

  session.farmLoopId = (session.farmLoopId || 0) + 1;
  const thisLoopId = session.farmLoopId;
  session.farmCurrentPath = null;
  session.farmTargetCropPos = null;

  const step = async () => {
    session.farmTimer = null;

    // GÜVENLİK FRENİ: Özellik kapatıldıysa veya oturum sonlandıysa HAREKETİ DERHAL KES VE ÇIK!
    if (!session.autoFarm || session.farmLoopId !== thisLoopId || !session.bot || session.status !== 'online') {
      if (session.bot) {
        try {
          session.bot.setControlState('forward', false);
          session.bot.setControlState('back', false);
          session.bot.setControlState('left', false);
          session.bot.setControlState('right', false);
          session.bot.setControlState('jump', false);
          session.bot.setControlState('sprint', false);
          if (typeof session.bot.clearControlStates === 'function') {
            session.bot.clearControlStates();
          }
        } catch (e) {}
      }
      return;
    }

    const bot = session.bot;

    // Hasat limiti veya Action Bar yenilenme beklemesi (Görsel 1 & 2)
    if (isHarvestLimitPaused(session)) {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
        if (typeof bot.clearControlStates === 'function') bot.clearControlStates();
      } catch (e) {}
      session.farmTimer = setTimeout(step, 1000);
      return;
    }

    // Bekleme gerektiren durumlar (Giriş süreci, Captcha, Sandık aktarma, Tamir)
    if (
      session.isDropping ||
      session.isDepositing ||
      session.isSolvingCaptcha ||
      session.isRepairing ||
      bot.currentWindow
    ) {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
      } catch (e) {}
      session.farmTimer = setTimeout(step, 500);
      return;
    }

    const acc = config.accounts.find((a) => a.id === accountId);

    // Ada kenarı eğilme (sneak) koruması: Boşluğa düşmeyi fiziksel olarak engeller
    if (isNearIslandEdge(bot)) {
      bot.setControlState('sneak', true);
    } else if (!session.sneakLock) {
      bot.setControlState('sneak', false);
    }

    // Aydınlatma veya 1 blok yüksekteki engelden tarlaya geri in
    if (checkAndDescendFromFarmObstacle(bot, session)) {
      session.farmTimer = setTimeout(step, 280);
      return;
    }

    // 1. ENVANTER DOLULUK KONTROLÜ VE /sat hepsi SATIŞI
    const autoSell = acc ? (acc.autoSellEnabled !== false) : true;
    if (autoSell && isBotInventoryFull(bot)) {
      const now = Date.now();
      if (!session.lastAutoSellTime || now - session.lastAutoSellTime > 3000) {
        session.lastAutoSellTime = now;
        const sellCmd = (acc && acc.autoSellCommand) ? acc.autoSellCommand.trim() : '/sat hepsi';
        addLog(
          accountId,
          'OTO-SATIŞ',
          `💰 Envanter doldu! Satış yapılıyor: "${sellCmd}"`,
          chalk.greenBright
        );
        sendChatSafely(accountId, sellCmd);
        await new Promise((r) => setTimeout(r, 400));
        if (!session.autoFarm || session.farmLoopId !== thisLoopId || session.status !== 'online') {
          try {
            bot.setControlState('forward', false);
            bot.setControlState('jump', false);
          } catch (e) {}
          return;
        }
      }
    }

    // 2. MENZİLDEKİ OLGUN EKİNLERİ (YALNIZCA BUĞDAY, HAVUÇ, PATATES) ÇOK HIZLI KIR
    const farmRadius = acc && typeof acc.farmRadius === 'number' ? acc.farmRadius : 4.2;
    const immediateCrops = findHarvestableCropsAroundBot(bot, farmRadius, session);

    if (immediateCrops.length > 0) {
      const batch = immediateCrops.slice(0, 4);
      for (const crop of batch) {
        if (!session.autoFarm || session.farmLoopId !== thisLoopId || session.status !== 'online') break;
        if (isHarvestLimitPaused(session)) break;
        const harvested = await fastHarvestCrop(bot, session, crop, accountId, acc);
        if (!harvested || isHarvestLimitPaused(session)) break;
        await new Promise((r) => setTimeout(r, 30));
      }
    }

    // Kullanıcı butona basıp kapattıysa veya hasat limiti dolduysa ara işlemde derhal dur
    if (!session.autoFarm || session.farmLoopId !== thisLoopId || session.status !== 'online') {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
        if (typeof bot.clearControlStates === 'function') bot.clearControlStates();
      } catch (e) {}
      return;
    }

    if (isHarvestLimitPaused(session)) {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
        if (typeof bot.clearControlStates === 'function') bot.clearControlStates();
      } catch (e) {}
      session.farmTimer = setTimeout(step, 1000);
      return;
    }

    // 3. ENGEL TANIMA VE AKILLI YOL BULUCU (A* PATHFINDER İLE YÜRÜYÜŞ)
    const shouldWalk = acc ? (acc.farmWalk !== false) : true;
    let nextDelay = 60;

    if (shouldWalk) {
      // Hedef ekin geçerliliğini koruyor mu?
      let targetCrop = null;
      if (session.farmTargetCropPos) {
        const curBlock = bot.blockAt(session.farmTargetCropPos);
        if (curBlock && isCropHarvestable(bot, curBlock)) {
          targetCrop = curBlock;
        } else {
          session.farmTargetCropPos = null;
          session.farmCurrentPath = null;
        }
      }

      // Yeni hedef buğday/havuç/patates/pancar bul
      if (!targetCrop) {
        targetCrop = findNearestRipeCrop(bot, 64);
        if (targetCrop) {
          session.farmTargetCropPos = targetCrop.position.clone();
          session.farmCurrentPath = null;
          session.farmPathIndex = 0;
        } else {
          session.farmTargetCropPos = null;
          session.farmCurrentPath = null;
        }
      }

      if (targetCrop) {
        const navRes = stepFarmWalkTowardsTarget(
          bot,
          session,
          targetCrop.position,
          'farm',
          Math.min(farmRadius, 3.85),
          Math.min(farmRadius, 3.65),
          0.5
        );
        if (navRes === 'reached') {
          nextDelay = 40;
        } else if (navRes === 'unreachable') {
          if (!session.cropDigAttempts) session.cropDigAttempts = new Map();
          session.cropDigAttempts.set(
            `${targetCrop.position.x},${targetCrop.position.y},${targetCrop.position.z}`,
            Date.now()
          );
          session.farmTargetCropPos = null;
          session.farmCurrentPath = null;
          nextDelay = 60;
        } else {
          nextDelay = 55;
        }
      } else {
        // Tarlada hiç olgun buğday, havuç veya patates kalmadı
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
        nextDelay = 1200;
      }
    } else {
      nextDelay = immediateCrops.length > 0 ? 60 : 1200;
    }

    if (session.autoFarm && session.farmLoopId === thisLoopId && session.status === 'online') {
      session.farmTimer = setTimeout(step, nextDelay);
    } else {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
        if (typeof bot.clearControlStates === 'function') bot.clearControlStates();
      } catch (e) {}
    }
  };

  session.farmTimer = setTimeout(step, 80);
}

function stopAutoFarmLoop(accountId) {
  const session = getOrCreateSession(accountId);
  session.autoFarm = false;
  session.isFarmingCrop = false;
  const now = Date.now();
  if (!session.chatLimitPausedUntil || session.chatLimitPausedUntil <= now) {
    session.harvestLimitPausedUntil = 0;
    session.chatLimitPausedUntil = 0;
    session.isHarvestPausedByLimit = false;
  }
  if (!session.actionBarPausedUntil || session.actionBarPausedUntil <= now) {
    session.actionBarPausedUntil = 0;
    session.isHarvestPausedByActionBar = false;
  }
  if (session.harvestLimitResumeTimer && (!session.chatLimitPausedUntil || session.chatLimitPausedUntil <= now)) {
    clearTimeout(session.harvestLimitResumeTimer);
    session.harvestLimitResumeTimer = null;
  }
  if (session.actionBarResumeTimer && (!session.actionBarPausedUntil || session.actionBarPausedUntil <= now)) {
    clearTimeout(session.actionBarResumeTimer);
    session.actionBarResumeTimer = null;
  }
  session.farmLoopId = (session.farmLoopId || 0) + 1; // İn-flight adımları derhal iptal et
  session.farmCurrentPath = null;
  session.farmTargetCropPos = null;
  if (session.farmTimer) {
    clearTimeout(session.farmTimer);
    session.farmTimer = null;
  }
  if (session.bot) {
    try {
      session.bot.setControlState('forward', false);
      session.bot.setControlState('back', false);
      session.bot.setControlState('left', false);
      session.bot.setControlState('right', false);
      session.bot.setControlState('jump', false);
      session.bot.setControlState('sprint', false);
      session.bot.setControlState('sneak', session.sneakLock || false);
      if (typeof session.bot.clearControlStates === 'function') {
        session.bot.clearControlStates();
      }
    } catch (e) {}
  }
}

// --- 5.5. OTOMATİK TARLA ÇAPALAMA SİSTEMİ (AUTO-TILL: SATIR SATIR ÇAPALAMA) ---
// Bot etrafındaki toprak bloklarını elindeki çapayı kullanarak sağ tık ile çapalar.
// Çapaladığı tarlaya (farmland) kesinlikle tekrar basmaz! Satır satır (line line) çalışır.

const HOE_NAMES = [
  'netherite_hoe',
  'diamond_hoe',
  'iron_hoe',
  'golden_hoe',
  'stone_hoe',
  'wooden_hoe'
];

function getHoeItem(bot) {
  if (!bot || !bot.inventory) return null;
  return bot.inventory.items().find((item) => HOE_NAMES.includes(item.name.toLowerCase()));
}

const TILLABLE_DIRT_NAMES = new Set([
  'dirt',
  'grass_block',
  'grass',
  'coarse_dirt',
  'rooted_dirt',
  'dirt_path',
  'grass_path'
]);

const CLEARABLE_WEED_ABOVE_DIRT = new Set([
  'short_grass',
  'tall_grass',
  'grass',
  'fern',
  'large_fern',
  'dead_bush',
  'dandelion',
  'poppy',
  'blue_orchid',
  'allium',
  'azure_bluet',
  'red_tulip',
  'orange_tulip',
  'white_tulip',
  'pink_tulip',
  'oxeye_daisy',
  'cornflower',
  'lily_of_the_valley'
]);

function isTillableDirt(block) {
  if (!block || !block.name) return false;
  return TILLABLE_DIRT_NAMES.has(block.name.toLowerCase());
}

function canBlockBeTilled(bot, block) {
  if (!isTillableDirt(block)) return false;
  const above = bot.blockAt(block.position.offset(0, 1, 0));
  if (!above || !above.name) return false;
  const aboveName = above.name.toLowerCase();
  if (aboveName === 'air' || aboveName === 'cave_air' || aboveName === 'void_air') {
    return true;
  }
  return CLEARABLE_WEED_ABOVE_DIRT.has(aboveName);
}

/**
 * Aktif tarla / inşa sınırlarını (boundingBox) tespit eder.
 * Böylece bot sadece kendi tarla alanındaki toprakları ve tarlaları işler; adadaki rastgele
 * uzak çim bloklarına doğru takıla takıla yürümez!
 */
function getFarmBounds(session) {
  if (!session) return null;
  const b = session.builder;
  const bPos1 = (b && b.corners && b.corners.pos1) ? b.corners.pos1 : (b && b.pos1 ? b.pos1 : null);
  const bPos2 = (b && b.corners && b.corners.pos2) ? b.corners.pos2 : (b && b.pos2 ? b.pos2 : null);
  if (bPos1 && bPos2 && (bPos1.x !== 0 || bPos1.z !== 0 || bPos2.x !== 0 || bPos2.z !== 0)) {
    return {
      minX: Math.min(bPos1.x, bPos2.x) - 1,
      maxX: Math.max(bPos1.x, bPos2.x) + 1,
      minY: Math.min(bPos1.y, bPos2.y) - 2,
      maxY: Math.max(bPos1.y, bPos2.y) + 3,
      minZ: Math.min(bPos1.z, bPos2.z) - 1,
      maxZ: Math.max(bPos1.z, bPos2.z) + 1
    };
  }
  if (b && b.origin && (b.width > 0 || b.length > 0)) {
    const w = b.width || 32;
    const l = b.length || 32;
    const h = b.height || 6;
    return {
      minX: Math.min(b.origin.x, b.origin.x + w) - 2,
      maxX: Math.max(b.origin.x, b.origin.x + w) + 2,
      minY: b.origin.y - 2,
      maxY: b.origin.y + h + 3,
      minZ: Math.min(b.origin.z, b.origin.z + l) - 2,
      maxZ: Math.max(b.origin.z, b.origin.z + l) + 2
    };
  }
  if (typeof config !== 'undefined' && config && config.builderSharedCoords) {
    const sc = config.builderSharedCoords;
    const scPos1 = (sc.corners && sc.corners.pos1) ? sc.corners.pos1 : (sc.pos1 ? sc.pos1 : null);
    const scPos2 = (sc.corners && sc.corners.pos2) ? sc.corners.pos2 : (sc.pos2 ? sc.pos2 : null);
    if (scPos1 && scPos2 && (scPos1.x !== 0 || scPos1.z !== 0 || scPos2.x !== 0 || scPos2.z !== 0)) {
      return {
        minX: Math.min(scPos1.x, scPos2.x) - 1,
        maxX: Math.max(scPos1.x, scPos2.x) + 1,
        minY: Math.min(scPos1.y, scPos2.y) - 2,
        maxY: Math.max(scPos1.y, scPos2.y) + 3,
        minZ: Math.min(scPos1.z, scPos2.z) - 1,
        maxZ: Math.max(scPos1.z, scPos2.z) + 1
      };
    }
    const o = sc.origin;
    if (o && (o.x !== 0 || o.z !== 0)) {
      const w = sc.width || 32;
      const l = sc.length || 32;
      const h = sc.height || 6;
      return {
        minX: Math.min(o.x, o.x + w) - 2,
        maxX: Math.max(o.x, o.x + w) + 2,
        minY: o.y - 2,
        maxY: o.y + h + 3,
        minZ: Math.min(o.z, o.z + l) - 2,
        maxZ: Math.max(o.z, o.z + l) + 2
      };
    }
  }
  return null;
}

function isPosInsideFarmBounds(pos, bounds) {
  if (!bounds || !pos) return true;
  return (
    pos.x >= bounds.minX && pos.x <= bounds.maxX &&
    pos.y >= bounds.minY && pos.y <= bounds.maxY &&
    pos.z >= bounds.minZ && pos.z <= bounds.maxZ
  );
}

/**
 * Geniş ada/tarla katmanlarını (96-112 blok yarıçapa kadar) yeraltı topraklarına veya
 * ekilmiş tarlalara takılmadan (bot.findBlocks 3500 limitine çarpmadan) doğrudan halka halka tarar.
 */
function scanFarmLayerBlocksAround(bot, maxRadius = 112, session = null, refFloorY = null, blacklist = null, startPos = null, matchFn) {
  if (!bot || !bot.entity || !bot.entity.position || typeof matchFn !== 'function') return [];
  const farmBounds = getFarmBounds(session);
  const botPos = bot.entity.position;
  const baseX = Math.floor(botPos.x);
  const footY = Math.floor(botPos.y + 0.25);
  const botFloorY = footY - 1;
  const baseZ = Math.floor(botPos.z);

  const yLevelSet = new Set();
  const effectiveFarmY = (typeof refFloorY === 'number' && !Number.isNaN(refFloorY))
    ? refFloorY
    : (session && typeof session.tillFarmY === 'number')
      ? session.tillFarmY
      : (session && typeof session.plantFarmY === 'number')
        ? session.plantFarmY
        : null;

  if (effectiveFarmY !== null) {
    for (const dy of [0, -1, 1]) {
      yLevelSet.add(effectiveFarmY + dy);
    }
  } else {
    for (const dy of [0, -1, 1, -2, 2]) {
      yLevelSet.add(botFloorY + dy);
    }
  }
  const allYLevels = Array.from(yLevelSet);

  const results = [];
  const seenKeys = new Set();
  const limitR = farmBounds ? 64 : Math.min(Math.max(Math.ceil(maxRadius), 48), 64);
  let firstHitRing = -1;

  const scanCenterRings = (centerX, centerZ, maxRing) => {
    for (let r = 0; r <= maxRing; r++) {
      const yList = allYLevels;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = centerX + dx;
          const z = centerZ + dz;
          if (farmBounds && (x < farmBounds.minX || x > farmBounds.maxX || z < farmBounds.minZ || z > farmBounds.maxZ)) continue;
          for (let yi = 0; yi < yList.length; yi++) {
            const y = yList[yi];
            if (farmBounds && (y < farmBounds.minY || y > farmBounds.maxY)) continue;
            const key = `${x},${y},${z}`;
            if (seenKeys.has(key)) continue;
            if (blacklist && (blacklist.has(key) || blacklist.has(`(${x}, ${y}, ${z})`))) continue;
            const targetPos = new Vec3(x, y, z);
            const block = bot.blockAt(targetPos);
            if (block && matchFn(bot, block)) {
              seenKeys.add(key);
              results.push(block);
              if (firstHitRing === -1) firstHitRing = r;
            }
          }
        }
      }
      // Yeterince yakın hedef bulunduğunda tüm tarla katmanını gereksiz taramamak için erken çık
      if (results.length >= 80 && firstHitRing !== -1 && r >= firstHitRing + 4 && r >= 10) {
        break;
      }
    }
  };

  scanCenterRings(baseX, baseZ, limitR);

  // Eğer bot başlangıç noktasından çok uzaklaştıysa ve kendi çevresinde blok kalmadıysa,
  // başlangıç konumu etrafındaki uzak köşeleri de tara
  if (results.length === 0 && startPos) {
    const sx = Math.floor(startPos.x);
    const sz = Math.floor(startPos.z);
    if (Math.hypot(sx - baseX, sz - baseZ) > 16) {
      scanCenterRings(sx, sz, limitR);
    }
  }

  // Aynı katmandaki (Y seviyesi yakın) ve bota en yakın blokları öncele
  results.sort((a, b) => {
    const aSameLayer = Math.abs(a.position.y - botFloorY) <= 1 ? 0 : 1;
    const bSameLayer = Math.abs(b.position.y - botFloorY) <= 1 ? 0 : 1;
    if (aSameLayer !== bSameLayer) return aSameLayer - bSameLayer;
    return (
      botPos.distanceTo(a.position.offset(0.5, 0.5, 0.5)) -
      botPos.distanceTo(b.position.offset(0.5, 0.5, 0.5))
    );
  });

  return results;
}

/**
 * Adadaki tüm sandık, tuzaklı sandık, varil ve shulker kutularını hem doğrudan katman taramasıyla
 * hem de chunk aramasıyla bulup hafızaya (session.farmKnownChests) kaydeder.
 */
function discoverFarmChests(bot, session, maxRadius = 88) {
  if (!bot || !bot.entity || !bot.entity.position || !session) return [];
  if (!session.farmKnownChests) session.farmKnownChests = new Map();
  if (!session.emptyFarmChests) session.emptyFarmChests = new Map();

  const botPos = bot.entity.position;
  const baseX = Math.floor(botPos.x);
  const botFloorY = Math.floor(botPos.y + 0.25) - 1;
  const baseZ = Math.floor(botPos.z);

  const addChestPos = (p) => {
    if (!p) return;
    const pos = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const key = `${pos.x},${pos.y},${pos.z}`;
    session.farmKnownChests.set(key, pos);
  };

  // 1. Doğrudan katman taraması (r = 0..48, dy = -4..+5): bot.findBlocks kaçırsa bile %100 yakalar
  const directR = Math.min(Math.ceil(maxRadius), 48);
  for (let dx = -directR; dx <= directR; dx++) {
    for (let dz = -directR; dz <= directR; dz++) {
      for (let dy = -4; dy <= 5; dy++) {
        const checkPos = new Vec3(baseX + dx, botFloorY + dy, baseZ + dz);
        const blk = bot.blockAt(checkPos);
        if (blk && blk.name && isFarmContainerBlockName(blk.name)) {
          addChestPos(checkPos);
        }
      }
    }
  }

  // Başlangıç noktasının (plantStartPos / tillStartPos) etrafını da doğrudan tara
  const refStart = session.plantStartPos || session.tillStartPos;
  if (refStart && Math.hypot(refStart.x - botPos.x, refStart.z - botPos.z) > 12) {
    const sx = Math.floor(refStart.x);
    const sy = Math.floor(refStart.y);
    const sz = Math.floor(refStart.z);
    for (let dx = -24; dx <= 24; dx++) {
      for (let dz = -24; dz <= 24; dz++) {
        for (let dy = -4; dy <= 5; dy++) {
          const checkPos = new Vec3(sx + dx, sy + dy, sz + dz);
          const blk = bot.blockAt(checkPos);
          if (blk && blk.name && isFarmContainerBlockName(blk.name)) {
            addChestPos(checkPos);
          }
        }
      }
    }
  }

  // 2. Geniş ada taraması (bot.findBlocks ile 88 blok yarıçap)
  if (typeof bot.findBlocks === 'function') {
    try {
      const found = bot.findBlocks({
        matching: (blk) => blk && blk.name && isFarmContainerBlockName(blk.name),
        maxDistance: Math.min(Math.ceil(maxRadius), 96),
        count: 128
      });
      for (const p of found) {
        addChestPos(p);
      }
    } catch (e) {}
  }

  // Hafızadaki sandıklardan hala dünyada var olanları filtrele ve bota yakınlığına göre sırala
  const validChests = [];
  for (const [key, pos] of session.farmKnownChests.entries()) {
    const blk = bot.blockAt(pos);
    if (blk && blk.name && isFarmContainerBlockName(blk.name)) {
      validChests.push(pos);
    } else if (blk && (blk.name === 'air' || blk.name === 'cave_air' || blk.name === 'void_air')) {
      session.farmKnownChests.delete(key);
    }
  }

  validChests.sort((a, b) => {
    const aSameLayer = Math.abs(a.y - botFloorY) <= 3 ? 0 : 1;
    const bSameLayer = Math.abs(b.y - botFloorY) <= 3 ? 0 : 1;
    if (aSameLayer !== bSameLayer) return aSameLayer - bSameLayer;
    return botPos.distanceTo(a.offset(0.5, 0.5, 0.5)) - botPos.distanceTo(b.offset(0.5, 0.5, 0.5));
  });

  return validChests;
}

/**
 * Oto-Ekim (tohum) ve Oto-Çapalama (çapa) için adadaki tüm sandıkları tek tek dolaşarak
 * malzeme çeken akıllı sandık tazeleme yöneticisi.
 * Dönüş değerleri: 'restocked' | 'walking' | 'next_chest' | 'no_chests' | 'all_empty'
 */
async function stepFarmChestRestock(
  bot,
  session,
  accountId,
  wantedItemNames,
  logTag,
  itemLabel,
  maxWithdrawCount = 256
) {
  if (!bot || !bot.entity || !bot.entity.position || !session) return 'no_chests';

  const allChests = discoverFarmChests(bot, session, 88);
  if (allChests.length === 0) {
    bot.setControlState('forward', false);
    bot.setControlState('jump', false);
    const now = Date.now();
    if (!session.lastNoFarmChestLog || now - session.lastNoFarmChestLog > 4000) {
      session.lastNoFarmChestLog = now;
      addLog(
        accountId,
        logTag,
        `⚠️ ${itemLabel} bitti! Adada (88 blok yarıçapta) hiçbir sandık/varil algılanamadı. Lütfen tarla katmanına ${itemLabel} dolu bir sandık koyun.`,
        chalk.redBright
      );
    }
    return 'no_chests';
  }

  const now = Date.now();
  if (!session.emptyFarmChests) session.emptyFarmChests = new Map();

  // Son 16 saniye içinde boş olduğu görülen sandıkları geçici olarak atla ki diğer sandıklara baksın
  let availableChests = allChests.filter((pos) => {
    const key = `${pos.x},${pos.y},${pos.z}`;
    const lastEmpty = session.emptyFarmChests.get(key) || 0;
    return now - lastEmpty > 16000;
  });

  // Eğer tüm sandıklar kontrol edilip boş çıktıysa, 10 saniye sonra listeyi sıfırla ve tekrar kontrol et
  if (availableChests.length === 0) {
    bot.setControlState('forward', false);
    bot.setControlState('jump', false);
    if (!session.lastAllFarmChestsEmptyLog || now - session.lastAllFarmChestsEmptyLog > 4500) {
      session.lastAllFarmChestsEmptyLog = now;
      addLog(
        accountId,
        logTag,
        `⚠️ Adadaki ${allChests.length} sandık kontrol edildi ancak içinde ${itemLabel} bulunamadı! Sandıklara ${itemLabel} eklenmesi bekleniyor...`,
        chalk.yellowBright
      );
    }
    return 'all_empty';
  }

  const targetChestPos = availableChests[0];
  const chestKey = `${targetChestPos.x},${targetChestPos.y},${targetChestPos.z}`;
  const myPos = bot.entity.position;
  const eyePos = myPos.offset(0, bot.entity.height || 1.62, 0);
  const chestCenter = targetChestPos.offset(0.5, 0.5, 0.5);
  const eyeDist = eyePos.distanceTo(chestCenter);
  const horizDist = Math.hypot(targetChestPos.x + 0.5 - myPos.x, targetChestPos.z + 0.5 - myPos.z);

  // 1. Sandık henüz uzanma mesafesinde değilse (> 3.75m), doğrudan sandığın yanına yürü
  if (eyeDist > 3.75 || horizDist > 3.45) {
    const navRes = stepFarmWalkTowardsTarget(
      bot,
      session,
      targetChestPos,
      'farmChest',
      3.65,
      3.35,
      0.5
    );
    if (navRes === 'unreachable') {
      session.emptyFarmChests.set(chestKey, now);
      session.farmChestCurrentPath = null;
      return 'next_chest';
    }
    return 'walking';
  }

  // 2. Sandığın yanına ulaşıldı! Hareketi durdur ve sandığı aç
  bot.setControlState('forward', false);
  bot.setControlState('jump', false);
  bot.setControlState('sprint', false);
  session.farmChestCurrentPath = null;

  const chestBlock = bot.blockAt(targetChestPos);
  if (!chestBlock || !isFarmContainerBlockName(chestBlock.name)) {
    session.emptyFarmChests.set(chestKey, now);
    return 'next_chest';
  }

  const wantedSet = new Set(wantedItemNames.map((n) => n.toLowerCase()));
  let totalWithdrawn = 0;
  let opened = null;

  try {
    opened = await safelyOpenContainer(bot, chestBlock, session);
    const container = opened.container;

    for (let slot = 0; slot < container.inventoryStart; slot++) {
      if (isBotInventoryFull(bot)) break;
      const slotItem = container.slots[slot];
      if (!slotItem || !slotItem.name) continue;
      if (!wantedSet.has(slotItem.name.toLowerCase())) continue;

      const countBefore = slotItem.count;
      try {
        await bot.clickWindow(slot, 0, 1);
        await new Promise((r) => setTimeout(r, 95));
        const afterSlot = container.slots[slot];
        const moved = !afterSlot ? countBefore : Math.max(0, countBefore - afterSlot.count);
        if (moved > 0) {
          totalWithdrawn += moved;
        } else if (typeof container.withdraw === 'function') {
          await container.withdraw(slotItem.type, null, countBefore);
          totalWithdrawn += countBefore;
          await new Promise((r) => setTimeout(r, 80));
        }
        if (totalWithdrawn >= maxWithdrawCount) break;
      } catch (clickErr) {
        try {
          if (typeof container.withdraw === 'function') {
            await container.withdraw(slotItem.type, null, countBefore);
            totalWithdrawn += countBefore;
          }
        } catch (e2) {}
        if (totalWithdrawn >= maxWithdrawCount) break;
      }
    }

    try {
      container.close();
    } catch (e) {}
  } catch (openErr) {
    // Sandık açılamadıysa (üzerinde tam blok varsa veya kilitliyse) bu sandığı geçici olarak atla
    session.emptyFarmChests.set(chestKey, now);
    return 'next_chest';
  } finally {
    if (opened && opened.hadSneakLock && session.bot && session.status === 'online') {
      try {
        session.bot.setControlState('sneak', true);
      } catch (e) {}
    }
  }

  if (totalWithdrawn > 0) {
    session.emptyFarmChests.delete(chestKey);
    addLog(
      accountId,
      logTag,
      `📦 Sandıktan [${targetChestPos.x}, ${targetChestPos.y}, ${targetChestPos.z}] ${totalWithdrawn} adet ${itemLabel} alındı! İşleme devam ediliyor...`,
      chalk.greenBright
    );
    return 'restocked';
  }

  // Bu sandıkta aranan eşya yok; boş olarak işaretle ve hemen sıradaki sandığa geç!
  session.emptyFarmChests.set(chestKey, now);
  if (availableChests.length > 1) {
    addLog(
      accountId,
      logTag,
      `📦 Sandıkta [${targetChestPos.x}, ${targetChestPos.y}, ${targetChestPos.z}] ${itemLabel} bulunamadı, sıradaki sandığa geçiliyor (${availableChests.length - 1} sandık kaldı)...`,
      chalk.cyan
    );
  }
  return 'next_chest';
}

function findTillableDirtAround(bot, maxRadius = 112, session = null) {
  const blacklist = session && session.tillBlacklist ? session.tillBlacklist : null;
  const refFloorY = session && typeof session.tillFarmY === 'number' ? session.tillFarmY : null;
  const startPos = session && session.tillStartPos ? session.tillStartPos : null;
  return scanFarmLayerBlocksAround(
    bot,
    maxRadius,
    session,
    refFloorY,
    blacklist,
    startPos,
    canBlockBeTilled
  );
}

async function tillDirtBlock(bot, session, targetBlock, accountId) {
  if (!bot || !targetBlock || !session.autoTill || session.status !== 'online') return false;

  const hoe = getHoeItem(bot);
  if (!hoe && (!bot.heldItem || !HOE_NAMES.includes(bot.heldItem.name.toLowerCase()))) {
    return false;
  }

  if (!bot.heldItem || !HOE_NAMES.includes(bot.heldItem.name.toLowerCase())) {
    try {
      await bot.equip(hoe, 'hand');
    } catch (e) {}
  }

  const posKey = `${targetBlock.position.x},${targetBlock.position.y},${targetBlock.position.z}`;
  if (!session.tillAttemptCounts) session.tillAttemptCounts = new Map();

  // Üstteki ot/çiçek varsa önce kır
  const above = bot.blockAt(targetBlock.position.offset(0, 1, 0));
  if (above && above.name && CLEARABLE_WEED_ABOVE_DIRT.has(above.name.toLowerCase())) {
    try {
      const face = 1;
      bot._sctSequence = ((bot._sctSequence || 0) + 1) & 0x7FFFFFFF;
      const seq = bot._sctSequence;
      bot._client.write('block_dig', {
        status: 0,
        location: above.position,
        face: face,
        sequence: seq
      });
      bot.swingArm('right');
      bot._client.write('block_dig', {
        status: 2,
        location: above.position,
        face: face,
        sequence: seq
      });
      await new Promise((r) => setTimeout(r, 45));
    } catch (e) {}
  }

  const eyePos = bot.entity.position.offset(0, 1.62, 0);
  const topCenter = targetBlock.position.offset(0.5, 1.0, 0.5);
  const dx = topCenter.x - eyePos.x;
  const dy = topCenter.y - eyePos.y;
  const dz = topCenter.z - eyePos.z;
  const horizDist = Math.hypot(dx, dz);
  const targetYaw = Math.atan2(-dx, -dz);
  const targetPitch = Math.atan2(dy, horizDist);

  try {
    await bot.look(targetYaw, targetPitch, true);
  } catch (e) {
    smoothHumanLook(bot, targetYaw, targetPitch);
  }

  try {
    if (typeof bot._genericPlace === 'function') {
      await bot._genericPlace(targetBlock, new Vec3(0, 1, 0), { swingArm: 'right', forceLook: 'ignore' });
    } else if (typeof bot._placeBlockWithOptions === 'function') {
      await bot._placeBlockWithOptions(targetBlock, new Vec3(0, 1, 0), { swingArm: 'right', forceLook: 'ignore' });
    } else if (typeof bot.activateBlock === 'function') {
      await bot.activateBlock(targetBlock, new Vec3(0, 1, 0));
    } else {
      bot.activateItem();
      bot.swingArm('right');
    }
  } catch (err) {
    try {
      bot.swingArm('right');
      bot.activateItem();
    } catch (e) {}
  }

  await new Promise((r) => setTimeout(r, 85));

  const updatedBlock = bot.blockAt(targetBlock.position);
  const updatedName = updatedBlock && updatedBlock.name ? updatedBlock.name.toLowerCase() : '';
  const becameFarmland = updatedName === 'farmland';
  const convertedCoarse = (targetBlock.name === 'coarse_dirt' || targetBlock.name === 'rooted_dirt') && updatedName === 'dirt';

  if (becameFarmland || convertedCoarse) {
    session.tillAttemptCounts.delete(posKey);
    session.tillEmptyScanCount = 0;
    session.tillRetriedBlacklist = false;
    session.tillFarmY = targetBlock.position.y;
    if (becameFarmland) {
      session.stats.blocksTilled = (session.stats.blocksTilled || 0) + 1;
      if (session.stats.blocksTilled % 15 === 0 || session.stats.blocksTilled === 1) {
        addLog(
          accountId,
          'OTO-ÇAPALAMA',
          `🌱 Toprak çapalandı: [${targetBlock.position.x}, ${targetBlock.position.y}, ${targetBlock.position.z}] (Toplam: ${session.stats.blocksTilled})`,
          chalk.green
        );
      }
      broadcastState();
    }
    return true;
  }

  const attempts = (session.tillAttemptCounts.get(posKey) || 0) + 1;
  session.tillAttemptCounts.set(posKey, attempts);
  if (attempts >= 4) {
    if (!session.tillBlacklist) session.tillBlacklist = new Set();
    session.tillBlacklist.add(posKey);
    session.tillAttemptCounts.delete(posKey);
    if (session.tillTargetDirtPos) {
      const tStr = `${session.tillTargetDirtPos.x},${session.tillTargetDirtPos.y},${session.tillTargetDirtPos.z}`;
      if (tStr === posKey) {
        session.tillTargetDirtPos = null;
        session.tillCurrentPath = null;
      }
    }
  }
  return false;
}

function startAutoTillLoop(accountId) {
  const session = getOrCreateSession(accountId);
  if (session.tillTimer) {
    clearTimeout(session.tillTimer);
    session.tillTimer = null;
  }
  if (!session.autoTill) return;

  session.tillLoopId = (session.tillLoopId || 0) + 1;
  const thisLoopId = session.tillLoopId;
  session.tillCurrentPath = null;
  session.tillTargetDirtPos = null;
  session.tillTargetStuckCount = 0;
  session.tillLastTargetPosStr = null;
  session.tillBlacklist = new Set();
  session.tillAttemptCounts = new Map();
  session.tillEmptyScanCount = 0;
  session.tillRetriedBlacklist = false;
  session.farmKnownChests = new Map();
  session.emptyFarmChests = new Map();

  if (session.bot && session.bot.entity && session.bot.entity.position) {
    session.tillStartPos = session.bot.entity.position.clone();
    session.tillFarmY = Math.floor(session.bot.entity.position.y + 0.25) - 1;
    discoverFarmChests(session.bot, session, 88);
  }

  const step = async () => {
    session.tillTimer = null;

    // GÜVENLİK FRENİ: Özellik kapatıldıysa veya oturum sonlandıysa HAREKETİ DERHAL KES VE ÇIK!
    if (!session.autoTill || session.tillLoopId !== thisLoopId || !session.bot || session.status !== 'online') {
      if (session.bot) {
        try {
          session.bot.setControlState('forward', false);
          session.bot.setControlState('back', false);
          session.bot.setControlState('left', false);
          session.bot.setControlState('right', false);
          session.bot.setControlState('jump', false);
          session.bot.setControlState('sprint', false);
          session.bot.setControlState('sneak', session.sneakLock || false);
          if (typeof session.bot.clearControlStates === 'function') {
            session.bot.clearControlStates();
          }
        } catch (e) {}
      }
      return;
    }

    const bot = session.bot;

    // Ada kenarı eğilme (sneak) koruması: Boşluğa düşmeyi fiziksel olarak engeller
    if (isNearIslandEdge(bot)) {
      bot.setControlState('sneak', true);
    } else if (!session.sneakLock) {
      bot.setControlState('sneak', false);
    }

    // Aydınlatma bloğu üzerindeyse tarlaya geri in
    if (checkAndDescendFromFarmObstacle(bot, session)) {
      session.tillTimer = setTimeout(step, 280);
      return;
    }

    // Bekleme gerektiren durumlar (Giriş süreci, Captcha, Sandık aktarma, Tamir)
    if (
      session.isDropping ||
      session.isDepositing ||
      session.isSolvingCaptcha ||
      session.isRepairing ||
      bot.currentWindow
    ) {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
      } catch (e) {}
      session.tillTimer = setTimeout(step, 500);
      return;
    }

    // Alet tamir kontrolü
    if (checkNeedsRepair(bot, session, accountId)) {
      const repaired = await executeAutoRepairRoutine(bot, session, accountId);
      if (repaired) {
        session.tillTimer = setTimeout(step, 500);
        return;
      }
    }

    // Çapa kontrolü (Envanterde çapa yoksa adadaki sandıklardan otomatik çapa çek!)
    const hoe = getHoeItem(bot);
    if (!hoe && (!bot.heldItem || !HOE_NAMES.includes(bot.heldItem.name.toLowerCase()))) {
      const chestRes = await stepFarmChestRestock(
        bot,
        session,
        accountId,
        HOE_NAMES,
        'OTO-ÇAPALAMA',
        'çapa',
        2
      );
      const waitMs =
        chestRes === 'walking' ? 55 :
        chestRes === 'next_chest' ? 150 :
        chestRes === 'restocked' ? 150 : 2500;
      session.tillTimer = setTimeout(step, waitMs);
      return;
    }

    if (hoe && (!bot.heldItem || !HOE_NAMES.includes(bot.heldItem.name.toLowerCase()))) {
      try {
        await bot.equip(hoe, 'hand');
      } catch (e) {}
    }

    // Etraftaki tüm çapalanabilir toprakları bul (tarla sınırları dahilinde)
    let tillableBlocks = findTillableDirtAround(bot, 64, session);

    // Eğer blacklist yüzünden blok kalmadıysa ve henüz tekrar denenmediyse blacklist'i temizleyip bir kez daha bak
    if (tillableBlocks.length === 0 && session.tillBlacklist && session.tillBlacklist.size > 0 && !session.tillRetriedBlacklist) {
      session.tillRetriedBlacklist = true;
      session.tillBlacklist.clear();
      if (session.tillAttemptCounts) session.tillAttemptCounts.clear();
      tillableBlocks = findTillableDirtAround(bot, 64, session);
    }

    // Etrafta hiç toprak kalmadıysa hareketi kes, 2 tarama doğrula ve derhal ekime geç!
    if (tillableBlocks.length === 0) {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
        bot.setControlState('sprint', false);
      } catch (e) {}
      session.tillEmptyScanCount = (session.tillEmptyScanCount || 0) + 1;
      if (session.tillEmptyScanCount < 2) {
        session.tillTimer = setTimeout(step, 250);
        return;
      }
      addLog(
        accountId,
        'OTO-ÇAPALAMA',
        `🎉 Tebrikler! Tarla alanındaki tüm topraklar başarıyla çapalandı (Toplam: ${session.stats.blocksTilled || 0} blok).`,
        chalk.greenBright
      );
      stopAutoTillLoop(accountId);

      const chainAcc = config.accounts.find((a) => a.id === accountId);
      const chainEnabled = session.builder
        ? session.builder.autoChainTillPlant !== false
        : !(chainAcc && chainAcc.autoChainTillPlant === false);
      if (chainEnabled) {
        if (session.autoMine) {
          stopAutoMineLoop(accountId);
          session.autoMine = false;
        }
        if (session.autoFarm) {
          stopAutoFarmLoop(accountId);
          session.autoFarm = false;
        }
        session.autoPlant = true;
        if (session.builder && session.builder.status === 'completed') {
          session.builder.statusMessage = `[OTO-EKİM AKTİF] İnşa ve Çapalama tamamlandı. Otomatik Ekim yapılıyor...`;
        }
        addLog(
          accountId,
          'OTO-ZİNCİR',
          '🔄 Çapalama tamamlandı! Kesintisiz olarak Otomatik Ekim aşamasına geçiliyor...',
          chalk.cyanBright
        );
        setTimeout(() => {
          const cur = sessions.get(accountId);
          if (cur && cur.status === 'online' && cur.autoPlant) {
            startAutoPlantLoop(accountId);
            broadcastState();
          }
        }, 120);
      }

      broadcastState();
      return;
    }

    session.tillEmptyScanCount = 0;

    const myPos = bot.entity.position;
    const eyePos = myPos.offset(0, 1.62, 0);

    // 1. GÖZ MENZİLİNDEKİ TOPRAKLARI (<= 3.85 BLOK) ÇAPALA
    const immediateBlocks = tillableBlocks.filter((b) => {
      const topCenter = b.position.offset(0.5, 1.0, 0.5);
      const eyeDist = eyePos.distanceTo(topCenter);
      const horizDist = Math.hypot(b.position.x + 0.5 - myPos.x, b.position.z + 0.5 - myPos.z);
      return eyeDist <= 3.85 && horizDist <= 3.65;
    });

    if (immediateBlocks.length > 0) {
      bot.setControlState('forward', false);
      bot.setControlState('jump', false);

      const batch = immediateBlocks.slice(0, 2);
      for (const block of batch) {
        if (!session.autoTill || session.tillLoopId !== thisLoopId || session.status !== 'online') break;
        const curB = bot.blockAt(block.position);
        if (curB && canBlockBeTilled(bot, curB)) {
          await tillDirtBlock(bot, session, curB, accountId);
        }
      }

      session.tillTimer = setTimeout(step, 50);
      return;
    }

    if (!session.autoTill || session.tillLoopId !== thisLoopId || session.status !== 'online') {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
        if (typeof bot.clearControlStates === 'function') bot.clearControlStates();
      } catch (e) {}
      return;
    }

    // 2. EN YAKIN ÇAPALANMAMIŞ TOPRAĞA DOĞRU YÜRÜ
    let targetDirt = null;
    if (session.tillTargetDirtPos) {
      const tKey = `${session.tillTargetDirtPos.x},${session.tillTargetDirtPos.y},${session.tillTargetDirtPos.z}`;
      const isBlacklisted = session.tillBlacklist && session.tillBlacklist.has(tKey);
      const curB = !isBlacklisted ? bot.blockAt(session.tillTargetDirtPos) : null;
      if (curB && canBlockBeTilled(bot, curB)) {
        targetDirt = curB;
      } else {
        session.tillTargetDirtPos = null;
        session.tillCurrentPath = null;
      }
    }

    if (!targetDirt) {
      if (tillableBlocks.length > 0) {
        targetDirt = tillableBlocks[0];
        session.tillTargetDirtPos = targetDirt.position.clone();
        session.tillCurrentPath = null;
        session.tillPathIndex = 0;
      } else {
        session.tillTargetDirtPos = null;
        session.tillCurrentPath = null;
      }
    }

    let nextDelay = 50;

    if (targetDirt) {
      const navRes = stepFarmWalkTowardsTarget(
        bot,
        session,
        targetDirt.position,
        'till',
        3.60,
        3.45,
        1.0
      );
      if (navRes === 'reached') {
        nextDelay = 35;
      } else if (navRes === 'unreachable') {
        const bKey = `${targetDirt.position.x},${targetDirt.position.y},${targetDirt.position.z}`;
        if (!session.tillBlacklist) session.tillBlacklist = new Set();
        session.tillBlacklist.add(bKey);
        session.tillTargetDirtPos = null;
        session.tillCurrentPath = null;
        nextDelay = 50;
      } else {
        nextDelay = 50;
      }
    } else {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
      } catch (e) {}
      nextDelay = 100;
    }

    if (session.autoTill && session.tillLoopId === thisLoopId && session.status === 'online') {
      session.tillTimer = setTimeout(step, nextDelay);
    } else {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
        if (typeof bot.clearControlStates === 'function') bot.clearControlStates();
      } catch (e) {}
    }
  };

  session.tillTimer = setTimeout(step, 60);
}

function stopAutoTillLoop(accountId) {
  const session = getOrCreateSession(accountId);
  session.autoTill = false;
  session.tillLoopId = (session.tillLoopId || 0) + 1;
  session.tillLines = null;
  session.tillCurrentPath = null;
  session.tillStandPos = null;
  session.tillTargetDirtPos = null;
  session.tillStartPos = null;
  session.tillBlacklist = null;
  session.tillAttemptCounts = null;
  session.tillEmptyScanCount = 0;
  session.tillRetriedBlacklist = false;
  session.tillTargetStuckCount = 0;
  session.tillLastTargetPosStr = null;
  if (session.tillTimer) {
    clearTimeout(session.tillTimer);
    session.tillTimer = null;
  }
  if (session.bot) {
    try {
      session.bot.setControlState('forward', false);
      session.bot.setControlState('back', false);
      session.bot.setControlState('left', false);
      session.bot.setControlState('right', false);
      session.bot.setControlState('jump', false);
      session.bot.setControlState('sprint', false);
      session.bot.setControlState('sneak', session.sneakLock || false);
      if (typeof session.bot.clearControlStates === 'function') {
        session.bot.clearControlStates();
      }
    } catch (e) {}
  }
}

// --- 5.4.5. OTOMATİK TARLA EKİMİ (AUTO-PLANT: YALNIZCA BOŞ TARLAYA EKİN EKME) ---
const PLANTABLE_SEED_NAMES = [
  'wheat_seeds',
  'seeds',
  'carrot',
  'carrots',
  'potato',
  'potatoes',
  'beetroot_seeds',
  'beetroot_seed',
  'melon_seeds',
  'pumpkin_seeds',
  'torchflower_seeds',
  'pitcher_pod'
];

function getSeedItem(bot) {
  if (!bot || !bot.inventory) return null;
  if (bot.heldItem && PLANTABLE_SEED_NAMES.includes(bot.heldItem.name.toLowerCase())) {
    return bot.heldItem;
  }
  return (
    bot.inventory.items().find((i) => PLANTABLE_SEED_NAMES.includes(i.name.toLowerCase())) || null
  );
}

function isPlantableFarmland(bot, block) {
  if (!block || !block.name) return false;
  if (block.name.toLowerCase() !== 'farmland') return false;
  const above = bot.blockAt(block.position.offset(0, 1, 0));
  if (!above) return false;
  const aboveName = above.name.toLowerCase();
  return aboveName === 'air' || aboveName === 'cave_air' || aboveName === 'void_air';
}

function findPlantableFarmlandAround(bot, maxRadius = 112, session = null) {
  const blacklist = session && session.plantBlacklist ? session.plantBlacklist : null;
  const refFloorY = session && typeof session.plantFarmY === 'number' ? session.plantFarmY : null;
  const startPos = session && session.plantStartPos ? session.plantStartPos : null;
  return scanFarmLayerBlocksAround(
    bot,
    maxRadius,
    session,
    refFloorY,
    blacklist,
    startPos,
    isPlantableFarmland
  );
}

async function plantFarmlandBlock(bot, session, targetBlock, accountId) {
  if (!bot || !targetBlock || !session.autoPlant || session.status !== 'online') return false;

  const seed = getSeedItem(bot);
  if (!seed) return false;

  if (!bot.heldItem || !PLANTABLE_SEED_NAMES.includes(bot.heldItem.name.toLowerCase())) {
    try {
      await bot.equip(seed, 'hand');
      await new Promise((r) => setTimeout(r, 40));
    } catch (e) {}
  }

  const eyePos = bot.entity.position.offset(0, bot.entity.height || 1.62, 0);
  const topFaceCenter = targetBlock.position.offset(0.5, 0.9375, 0.5);
  const dx = topFaceCenter.x - eyePos.x;
  const dy = topFaceCenter.y - eyePos.y;
  const dz = topFaceCenter.z - eyePos.z;
  const targetYaw = Math.atan2(-dx, -dz);
  const groundDist = Math.hypot(dx, dz);
  const targetPitch = Math.atan2(dy, groundDist);

  try {
    await bot.look(targetYaw, targetPitch, true);
  } catch (e) {
    smoothHumanLook(bot, targetYaw, 0.45);
  }

  try {
    if (typeof bot.activateBlock === 'function') {
      await bot.activateBlock(targetBlock, new Vec3(0, 1, 0));
    } else if (typeof bot._genericPlace === 'function') {
      await bot._genericPlace(targetBlock, new Vec3(0, 1, 0), { swingArm: 'right', forceLook: 'ignore' });
    } else if (typeof bot._placeBlockWithOptions === 'function') {
      await bot._placeBlockWithOptions(targetBlock, new Vec3(0, 1, 0), { swingArm: 'right', forceLook: 'ignore' });
    } else {
      bot.activateItem();
      bot.swingArm('right');
    }
  } catch (err) {
    try {
      bot.swingArm('right');
      bot.activateItem();
    } catch (e) {}
  }

  await new Promise((r) => setTimeout(r, 75));

  const posKey = `${targetBlock.position.x},${targetBlock.position.y},${targetBlock.position.z}`;
  const aboveNow = bot.blockAt(targetBlock.position.offset(0, 1, 0));
  const aboveName = aboveNow && aboveNow.name ? aboveNow.name.toLowerCase() : 'air';
  const plantedSuccess = aboveName !== 'air' && aboveName !== 'cave_air' && aboveName !== 'void_air';

  if (plantedSuccess) {
    if (session.plantFailCounts) session.plantFailCounts.delete(posKey);
    session.plantFarmY = targetBlock.position.y;
    session.plantRetriedBlacklist = false;
    session.stats.cropsPlanted = (session.stats.cropsPlanted || 0) + 1;
    if (session.stats.cropsPlanted % 15 === 0 || session.stats.cropsPlanted === 1) {
      addLog(
        accountId,
        'OTO-EKİM',
        `🌱 Ekin ekildi: [${targetBlock.position.x}, ${targetBlock.position.y}, ${targetBlock.position.z}] (Toplam: ${session.stats.cropsPlanted})`,
        chalk.green
      );
    }
    broadcastState();
    return true;
  }

  if (!session.plantFailCounts) session.plantFailCounts = new Map();
  const fails = (session.plantFailCounts.get(posKey) || 0) + 1;
  session.plantFailCounts.set(posKey, fails);
  if (fails >= 4) {
    if (!session.plantBlacklist) session.plantBlacklist = new Set();
    session.plantBlacklist.add(posKey);
    session.plantFailCounts.delete(posKey);
  }
  return false;
}

function startAutoPlantLoop(accountId) {
  const session = getOrCreateSession(accountId);
  if (session.plantTimer) {
    clearTimeout(session.plantTimer);
    session.plantTimer = null;
  }
  if (!session.autoPlant) return;

  session.plantLoopId = (session.plantLoopId || 0) + 1;
  const thisLoopId = session.plantLoopId;
  session.plantCurrentPath = null;
  session.plantTargetDirtPos = null;
  session.plantTargetStuckCount = 0;
  session.plantLastTargetPosStr = null;
  session.plantReturnPath = null;
  session.plantReturnPathIndex = 0;
  session.plantBlacklist = new Set();
  session.plantFailCounts = new Map();
  session.plantEmptyScanCount = 0;
  session.plantRetriedBlacklist = false;
  session.farmKnownChests = new Map();
  session.emptyFarmChests = new Map();

  if (session.bot && session.bot.entity && session.bot.entity.position) {
    session.plantStartPos = session.bot.entity.position.clone();
    session.plantFarmY = Math.floor(session.bot.entity.position.y + 0.25) - 1;
    const detectedChests = discoverFarmChests(session.bot, session, 88);
    if (detectedChests.length > 0) {
      addLog(
        accountId,
        'OTO-EKİM',
        `📦 Adada ${detectedChests.length} adet sandık/varil algılandı (En yakın: X:${detectedChests[0].x} Y:${detectedChests[0].y} Z:${detectedChests[0].z}). Tohum bittiğinde otomatik olarak bu sandıklardan çekilecek.`,
        chalk.cyan
      );
    } else {
      addLog(
        accountId,
        'OTO-EKİM',
        `📍 Oto-Ekim başlatıldı (X:${Math.floor(session.plantStartPos.x)} Y:${Math.floor(session.plantStartPos.y)} Z:${Math.floor(session.plantStartPos.z)}). Tohum bittiğinde çevredeki sandıklar taranacak.`,
        chalk.cyan
      );
    }
  }

  const step = async () => {
    session.plantTimer = null;

    // GÜVENLİK FRENİ: Özellik kapatıldıysa veya oturum sonlandıysa HAREKETİ DERHAL KES VE ÇIK!
    if (!session.autoPlant || session.plantLoopId !== thisLoopId || !session.bot || session.status !== 'online') {
      if (session.bot) {
        try {
          session.bot.setControlState('forward', false);
          session.bot.setControlState('back', false);
          session.bot.setControlState('left', false);
          session.bot.setControlState('right', false);
          session.bot.setControlState('jump', false);
          session.bot.setControlState('sprint', false);
          session.bot.setControlState('sneak', session.sneakLock || false);
          if (typeof session.bot.clearControlStates === 'function') {
            session.bot.clearControlStates();
          }
        } catch (e) {}
      }
      return;
    }

    const bot = session.bot;

    // Ada kenarı eğilme (sneak) koruması: Boşluğa düşmeyi fiziksel olarak engeller
    if (isNearIslandEdge(bot)) {
      bot.setControlState('sneak', true);
    } else if (!session.sneakLock) {
      bot.setControlState('sneak', false);
    }

    // Aydınlatma veya 1 blok yüksekteki engelden tarlaya geri in
    if (checkAndDescendFromFarmObstacle(bot, session)) {
      session.plantTimer = setTimeout(step, 280);
      return;
    }

    // Bekleme gerektiren durumlar (Giriş süreci, Captcha, Sandık aktarma, Tamir)
    if (
      session.isDropping ||
      session.isDepositing ||
      session.isSolvingCaptcha ||
      session.isRepairing ||
      bot.currentWindow
    ) {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
      } catch (e) {}
      session.plantTimer = setTimeout(step, 500);
      return;
    }

    const myPos = bot.entity.position;

    // TOHUM KONTROLÜ & ADADAKİ TÜM SANDIKLARDAN AKILLI OTOMATİK TAZELEME
    const seed = getSeedItem(bot);
    if (!seed) {
      const chestRes = await stepFarmChestRestock(
        bot,
        session,
        accountId,
        PLANTABLE_SEED_NAMES,
        'OTO-EKİM',
        'tohum',
        256
      );
      if (chestRes === 'restocked') {
        session.plantTargetDirtPos = null;
        session.plantCurrentPath = null;
        session.plantTimer = setTimeout(step, 150);
        return;
      }
      const waitMs =
        chestRes === 'walking' ? 55 :
        chestRes === 'next_chest' ? 140 : 2800;
      session.plantTimer = setTimeout(step, waitMs);
      return;
    }

    if (!bot.heldItem || !PLANTABLE_SEED_NAMES.includes(bot.heldItem.name.toLowerCase())) {
      try {
        await bot.equip(seed, 'hand');
      } catch (e) {}
    }

    // Etraftaki tüm ekilebilir boş tarlaları bul (tarla sınırları dahilinde)
    let plantableBlocks = findPlantableFarmlandAround(bot, 64, session);

    // Eğer blacklist doluysa ve blok kalmadıysa blacklist'i temizleyip bir kez daha bak
    if (plantableBlocks.length === 0 && session.plantBlacklist && session.plantBlacklist.size > 0 && !session.plantRetriedBlacklist) {
      session.plantRetriedBlacklist = true;
      session.plantBlacklist.clear();
      if (session.plantFailCounts) session.plantFailCounts.clear();
      plantableBlocks = findPlantableFarmlandAround(bot, 64, session);
    }

    // Etrafta hiç boş tarla kalmadıysa 2 tarama doğrula ve temiz şekilde bitir
    if (plantableBlocks.length === 0) {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
        bot.setControlState('sprint', false);
      } catch (e) {}
      session.plantEmptyScanCount = (session.plantEmptyScanCount || 0) + 1;
      if (session.plantEmptyScanCount < 2) {
        session.plantTimer = setTimeout(step, 300);
        return;
      }
      addLog(
        accountId,
        'OTO-EKİM',
        `🎉 Tebrikler! Tarla alanındaki tüm boş tarlalar başarıyla ekildi (Toplam: ${session.stats.cropsPlanted || 0} ekim).`,
        chalk.greenBright
      );
      stopAutoPlantLoop(accountId);
      broadcastState();
      return;
    }

    session.plantEmptyScanCount = 0;

    // 1. MENZİLDEKİ BOŞ TARLALARI (GÖZ MESAFESİ <= 3.85 BLOK) EK (BİTENE KADAR ASLA YERİNDEN AYRILMA!)
    const eyePos = myPos.offset(0, bot.entity.height || 1.62, 0);
    const immediateBlocks = plantableBlocks.filter((b) => {
      const topCenter = b.position.offset(0.5, 0.9375, 0.5);
      const eyeDist = eyePos.distanceTo(topCenter);
      const horizDist = Math.hypot(b.position.x + 0.5 - myPos.x, b.position.z + 0.5 - myPos.z);
      return eyeDist <= 3.85 && horizDist <= 3.65 && Math.abs(b.position.y - (Math.floor(myPos.y + 0.25) - 1)) <= 2;
    });

    if (immediateBlocks.length > 0) {
      bot.setControlState('forward', false);
      bot.setControlState('jump', false);

      const batch = immediateBlocks.slice(0, 3);
      for (const block of batch) {
        if (!session.autoPlant || session.plantLoopId !== thisLoopId || session.status !== 'online') break;
        const curB = bot.blockAt(block.position);
        if (curB && isPlantableFarmland(bot, curB)) {
          await plantFarmlandBlock(bot, session, curB, accountId);
        }
      }

      session.plantTimer = setTimeout(step, 55);
      return;
    }

    if (!session.autoPlant || session.plantLoopId !== thisLoopId || session.status !== 'online') {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
        if (typeof bot.clearControlStates === 'function') bot.clearControlStates();
      } catch (e) {}
      return;
    }

    // 2. EN YAKIN EKİLMEMİŞ BOŞ TARLAYA DOĞRU YÜRÜ
    let targetFarmland = null;
    if (session.plantTargetDirtPos) {
      const curTargetStr = `${session.plantTargetDirtPos.x},${session.plantTargetDirtPos.y},${session.plantTargetDirtPos.z}`;
      const isBlacklisted = session.plantBlacklist && session.plantBlacklist.has(curTargetStr);
      const curB = bot.blockAt(session.plantTargetDirtPos);
      if (!isBlacklisted && curB && isPlantableFarmland(bot, curB)) {
        targetFarmland = curB;
      } else {
        session.plantTargetDirtPos = null;
        session.plantCurrentPath = null;
      }
    }

    if (!targetFarmland) {
      if (plantableBlocks.length > 0) {
        targetFarmland = plantableBlocks[0];
        session.plantTargetDirtPos = targetFarmland.position.clone();
        session.plantCurrentPath = null;
        session.plantPathIndex = 0;
      } else {
        session.plantTargetDirtPos = null;
        session.plantCurrentPath = null;
      }
    }

    let nextDelay = 50;

    if (targetFarmland) {
      const navRes = stepFarmWalkTowardsTarget(
        bot,
        session,
        targetFarmland.position,
        'plant',
        3.65,
        3.45,
        0.9375
      );
      if (navRes === 'reached') {
        nextDelay = 40;
      } else if (navRes === 'unreachable') {
        const bKey = `${targetFarmland.position.x},${targetFarmland.position.y},${targetFarmland.position.z}`;
        if (!session.plantBlacklist) session.plantBlacklist = new Set();
        session.plantBlacklist.add(bKey);
        session.plantTargetDirtPos = null;
        session.plantCurrentPath = null;
        nextDelay = 50;
      } else {
        nextDelay = 50;
      }
    } else {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
      } catch (e) {}
      nextDelay = 100;
    }

    if (session.autoPlant && session.plantLoopId === thisLoopId && session.status === 'online') {
      session.plantTimer = setTimeout(step, nextDelay);
    } else {
      try {
        bot.setControlState('forward', false);
        bot.setControlState('jump', false);
        if (typeof bot.clearControlStates === 'function') bot.clearControlStates();
      } catch (e) {}
    }
  };

  session.plantTimer = setTimeout(step, 60);
}

function stopAutoPlantLoop(accountId) {
  const session = getOrCreateSession(accountId);
  session.autoPlant = false;
  session.plantLoopId = (session.plantLoopId || 0) + 1;
  session.plantCurrentPath = null;
  session.plantTargetDirtPos = null;
  session.plantStartPos = null;
  session.plantBlacklist = null;
  session.plantFailCounts = null;
  session.plantEmptyScanCount = 0;
  session.plantRetriedBlacklist = false;
  session.plantTargetStuckCount = 0;
  session.plantLastTargetPosStr = null;
  session.plantReturnPath = null;
  session.plantReturnPathIndex = 0;
  session.plantFarmY = null;
  if (session.plantTimer) {
    clearTimeout(session.plantTimer);
    session.plantTimer = null;
  }
  if (session.bot) {
    try {
      session.bot.setControlState('forward', false);
      session.bot.setControlState('back', false);
      session.bot.setControlState('left', false);
      session.bot.setControlState('right', false);
      session.bot.setControlState('jump', false);
      session.bot.setControlState('sprint', false);
      session.bot.setControlState('sneak', session.sneakLock || false);
      if (typeof session.bot.clearControlStates === 'function') {
        session.bot.clearControlStates();
      }
    } catch (e) {}
  }
}

// --- 5.5. SCHEMATICA / LITEMATICA OTOMATİK İNŞA (AUTO-BUILDER) ---
const CLASSIC_BLOCK_ID_MAP = {
  0: 'air',
  1: 'stone',
  2: 'grass_block',
  3: 'dirt',
  4: 'cobblestone',
  5: 'oak_planks',
  12: 'sand',
  13: 'gravel',
  17: 'oak_log',
  20: 'glass',
  23: 'dispenser',
  24: 'sandstone',
  29: 'sticky_piston',
  33: 'piston',
  35: 'white_wool',
  41: 'gold_block',
  42: 'iron_block',
  44: 'smooth_stone_slab',
  45: 'bricks',
  49: 'obsidian',
  50: 'torch',
  53: 'oak_stairs',
  54: 'chest',
  55: 'redstone_wire',
  57: 'diamond_block',
  58: 'crafting_table',
  61: 'furnace',
  65: 'ladder',
  67: 'cobblestone_stairs',
  69: 'lever',
  70: 'stone_pressure_plate',
  75: 'redstone_torch',
  76: 'redstone_torch',
  77: 'stone_button',
  79: 'ice',
  81: 'cactus',
  82: 'clay',
  83: 'sugar_cane',
  85: 'oak_fence',
  87: 'netherrack',
  88: 'soul_sand',
  89: 'glowstone',
  93: 'repeater',
  94: 'repeater',
  95: 'white_stained_glass',
  96: 'oak_trapdoor',
  98: 'stone_bricks',
  102: 'glass_pane',
  109: 'stone_brick_stairs',
  112: 'nether_bricks',
  123: 'redstone_lamp',
  125: 'oak_slab',
  133: 'emerald_block',
  139: 'cobblestone_wall',
  146: 'trapped_chest',
  149: 'comparator',
  150: 'comparator',
  151: 'daylight_detector',
  152: 'redstone_block',
  154: 'hopper',
  155: 'quartz_block',
  158: 'dropper',
  159: 'white_terracotta',
  160: 'white_stained_glass_pane',
  165: 'slime_block',
  169: 'sea_lantern',
  218: 'observer'
};

const FRAGILE_OR_ATTACHED_BLOCKS = new Set([
  'cactus',
  'sugar_cane',
  'bamboo',
  'redstone_wire',
  'repeater',
  'comparator',
  'torch',
  'wall_torch',
  'redstone_torch',
  'redstone_wall_torch',
  'soul_torch',
  'lever',
  'stone_button',
  'oak_button',
  'ladder',
  'rail',
  'powered_rail',
  'detector_rail',
  'activator_rail',
  'stone_pressure_plate',
  'oak_pressure_plate',
  'heavy_weighted_pressure_plate',
  'light_weighted_pressure_plate',
  'white_carpet',
  'oak_sign',
  'oak_wall_sign'
]);

const INTERACTIVE_CONTAINERS_SET = new Set([
  'chest',
  'trapped_chest',
  'ender_chest',
  'barrel',
  'shulker_box',
  'hopper',
  'dispenser',
  'dropper',
  'furnace',
  'blast_furnace',
  'smoker',
  'crafting_table',
  'anvil',
  'enchanting_table',
  'brewing_stand',
  'beacon',
  'repeater',
  'comparator',
  'daylight_detector',
  'lever',
  'note_block',
  'oak_trapdoor',
  'iron_trapdoor',
  'oak_door',
  'oak_fence_gate'
]);

function normalizeBlockName(rawName) {
  if (!rawName || typeof rawName !== 'string') return 'air';
  let s = rawName.trim().toLowerCase();
  const bracketIdx = s.indexOf('[');
  if (bracketIdx !== -1) s = s.slice(0, bracketIdx);
  if (s.startsWith('minecraft:')) s = s.slice(10);
  if (s === 'cave_air' || s === 'void_air' || s === 'structure_void' || s === 'air') return 'air';
  if (s === 'water' || s === 'flowing_water' || s === 'lava' || s === 'flowing_lava') return 'air';
  if (s === 'reeds') return 'sugar_cane';
  if (s === 'unpowered_repeater' || s === 'powered_repeater') return 'repeater';
  if (s === 'unpowered_comparator' || s === 'powered_comparator') return 'comparator';
  if (s === 'lit_redstone_Torch' || s === 'unlit_redstone_torch') return 'redstone_torch';
  if (s === 'grass') return 'grass_block';
  if (s === 'cobble_wall') return 'cobblestone_wall';
  if (s === 'Reed') return 'sugar_cane';
  return s;
}

function parsePaletteEntryString(entryStr) {
  const raw = String(entryStr || 'minecraft:air');
  const name = normalizeBlockName(raw);
  const props = {};
  const m = raw.match(/\[([^\]]+)\]/);
  if (m && m[1]) {
    for (const part of m[1].split(',')) {
      const [k, v] = part.split('=');
      if (k && v) props[k.trim()] = v.trim();
    }
  }
  return { name, props };
}

function createDefaultBuilderState(accountId = null) {
  const corners = {
    pos1: { x: 0, y: 64, z: 0 },
    pos2: { x: 0, y: 64, z: 0 }
  };
  let origin = { x: 0, y: 64, z: 0, initialized: false };
  let rotation = 0;
  let delayMs = 220;
  let autoChainTillPlant = true;

  if (typeof config !== 'undefined' && config && config.builderSharedCoords) {
    if (config.builderSharedCoords.pos1) corners.pos1 = { ...config.builderSharedCoords.pos1 };
    if (config.builderSharedCoords.pos2) corners.pos2 = { ...config.builderSharedCoords.pos2 };
    if (config.builderSharedCoords.origin) origin = { ...config.builderSharedCoords.origin, initialized: true };
    if (typeof config.builderSharedCoords.rotation === 'number') rotation = config.builderSharedCoords.rotation;
    if (typeof config.builderSharedCoords.delayMs === 'number') delayMs = config.builderSharedCoords.delayMs;
  }
  if (accountId && typeof config !== 'undefined' && config && Array.isArray(config.accounts)) {
    const chainAcc = config.accounts.find((a) => a.id === accountId);
    if (chainAcc && typeof chainAcc.autoChainTillPlant === 'boolean') {
      autoChainTillPlant = chainAcc.autoChainTillPlant;
    }
  }

  return {
    status: 'idle', // idle | building | paused | completed | error
    schematicName: '',
    format: '',
    width: 0,
    height: 0,
    length: 0,
    rotation,
    origin,
    corners,
    rawBlocks: [],
    rawWidth: 0,
    rawHeight: 0,
    rawLength: 0,
    blocks: [],
    materials: {},
    currentIndex: 0,
    placedCount: 0,
    totalBlocks: 0,
    currentBlock: null,
    statusMessage: 'Şema yüklenmedi. Bir .schem / .litematic dosyası yükleyin veya hazır şablon seçin.',
    delayMs: 260,
    autoRestockChest: true,
    autoChainTillPlant,
    autoMove: true,
    clearObstacles: false,
    skipMissingBlocks: false,
    isStepBusy: false,
    recentEmptyChests: new Map(),
    failedAttemptsMap: new Map()
  };
}

function getPublicBuilderSummary(session, accountId) {
  const accId = accountId || (session && session.accountId) || null;
  const b = (session && session.builder) || createDefaultBuilderState(accId);
  const invCounts = {};
  if (session && session.bot && session.bot.inventory) {
    for (const item of session.bot.inventory.items()) {
      const norm = normalizeBlockName(item.name);
      invCounts[norm] = (invCounts[norm] || 0) + item.count;
    }
  }

  let placedMaterials = b._cachedPlacedMaterials;
  if (
    !placedMaterials ||
    b._cachedPlacedCount !== b.placedCount ||
    b._cachedSchemName !== b.schematicName
  ) {
    placedMaterials = {};
    if (Array.isArray(b.blocks)) {
      for (let i = 0; i < b.blocks.length; i++) {
        const blk = b.blocks[i];
        if (blk && blk.placed) {
          placedMaterials[blk.name] = (placedMaterials[blk.name] || 0) + 1;
        }
      }
    }
    b._cachedPlacedMaterials = placedMaterials;
    b._cachedPlacedCount = b.placedCount;
    b._cachedSchemName = b.schematicName;
  }

  return {
    status: b.status,
    schematicName: b.schematicName,
    format: b.format,
    width: b.width,
    height: b.height,
    length: b.length,
    rotation: b.rotation,
    origin: b.origin,
    corners: b.corners || {
      pos1: { x: 0, y: 64, z: 0 },
      pos2: { x: 29, y: 65, z: 29 },
      fillBlock: 'stone_bricks',
      fillMode: 'solid'
    },
    currentIndex: b.currentIndex,
    placedCount: b.placedCount,
    totalBlocks: b.totalBlocks,
    currentBlock: b.currentBlock,
    statusMessage: b.statusMessage,
    delayMs: b.delayMs,
    autoRestockChest: b.autoRestockChest,
    autoChainTillPlant: b.autoChainTillPlant !== false,
    autoMove: b.autoMove,
    clearObstacles: b.clearObstacles,
    skipMissingBlocks: b.skipMissingBlocks,
    materials: b.materials || {},
    placedMaterials,
    inventoryCounts: invCounts
  };
}

function decodeVarIntArray(byteArray, expectedCount) {
  const result = [];
  let i = 0;
  const len = byteArray.length;
  while (i < len && result.length < expectedCount) {
    let value = 0;
    let shift = 0;
    while (i < len) {
      const b = byteArray[i++] & 0xff;
      value |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    result.push(value);
  }
  return result;
}

function unpackLitematicaBitArray(longPairs, paletteSize, volume) {
  const bitsPerEntry = Math.max(2, Math.ceil(Math.log2(Math.max(2, paletteSize))));
  const mask = (1n << BigInt(bitsPerEntry)) - 1n;
  const uLongs = longPairs.map((pair) => {
    if (typeof pair === 'bigint') return BigInt.asUintN(64, pair);
    if (Array.isArray(pair) && pair.length === 2) {
      return (BigInt(pair[0] >>> 0) << 32n) | BigInt(pair[1] >>> 0);
    }
    return BigInt(Number(pair) >>> 0);
  });

  const out = new Array(volume);
  for (let idx = 0; idx < volume; idx++) {
    const bitIndex = idx * bitsPerEntry;
    const startLong = Math.floor(bitIndex / 64);
    const startOffset = bitIndex % 64;
    if (startLong >= uLongs.length) {
      out[idx] = 0;
      continue;
    }
    let val;
    if (startOffset + bitsPerEntry <= 64) {
      val = (uLongs[startLong] >> BigInt(startOffset)) & mask;
    } else {
      const nextLong = startLong + 1 < uLongs.length ? uLongs[startLong + 1] : 0n;
      val = ((uLongs[startLong] >> BigInt(startOffset)) | (nextLong << BigInt(64 - startOffset))) & mask;
    }
    out[idx] = Number(val);
  }
  return out;
}

async function parseSchematicBuffer(buffer, filename = 'structure.schem') {
  const trimmedStr = buffer.slice(0, 64).toString('utf8').trim();
  if (trimmedStr.startsWith('{')) {
    const j = JSON.parse(buffer.toString('utf8'));
    const rawBlocks = (j.blocks || [])
      .map((b) => ({
        x: Number(b.x) || 0,
        y: Number(b.y) || 0,
        z: Number(b.z) || 0,
        name: normalizeBlockName(b.name),
        props: b.props || {}
      }))
      .filter((b) => b.name !== 'air');
    return {
      schematicName: j.name || path.basename(filename),
      format: 'JSON Şema',
      width: Number(j.width) || 1,
      height: Number(j.height) || 1,
      length: Number(j.length) || 1,
      rawBlocks
    };
  }

  const parsedNbt = await nbt.parse(buffer);
  const root = nbt.simplify(parsedNbt.parsed);

  // 1. Litematica (.litematic)
  if (root && root.Regions && typeof root.Regions === 'object') {
    const allBlocks = [];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const regName of Object.keys(root.Regions)) {
      const reg = root.Regions[regName];
      if (!reg || !reg.Size || !reg.BlockStatePalette || !reg.BlockStates) continue;

      const sx = Number(reg.Size.x) || 0;
      const sy = Number(reg.Size.y) || 0;
      const sz = Number(reg.Size.z) || 0;
      const absX = Math.abs(sx);
      const absY = Math.abs(sy);
      const absZ = Math.abs(sz);
      const posX = (reg.Position && Number(reg.Position.x)) || 0;
      const posY = (reg.Position && Number(reg.Position.y)) || 0;
      const posZ = (reg.Position && Number(reg.Position.z)) || 0;
      const offX = sx < 0 ? posX + sx + 1 : posX;
      const offY = sy < 0 ? posY + sy + 1 : posY;
      const offZ = sz < 0 ? posZ + sz + 1 : posZ;

      const palette = reg.BlockStatePalette.map((entry) => ({
        name: normalizeBlockName(entry.Name || 'air'),
        props: entry.Properties || {}
      }));

      const volume = absX * absY * absZ;
      const indices = unpackLitematicaBitArray(reg.BlockStates, palette.length, volume);

      let i = 0;
      for (let y = 0; y < absY; y++) {
        for (let z = 0; z < absZ; z++) {
          for (let x = 0; x < absX; x++) {
            const pIdx = indices[i++];
            const entry = palette[pIdx];
            if (entry && entry.name !== 'air') {
              const bx = offX + x;
              const by = offY + y;
              const bz = offZ + z;
              if (bx < minX) minX = bx;
              if (by < minY) minY = by;
              if (bz < minZ) minZ = bz;
              if (bx > maxX) maxX = bx;
              if (by > maxY) maxY = by;
              if (bz > maxZ) maxZ = bz;
              allBlocks.push({ x: bx, y: by, z: bz, name: entry.name, props: entry.props });
            }
          }
        }
      }
    }

    if (allBlocks.length === 0) {
      minX = minY = minZ = 0;
      maxX = maxY = maxZ = 0;
    }

    const normBlocks = allBlocks.map((b) => ({
      x: b.x - minX,
      y: b.y - minY,
      z: b.z - minZ,
      name: b.name,
      props: b.props
    }));

    const metaName =
      (root.Metadata && root.Metadata.Name) || path.basename(filename, path.extname(filename));

    return {
      schematicName: metaName,
      format: 'Litematica (.litematic)',
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      length: maxZ - minZ + 1,
      rawBlocks: normBlocks
    };
  }

  // 2. Sponge Schematic v1 / v2 / v3 (.schem)
  const schemRoot = root.Schematic ? root.Schematic : root;
  const paletteObj =
    schemRoot.Palette || (schemRoot.Blocks && schemRoot.Blocks.Palette) || null;
  const blockDataArr =
    schemRoot.BlockData || (schemRoot.Blocks && schemRoot.Blocks.Data) || null;

  if (paletteObj && blockDataArr) {
    const width = Number(schemRoot.Width) || 1;
    const height = Number(schemRoot.Height) || 1;
    const length = Number(schemRoot.Length) || 1;

    const idToEntry = {};
    for (const [stateStr, idVal] of Object.entries(paletteObj)) {
      idToEntry[Number(idVal)] = parsePaletteEntryString(stateStr);
    }

    const volume = width * height * length;
    const indices = decodeVarIntArray(blockDataArr, volume);
    const rawBlocks = [];

    for (let y = 0; y < height; y++) {
      for (let z = 0; z < length; z++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * length + z) * width + x;
          const entry = idToEntry[indices[idx]];
          if (entry && entry.name !== 'air') {
            rawBlocks.push({ x, y, z, name: entry.name, props: entry.props });
          }
        }
      }
    }

    return {
      schematicName: path.basename(filename),
      format: 'WorldEdit / Sponge (.schem)',
      width,
      height,
      length,
      rawBlocks
    };
  }

  // 3. Classic MCEdit / Schematica (.schematic)
  if (schemRoot.Blocks && Array.isArray(schemRoot.Blocks)) {
    const width = Number(schemRoot.Width) || 1;
    const height = Number(schemRoot.Height) || 1;
    const length = Number(schemRoot.Length) || 1;
    const blocksArr = schemRoot.Blocks;
    const rawBlocks = [];

    for (let y = 0; y < height; y++) {
      for (let z = 0; z < length; z++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * length + z) * width + x;
          const blockId = blocksArr[idx] & 0xff;
          if (blockId !== 0) {
            const mapped = CLASSIC_BLOCK_ID_MAP[blockId] || 'stone';
            if (mapped !== 'air') {
              rawBlocks.push({ x, y, z, name: mapped, props: {} });
            }
          }
        }
      }
    }

    return {
      schematicName: path.basename(filename),
      format: 'Schematica Classic (.schematic)',
      width,
      height,
      length,
      rawBlocks
    };
  }

  throw new Error('Tanınmayan şema formatı. Lütfen .schem, .litematic veya .schematic dosyası yükleyin.');
}

function buildPresetSchematic(presetId) {
  const rawBlocks = [];
  const add = (x, y, z, name, props = {}) => rawBlocks.push({ x, y, z, name, props });

  if (presetId === 'cactus_farm_tower') {
    // 7x8x7 2 Katlı Otomatik Kaktüs Farmı
    const W = 7, H = 8, L = 7;
    // Y=0: Taban & toplama hunisi/sandığı
    for (let x = 0; x < W; x++) {
      for (let z = 0; z < L; z++) {
        if (x === 3 && z === 0) add(x, 0, z, 'chest');
        else if (x === 3 && z === 1) add(x, 0, z, 'hopper');
        else add(x, 0, z, 'stone_bricks');
      }
    }
    // Y=1: Çevre duvarı + 4 Kum bloğu
    for (let x = 0; x < W; x++) {
      for (let z = 0; z < L; z++) {
        const isEdge = x === 0 || x === W - 1 || z === 0 || z === L - 1;
        if (isEdge && !(x === 3 && z === 0)) {
          add(x, 1, z, 'glass');
        }
      }
    }
    const pillars = [[2, 2], [4, 2], [2, 4], [4, 4]];
    for (const [px, pz] of pillars) {
      // Kat 1
      add(px, 1, pz, 'sand');
      add(px, 2, pz, 'cactus');
      // Kat 1 Kırıcı Blok (ortada çapraz)
      // Kat 2
      add(px, 4, pz, 'cobblestone');
      add(px, 5, pz, 'sand');
      add(px, 6, pz, 'cactus');
    }
    // Kırıcı bloklar (kaktüs büyüyünce yanındaki blok kaktüsü kırar)
    add(3, 3, 2, 'cobblestone_wall');
    add(3, 3, 4, 'cobblestone_wall');
    add(3, 7, 2, 'cobblestone_wall');
    add(3, 7, 4, 'cobblestone_wall');

    return {
      schematicName: '2 Katlı Otomatik Kaktüs Farmı (7x8x7)',
      format: 'Hazır Farm Şablonu',
      width: W,
      height: H,
      length: L,
      rawBlocks
    };
  }

  if (presetId === 'piston_sugarcane_farm') {
    // 7x5x5 Pistonlu & Gözlemcili Otomatik Farm Modülü
    const W = 7, H = 5, L = 5;
    // Z=0: Sandık + Huni sırası, Z=1: Ön Cam, Z=2: Kum/Toprak sırası, Z=3: Piston/Gözlemci duvarı, Z=4: Arka Redstone hattı
    add(3, 0, 0, 'chest');
    for (let x = 1; x <= 5; x++) {
      add(x, 0, 1, 'hopper');
      add(x, 0, 2, 'sand');
      add(x, 0, 3, 'stone_bricks');
      add(x, 0, 4, 'stone_bricks');
      // Y=1: Ekim katmanı & arka duvar
      add(x, 1, 1, 'glass');
      add(x, 1, 3, 'stone_bricks');
      add(x, 1, 4, 'stone_bricks');
      // Y=2: Piston katmanı & arkasındaki redstone bloğu
      add(x, 2, 1, 'glass');
      add(x, 2, 3, 'piston', { facing: 'north' });
      add(x, 2, 4, 'redstone_wire');
      // Y=3: Gözlemci (Observer) katmanı
      add(x, 3, 1, 'glass');
      add(x, 3, 3, 'observer', { facing: 'south' });
      // Y=4: Üst kapak
      add(x, 4, 2, 'smooth_stone_slab');
    }
    // Yan kapatma duvarları (X=0 ve X=6)
    for (let y = 0; y <= 3; y++) {
      for (let z = 1; z <= 3; z++) {
        add(0, y, z, 'stone_bricks');
        add(6, y, z, 'stone_bricks');
      }
    }

    return {
      schematicName: 'Pistonlu & Gözlemcili Farm Modülü (7x5x5)',
      format: 'Hazır Farm Şablonu',
      width: W,
      height: H,
      length: L,
      rawBlocks
    };
  }

  // Varsayılan 3. Şablon: AFK & Farm Koruma Platformu (9x4x9)
  const W = 9, H = 4, L = 9;
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < L; z++) {
      add(x, 0, z, 'stone_bricks');
      const isEdge = x === 0 || x === W - 1 || z === 0 || z === L - 1;
      if (isEdge) {
        add(x, 1, z, 'cobblestone');
        add(x, 2, z, 'glass');
      }
    }
  }
  add(1, 1, 1, 'torch');
  add(7, 1, 1, 'torch');
  add(1, 1, 7, 'torch');
  add(7, 1, 7, 'torch');

  return {
    schematicName: 'Koruma Duvarlı AFK & Farm Platformu (9x4x9)',
    format: 'Hazır Farm Şablonu',
    width: W,
    height: H,
    length: L,
    rawBlocks
  };
}

const FACING_ROT_90 = { north: 'east', east: 'south', south: 'west', west: 'north', up: 'up', down: 'down' };
const FACING_ROT_180 = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'up', down: 'down' };
const FACING_ROT_270 = { north: 'west', west: 'south', south: 'east', east: 'north', up: 'up', down: 'down' };

function rotateBlockProps(props, rot) {
  if (!props || typeof props !== 'object') return {};
  const out = { ...props };
  const r = ((Number(rot) || 0) % 360 + 360) % 360;
  if (r === 0) return out;

  const facingMap = r === 90 ? FACING_ROT_90 : r === 180 ? FACING_ROT_180 : FACING_ROT_270;
  if (out.facing && facingMap[out.facing]) {
    out.facing = facingMap[out.facing];
  }
  if (out.axis && (r === 90 || r === 270)) {
    if (out.axis === 'x') out.axis = 'z';
    else if (out.axis === 'z') out.axis = 'x';
  }
  return out;
}

function generateBoxSchematic(pos1, pos2, blockName = 'stone_bricks', fillMode = 'solid') {
  const minX = Math.min(Math.floor(Number(pos1.x) || 0), Math.floor(Number(pos2.x) || 0));
  const maxX = Math.max(Math.floor(Number(pos1.x) || 0), Math.floor(Number(pos2.x) || 0));
  const minY = Math.min(Math.floor(Number(pos1.y) || 0), Math.floor(Number(pos2.y) || 0));
  const maxY = Math.max(Math.floor(Number(pos1.y) || 0), Math.floor(Number(pos2.y) || 0));
  const minZ = Math.min(Math.floor(Number(pos1.z) || 0), Math.floor(Number(pos2.z) || 0));
  const maxZ = Math.max(Math.floor(Number(pos1.z) || 0), Math.floor(Number(pos2.z) || 0));

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const length = maxZ - minZ + 1;

  const rawBlocks = [];
  const normBlock = normalizeBlockName(blockName) || 'stone_bricks';

  for (let y = 0; y < height; y++) {
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        let shouldPlace = false;
        if (fillMode === 'solid') {
          shouldPlace = true;
        } else if (fillMode === 'hollow') {
          const isEdgeX = x === 0 || x === width - 1;
          const isEdgeY = y === 0 || y === height - 1;
          const isEdgeZ = z === 0 || z === length - 1;
          shouldPlace = isEdgeX || isEdgeY || isEdgeZ;
        } else if (fillMode === 'floor') {
          shouldPlace = y === 0;
        } else if (fillMode === 'walls') {
          const isEdgeX = x === 0 || x === width - 1;
          const isEdgeZ = z === 0 || z === length - 1;
          shouldPlace = isEdgeX || isEdgeZ;
        }
        if (shouldPlace) {
          rawBlocks.push({ x, y, z, name: normBlock, props: {} });
        }
      }
    }
  }

  const modeLabels = {
    solid: 'Dolu Kutu/Platform',
    hollow: 'İçi Boş Kutu',
    floor: 'Yalnızca Zemin',
    walls: 'Yalnızca Duvarlar'
  };

  return {
    schematicName: `Özel Alan (${width}x${height}x${length} • ${modeLabels[fillMode] || 'Yapı'})`,
    format: 'Çapraz Koordinat Yapısı',
    width,
    height,
    length,
    origin: { x: minX, y: minY, z: minZ, initialized: true },
    rawBlocks
  };
}

function applyRotationAndOrderBlocks(rawBlocks, width, height, length, rotation = 0) {
  const rot = ((Number(rotation) || 0) % 360 + 360) % 360;
  let outW = width;
  let outL = length;
  if (rot === 90 || rot === 270) {
    outW = length;
    outL = width;
  }

  const transformed = rawBlocks.map((b) => {
    let rx = b.x;
    let rz = b.z;
    if (rot === 90) {
      rx = length - 1 - b.z;
      rz = b.x;
    } else if (rot === 180) {
      rx = width - 1 - b.x;
      rz = length - 1 - b.z;
    } else if (rot === 270) {
      rx = b.z;
      rz = width - 1 - b.x;
    }
    const isFragile = FRAGILE_OR_ATTACHED_BLOCKS.has(b.name) ? 1 : 0;
    return {
      x: rx,
      y: b.y,
      z: rz,
      name: b.name,
      props: rotateBlockProps(b.props, rot),
      priority: isFragile,
      placed: false
    };
  });

  // Katman katman (Y aşağıdan yukarıya), önce katı destek blokları, sonra kaktüs/kızıltaş vb.
  transformed.sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.z !== b.z) return a.z - b.z;
    return a.z % 2 === 0 ? a.x - b.x : b.x - a.x;
  });

  const materials = {};
  for (const blk of transformed) {
    materials[blk.name] = (materials[blk.name] || 0) + 1;
  }

  return {
    width: outW,
    height,
    length: outL,
    blocks: transformed,
    materials
  };
}

function loadSchematicIntoSession(accountId, parsedSchem, rotation = 0) {
  const session = getOrCreateSession(accountId);
  if (session.builderTimer) {
    clearTimeout(session.builderTimer);
    session.builderTimer = null;
  }

  const prevBuilder = session.builder || createDefaultBuilderState();
  const ordered = applyRotationAndOrderBlocks(
    parsedSchem.rawBlocks,
    parsedSchem.width,
    parsedSchem.height,
    parsedSchem.length,
    rotation
  );

  let origin = prevBuilder.origin || { x: 0, y: 64, z: 0, initialized: false };
  if (parsedSchem.origin && parsedSchem.origin.initialized) {
    origin = { ...parsedSchem.origin };
  } else if (!origin.initialized && session.bot && session.bot.entity && session.bot.entity.position) {
    const p = session.bot.entity.position.floored();
    origin = { x: p.x + 1, y: p.y, z: p.z + 1, initialized: true };
  }

  session.builder = {
    ...prevBuilder,
    status: 'idle',
    schematicName: parsedSchem.schematicName,
    format: parsedSchem.format,
    width: ordered.width,
    height: ordered.height,
    length: ordered.length,
    rotation: Number(rotation) || 0,
    origin,
    corners: prevBuilder.corners || {
      pos1: { x: 0, y: 64, z: 0 },
      pos2: { x: 0, y: 64, z: 0 }
    },
    rawBlocks: parsedSchem.rawBlocks,
    rawWidth: parsedSchem.width,
    rawHeight: parsedSchem.height,
    rawLength: parsedSchem.length,
    blocks: ordered.blocks,
    materials: ordered.materials,
    currentIndex: 0,
    placedCount: 0,
    totalBlocks: ordered.blocks.length,
    currentBlock: null,
    statusMessage: `Şema hazır (${ordered.blocks.length} blok). Başlangıç koordinatını kontrol edip "İnşayı Başlat" butonuna basın.`,
    isStepBusy: false,
    recentEmptyChests: new Map(),
    failedAttemptsMap: new Map()
  };

  addLog(
    accountId,
    'AUTO-BUILDER',
    `"${parsedSchem.schematicName}" yüklendi (${ordered.width}x${ordered.height}x${ordered.length} • ${ordered.blocks.length} blok).`,
    chalk.cyan
  );
  broadcastState();
}

function withPromiseTimeout(promise, ms, fallbackVal = null) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallbackVal), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function syncBotInventoryWithServer(bot) {
  try {
    if (bot && typeof bot._syncWindow === 'function' && bot.inventory) {
      bot._syncWindow(bot.inventory);
    }
  } catch (e) {}
}

function resolveCandidateItemNamesForBlock(targetBlockName) {
  const normTarget = normalizeBlockName(targetBlockName);
  const names = [normTarget];

  let itemAlias = null;
  if (normTarget === 'redstone_wire') itemAlias = 'redstone';
  else if (normTarget === 'tripwire') itemAlias = 'string';
  else if (normTarget === 'grass_block') itemAlias = 'dirt';
  else if (normTarget === 'carrots') itemAlias = 'carrot';
  else if (normTarget === 'potatoes') itemAlias = 'potato';
  else if (normTarget === 'beetroots') itemAlias = 'beetroot_seeds';
  else if (normTarget === 'wheat') itemAlias = 'wheat_seeds';
  else if (normTarget === 'sweet_berry_bush') itemAlias = 'sweet_berries';
  else if (normTarget === 'kelp_plant') itemAlias = 'kelp';
  else if (normTarget === 'bamboo_sapling') itemAlias = 'bamboo';
  else if (normTarget === 'cocoa') itemAlias = 'cocoa_beans';
  else if (normTarget.endsWith('_wall_torch')) itemAlias = normTarget.replace('_wall_torch', '_torch');
  else if (normTarget === 'wall_torch') itemAlias = 'torch';
  else if (normTarget.endsWith('_wall_sign')) itemAlias = normTarget.replace('_wall_sign', '_sign');
  else if (normTarget.endsWith('_wall_hanging_sign')) itemAlias = normTarget.replace('_wall_hanging_sign', '_hanging_sign');
  else if (normTarget.endsWith('_wall_banner')) itemAlias = normTarget.replace('_wall_banner', '_banner');
  else if (normTarget.endsWith('_wall_fan')) itemAlias = normTarget.replace('_wall_fan', '_fan');
  else if (normTarget.includes('wall_skull')) itemAlias = normTarget.replace('_wall_skull', '_skull');
  else if (normTarget.includes('wall_head')) itemAlias = normTarget.replace('_wall_head', '_head');

  if (itemAlias && !names.includes(itemAlias)) {
    names.push(itemAlias);
  }
  if (normTarget === 'dirt' && !names.includes('grass_block')) {
    names.push('grass_block');
  }
  return names;
}

/**
 * Envanterde hedef bloğa ait eşyayı arar.
 * KRİTİK: Mineflayer'ın bot.inventory.items() dizisi önce ana envanteri (slot 9..35),
 * en son hotbar'ı (slot 36..44) döndürür. Hotbar'da blok varken slot 9'dan equip yapmaya
 * çalışmak gereksiz window_click paketleri gönderir ve 1.17.1+ sunucularda envanter senkronunu bozar!
 * Bu nedenle ÖNCE aktif el slotu, SONRA diğer hotbar slotları (36..44), EN SON ana envanter (9..35) taranır.
 */
function findMatchingInventoryItem(bot, targetBlockName) {
  if (!bot || !bot.inventory) return null;
  const candidateNames = resolveCandidateItemNamesForBlock(targetBlockName);
  const slots = Array.isArray(bot.inventory.slots) ? bot.inventory.slots : null;

  for (const wantedName of candidateNames) {
    if (slots) {
      // 1. Öncelik: Şu an elde tutulan aktif hotbar slotu
      const activeSlotIdx = 36 + (typeof bot.quickBarSlot === 'number' ? bot.quickBarSlot : 0);
      const activeSlotItem = slots[activeSlotIdx];
      if (
        activeSlotItem &&
        activeSlotItem.count > 0 &&
        normalizeBlockName(activeSlotItem.name) === wantedName
      ) {
        return activeSlotItem;
      }

      // 2. Öncelik: Diğer hotbar slotları (36..44)
      for (let s = 36; s <= 44; s++) {
        if (s === activeSlotIdx) continue;
        const it = slots[s];
        if (it && it.count > 0 && normalizeBlockName(it.name) === wantedName) {
          return it;
        }
      }

      // 3. Öncelik: Ana envanter slotları (9..35)
      for (let s = 9; s <= 35; s++) {
        const it = slots[s];
        if (it && it.count > 0 && normalizeBlockName(it.name) === wantedName) {
          return it;
        }
      }
    }

    // 4. Fallback: bot.inventory.items() (test ortamları veya özel envanter yapıları için)
    if (typeof bot.inventory.items === 'function') {
      const allItems = bot.inventory.items().filter((i) => i && (i.count === undefined || i.count > 0));
      const hotbarHit = allItems.find(
        (i) => i.slot >= 36 && i.slot <= 44 && normalizeBlockName(i.name) === wantedName
      );
      if (hotbarHit) return hotbarHit;

      const anyHit = allItems.find((i) => normalizeBlockName(i.name) === wantedName);
      if (anyHit) return anyHit;
    }
  }

  return null;
}

/**
 * Bloğu güvenli şekilde ele alır:
 * - Eşya zaten hotbar'da ise (36..44) yalnızca setQuickBarSlot çağrılır (window_click göndermez!).
 * - Eşya ana envanterde ise (9..35) önce yürüme tuşları durdurulur (Vulcan Inventory A/B koruması),
 *   ardından timeout korumalı bot.equip çalıştırılır ve sunucu envanter senkronu yapılır.
 */
async function safelyEquipBlockForBuilder(bot, session, invItem) {
  if (!bot || !invItem) return false;
  const targetNorm = normalizeBlockName(invItem.name);

  if (bot.heldItem && bot.heldItem.count > 0 && normalizeBlockName(bot.heldItem.name) === targetNorm) {
    return true;
  }

  if (typeof invItem.slot === 'number' && invItem.slot >= 36 && invItem.slot <= 44) {
    bot.setQuickBarSlot(invItem.slot - 36);
    if (bot.heldItem && normalizeBlockName(bot.heldItem.name) === targetNorm) {
      return true;
    }
  }

  // Ana envanterden (9..35) hotbar'a taşırken yürümeyi durdur
  if (bot.setControlState) {
    bot.setControlState('forward', false);
    bot.setControlState('back', false);
    bot.setControlState('left', false);
    bot.setControlState('right', false);
    bot.setControlState('jump', false);
    bot.setControlState('sprint', false);
  }
  await waitOnePhysicsTick(bot, 60);

  // Eğer hotbar'da boş bir slot varsa önce o boş hotbar slotunu seç ki dolu slotla swap yapmasın
  if (bot.inventory && Array.isArray(bot.inventory.slots)) {
    for (let h = 0; h < 9; h++) {
      if (!bot.inventory.slots[36 + h]) {
        bot.setQuickBarSlot(h);
        break;
      }
    }
  }

  try {
    await withPromiseTimeout(bot.equip(invItem, 'hand'), 1500);
  } catch (e) {}

  return Boolean(bot.heldItem && normalizeBlockName(bot.heldItem.name) === targetNorm);
}

function findNearbyDroppedItem(bot, maxDistance = 3.8) {
  if (!bot || !bot.entity || !bot.entities) return null;
  const botPos = bot.entity.position;
  let closest = null;
  let minDist = maxDistance;

  for (const id in bot.entities) {
    const e = bot.entities[id];
    if (!e || !e.position) continue;
    const isItem = e.name === 'item' || e.displayName === 'Item' || e.type === 'object';
    if (isItem) {
      const dist = botPos.distanceTo(e.position);
      if (dist < minDist && Math.abs(e.position.y - botPos.y) <= 1.8) {
        minDist = dist;
        closest = e;
      }
    }
  }
  return closest;
}

function isSamePlacedBlock(worldBlockName, targetBlockName) {
  const w = normalizeBlockName(worldBlockName);
  const t = normalizeBlockName(targetBlockName);
  if (w === t) return true;
  if (t === 'redstone_wire' && w === 'redstone') return true;
  const dirtVariants = new Set(['dirt', 'grass_block', 'dirt_path', 'grass_path', 'farmland', 'podzol', 'coarse_dirt', 'mycelium']);
  if (dirtVariants.has(t) && dirtVariants.has(w)) return true;
  return false;
}

function waitForBlockPlacement(bot, targetPos, expectedName, timeoutMs = 350) {
  return new Promise((resolve) => {
    const initial = bot.blockAt(targetPos);
    if (initial && isSamePlacedBlock(initial.name, expectedName)) {
      return resolve(true);
    }

    let settled = false;
    let timer = null;

    const onBlockUpdate = (oldBlock, newBlock) => {
      if (settled) return;
      if (newBlock && isSamePlacedBlock(newBlock.name, expectedName)) {
        settled = true;
        cleanup();
        resolve(true);
      }
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      bot.removeListener(`blockUpdate:${targetPos}`, onBlockUpdate);
    };

    bot.on(`blockUpdate:${targetPos}`, onBlockUpdate);

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      const finalCheck = bot.blockAt(targetPos);
      if (finalCheck && isSamePlacedBlock(finalCheck.name, expectedName)) {
        resolve(true);
      } else {
        resolve(false);
      }
    }, timeoutMs);
  });
}

function getRemainingNeededMaterials(builder) {
  const needed = {};
  if (!builder || !Array.isArray(builder.blocks)) return needed;
  for (let i = builder.currentIndex; i < builder.blocks.length; i++) {
    const b = builder.blocks[i];
    if (!b.placed) {
      const itemKey = b.name === 'redstone_wire' ? 'redstone' : b.name;
      needed[b.name] = (needed[b.name] || 0) + 1;
      if (itemKey !== b.name) needed[itemKey] = (needed[itemKey] || 0) + 1;
    }
  }
  return needed;
}

/**
 * Botun bulunduğu konumda herhangi bir katman kenarına / boşluğa yakın olup olmadığını
 * veya botun merkezinin (sneak ile tutunarak) boşluğun üzerine sarkıp sarkmadığını kontrol eder.
 */
function isBotOverhangingOrNearEdge(bot, session = null) {
  if (!bot || !bot.entity || !bot.entity.position) return false;
  const p = bot.entity.position;
  const footY = Math.round(p.y);
  const floorY = footY - 1;
  const bx = Math.floor(p.x);
  const bz = Math.floor(p.z);

  // 1. Doğrudan botun merkez koordinatının altındaki blok sağlam zemin değilse (bot sneak ile kenardan sarkıyor!)
  const centerFloor = bot.blockAt(new Vec3(bx, floorY, bz));
  if (!centerFloor || !isBlockWalkableFloor(centerFloor, session)) {
    return true;
  }

  // 2. Yalnızca bot bloğun kenarına (< 0.22m) fiziksel olarak yaklaşmışsa VE o yöndeki zemin boşluksa sneak aç
  const fracX = p.x - bx;
  const fracZ = p.z - bz;

  if (fracX < 0.22) {
    const west = bot.blockAt(new Vec3(bx - 1, floorY, bz));
    if (!west || !isBlockWalkableFloor(west, session)) return true;
  } else if (fracX > 0.78) {
    const east = bot.blockAt(new Vec3(bx + 1, floorY, bz));
    if (!east || !isBlockWalkableFloor(east, session)) return true;
  }

  if (fracZ < 0.22) {
    const north = bot.blockAt(new Vec3(bx, floorY, bz - 1));
    if (!north || !isBlockWalkableFloor(north, session)) return true;
  } else if (fracZ > 0.78) {
    const south = bot.blockAt(new Vec3(bx, floorY, bz + 1));
    if (!south || !isBlockWalkableFloor(south, session)) return true;
  }

  return false;
}

/**
 * Bot sneak ile bloğun kenarından sarkıyorsa (merkez koordinatının altı boşluksa),
 * sneak'i ASLA bırakmadan önce botu bastığı sağlam bloğun tam merkezine çeker.
 */
async function stabilizeBotOnBlockCenter(bot, session = null) {
  if (!bot || !bot.entity || !bot.entity.position) return;
  const p = bot.entity.position;
  const footY = Math.round(p.y);
  const centerFloor = bot.blockAt(new Vec3(Math.floor(p.x), footY - 1, Math.floor(p.z)));
  if (centerFloor && isBlockWalkableFloor(centerFloor, session)) {
    return; // Merkez zaten sağlam bloğun üzerinde
  }

  const safeStand = getEffectiveBotStandBlock(bot, session);
  if (!safeStand) return;

  bot.setControlState('sneak', true);
  bot.setControlState('sprint', false);
  const targetCenter = new Vec3(safeStand.x + 0.5, safeStand.y, safeStand.z + 0.5);
  const startWait = Date.now();
  while (Date.now() - startWait < 420) {
    if (!bot.entity || !bot.entity.position) break;
    const cur = bot.entity.position;
    const hDist = Math.hypot(targetCenter.x - cur.x, targetCenter.z - cur.z);
    if (hDist <= 0.22) break;
    const dx = targetCenter.x - cur.x;
    const dz = targetCenter.z - cur.z;
    const yaw = Math.atan2(-dx, -dz);
    try {
      await bot.look(yaw, 0, true);
    } catch (e) {}
    bot.setControlState('forward', true);
    await new Promise((r) => setTimeout(r, 40));
  }
  bot.setControlState('forward', false);
}

/**
 * Auto-Builder için hassas, katman kilidi ve düşme korumalı A* yol bulucu.
 * - options.allowStepDown === false (varsayılan inşa modu): Bot bulunduğu katmandan (minY) ASLA aşağı inmez!
 * - options.allowStepDown === true (sandık merdiven rotası): Yalnızca geri çıkılabilir 1 blokluk basamaklara izin verir.
 */
function findBuilderPath(bot, startPos, goalPos, session = null, maxNodes = 700, options = {}) {
  if (!bot || !startPos || !goalPos) return null;
  const allowStepDown = Boolean(options && options.allowStepDown);
  const minY = options && typeof options.minY === 'number'
    ? options.minY
    : (allowStepDown ? -Infinity : startPos.y);

  if (
    startPos.x === goalPos.x &&
    startPos.z === goalPos.z &&
    Math.abs(startPos.y - goalPos.y) <= (allowStepDown ? 1 : 0)
  ) {
    return [];
  }

  const openSet = [{ pos: startPos, g: 0, f: startPos.distanceTo(goalPos) }];
  const cameFrom = new Map();
  const gScore = new Map();
  gScore.set(startPos.toString(), 0);
  const closedSet = new Set();

  const orthogonalNeighbors = [
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 }
  ];

  let nodesCount = 0;

  while (openSet.length > 0 && nodesCount < maxNodes) {
    nodesCount++;
    openSet.sort((a, b) => a.f - b.f);
    const cur = openSet.shift();
    const curKey = cur.pos.toString();

    // Tam koordinat eşleşmesi (hedef blok üzerinde duruş)
    if (
      cur.pos.x === goalPos.x &&
      cur.pos.z === goalPos.z &&
      (allowStepDown ? Math.abs(cur.pos.y - goalPos.y) <= 1 : cur.pos.y === goalPos.y)
    ) {
      const path = [cur.pos];
      let k = curKey;
      while (cameFrom.has(k)) {
        const prev = cameFrom.get(k);
        path.unshift(prev);
        k = prev.toString();
      }
      return path.slice(1);
    }

    closedSet.add(curKey);

    for (const n of orthogonalNeighbors) {
      const nx = cur.pos.x + n.dx;
      const nz = cur.pos.z + n.dz;
      const y = cur.pos.y;

      const candidates = [];

      // 1. Düz hareket (dy = 0)
      const candFlat = new Vec3(nx, y, nz);
      if (y >= minY && isWalkablePosition(bot, candFlat, session)) {
        candidates.push({ pos: candFlat, cost: 1.0 });
      }

      // 2. Bir blok yukarı çıkış (dy = +1)
      const candUp = new Vec3(nx, y + 1, nz);
      const headCeilClear = isBlockPassable(bot.blockAt(cur.pos.offset(0, 2, 0)));
      if (headCeilClear && candUp.y >= minY && isWalkablePosition(bot, candUp, session)) {
        candidates.push({ pos: candUp, cost: 1.4 });
      }

      // 3. Bir blok aşağı iniş (dy = -1): YALNIZCA allowStepDown === true ise (sandık merdiveni)
      // ve geri çıkarken tavan açık (geri zıplanabilir basamak) ise izin verilir!
      if (allowStepDown && (y - 1) >= minY) {
        const candDown = new Vec3(nx, y - 1, nz);
        const spaceAboveDownClear = isBlockPassable(bot.blockAt(new Vec3(nx, y + 1, nz)));
        if (spaceAboveDownClear && isWalkablePosition(bot, candDown, session)) {
          candidates.push({ pos: candDown, cost: 1.35 });
        }
      }

      for (const cand of candidates) {
        const neighborKey = cand.pos.toString();
        if (closedSet.has(neighborKey)) continue;

        const tentativeG = (gScore.get(curKey) || 0) + cand.cost;
        if (!gScore.has(neighborKey) || tentativeG < gScore.get(neighborKey)) {
          cameFrom.set(neighborKey, cur.pos);
          gScore.set(neighborKey, tentativeG);
          const h = cand.pos.distanceTo(goalPos);
          const f = tentativeG + h;
          const existingOpen = openSet.find(item => item.pos.toString() === neighborKey);
          if (existingOpen) {
            existingOpen.g = tentativeG;
            existingOpen.f = f;
          } else {
            openSet.push({ pos: cand.pos, g: tentativeG, f });
          }
        }
      }
    }
  }

  return null; // Güvenli rota bulunamadı
}

/**
 * Oyuncunun 0.6 x 1.8 x 0.6 AABB hitbox'ının hedef 1x1x1 blokla kesişip kesişmediğini denetler.
 * Yalnızca floored() kontrolü yapmak, bot blok sınırına yakın (örn. x = 99.75) durduğunda
 * kendi hitbox'ının içine blok koymaya çalışmasına ve sunucunun reddetmesine yol açar.
 */
function doesBotIntersectBlock(botPos, targetPos, margin = 0.36) {
  if (!botPos || !targetPos) return false;
  const minX = botPos.x - margin;
  const maxX = botPos.x + margin;
  const minY = botPos.y;
  const maxY = botPos.y + 1.8;
  const minZ = botPos.z - margin;
  const maxZ = botPos.z + margin;

  const bMinX = targetPos.x;
  const bMaxX = targetPos.x + 1.0;
  const bMinY = targetPos.y;
  const bMaxY = targetPos.y + 1.0;
  const bMinZ = targetPos.z;
  const bMaxZ = targetPos.z + 1.0;

  return (
    maxX > bMinX && minX < bMaxX &&
    maxY > bMinY && minY < bMaxY &&
    maxZ > bMinZ && minZ < bMaxZ
  );
}

/**
 * Bot bir bloğun kenarında (örn. x=10.28) durduğunda botPos.floored() hava bloğuna denk gelebilir.
 * Bu yardımcı fonksiyon, botun ayaklarının gerçekten bastığı sağlam bloğu bulur.
 */
function getEffectiveBotStandBlock(bot, session = null) {
  if (!bot || !bot.entity || !bot.entity.position) return null;
  const p = bot.entity.position;
  const baseY = Math.round(p.y);
  const direct = new Vec3(Math.floor(p.x), baseY, Math.floor(p.z));
  if (isWalkablePosition(bot, direct, session)) return direct;

  const offsets = [
    [0.32, 0],
    [-0.32, 0],
    [0, 0.32],
    [0, -0.32],
    [0.32, 0.32],
    [-0.32, 0.32],
    [0.32, -0.32],
    [-0.32, -0.32]
  ];
  for (const [ox, oz] of offsets) {
    const cand = new Vec3(Math.floor(p.x + ox), baseY, Math.floor(p.z + oz));
    if (isWalkablePosition(bot, cand, session)) return cand;
  }
  return direct;
}

function findBuilderStandingSpot(bot, targetPos, session = null, options = {}) {
  if (!bot || !bot.entity || !bot.entity.position) return null;
  const startStand = getEffectiveBotStandBlock(bot, session) || bot.entity.position.floored();
  const blockCenter = targetPos.offset(0.5, 0.5, 0.5);
  const excludeCurrentSpot = Boolean(options && options.excludeCurrentSpot);

  // KATMAN DÜŞME KORUMASI: Bot inşa sırasında bulunduğu Y katmanından (startStand.y) ASLA aşağı inmemeli!
  const minAllowedY = startStand.y;

  const candidates = [];

  // Hedef bloğun etrafındaki (dx: -4..4, dz: -4..4, dy: 0..2) olası duruş noktalarını tara
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      if (dx === 0 && dz === 0) continue;
      for (let dy = -1; dy <= 2; dy++) {
        const cand = new Vec3(targetPos.x + dx, targetPos.y + dy, targetPos.z + dz);
        // Bulunduğu katmandan daha aşağıda bir duruş noktasını KESİNLİKLE reddet!
        if (cand.y < minAllowedY) continue;

        const standPos = cand.offset(0.5, 0, 0.5);

        // Hedef bloğun AABB hitbox içine girmeyi kesin olarak yasakla
        if (doesBotIntersectBlock(standPos, targetPos, 0.42)) {
          continue;
        }

        // Göz mesafesi: Step 5 yerleştirme menzili (<= 3.90m) ile tam uyumlu olması için
        // duruş noktasını 1.75m ile 3.25m arasında seç (asla 3.60m sınırında takılı kalmasın!)
        const eyeCand = cand.offset(0.5, 1.62, 0.5);
        const distToCenter = eyeCand.distanceTo(blockCenter);
        if (distToCenter < 1.75 || distToCenter > 3.25) continue;

        // Zemin sağlam ve yürünebilir olmalı
        if (isWalkablePosition(bot, cand, session)) {
          const distToBot = bot.entity.position.distanceTo(standPos);
          if (excludeCurrentSpot && distToBot < 0.85) continue;
          candidates.push({ pos: cand, distToBot, distToCenter });
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // Botun şu anki konumuna en yakın olan (ve aynı katmandaki) adayları sırala
  candidates.sort((a, b) => {
    const aSameY = a.pos.y === startStand.y ? 0 : 1;
    const bSameY = b.pos.y === startStand.y ? 0 : 1;
    if (aSameY !== bSameY) return aSameY - bSameY;
    return a.distToBot - b.distToBot;
  });

  // Botun gerçekten şu anki göz konumundan hedefe <= 3.30m mesafede olup olmadığını kontrol et
  const curEyeDist = bot.entity.position.offset(0, 1.62, 0).distanceTo(blockCenter);
  if (
    !excludeCurrentSpot &&
    !doesBotIntersectBlock(bot.entity.position, targetPos, 0.36) &&
    curEyeDist >= 1.65 &&
    curEyeDist <= 3.30
  ) {
    const alreadyAtCand = candidates.find(
      (c) => c.pos.x === startStand.x && c.pos.z === startStand.z && c.pos.y === startStand.y
    );
    if (alreadyAtCand) {
      return { spot: startStand, path: [] };
    }
  }

  // Adaylar arasından botun mevcut konumundan (aşağı inmeden!) A* ile gidilebilen ilk adayı seç
  for (const cand of candidates) {
    if (
      cand.pos.x === startStand.x &&
      cand.pos.z === startStand.z &&
      cand.pos.y === startStand.y
    ) {
      // Bot aynı blokta ama bloğun uzak kenarında duruyorsa doğrudan blok merkezine yürüsün
      return { spot: cand.pos, path: [cand.pos] };
    }
    const path = findBuilderPath(bot, startStand, cand.pos, session, 650, {
      allowStepDown: false,
      minY: minAllowedY
    });
    if (path !== null) {
      return { spot: cand.pos, path };
    }
  }

  return null;
}

/**
 * Verilen A* düğüm dizisi (path) boyunca botu düşme korumalı (katman kilitli) olarak yürütür.
 * - İnşa katmanı üzerinde yürürken sneak (eğilme) sürekli aktif tutulur ve her düğümün tam merkezinden (<= 0.24m)
 *   geçilerek köşelerden boşluğa düşme %100 engellenir.
 */
async function walkBotAlongPath(bot, session, path, maxDurationMs = 2400, stopNearTargetBlock = null, options = {}) {
  if (!bot || !bot.entity || !bot.entity.position || !Array.isArray(path) || path.length === 0) {
    return false;
  }

  const allowStepDown = Boolean(options && options.allowStepDown);
  const startTime = Date.now();
  const startY = Math.round(bot.entity.position.y);
  const minAllowedY = allowStepDown ? startY - 1.25 : startY - 0.20;
  const targetCenter = stopNearTargetBlock ? stopNearTargetBlock.offset(0.5, 0.5, 0.5) : null;

  try {
    for (const node of path) {
      if (session && session.builder && session.builder.status !== 'building') break;
      if (Date.now() - startTime > maxDurationMs) break;

      // Eğer hedef düğüm izin verilen Y katmanının altındaysa derhal dur!
      if (!allowStepDown && node.y < startY) {
        bot.setControlState('forward', false);
        bot.setControlState('sneak', true);
        break;
      }

      const nodeCenter = new Vec3(node.x + 0.5, node.y, node.z + 0.5);

      if (targetCenter) {
        const curPos = bot.entity.position;
        const curEye = curPos.offset(0, 1.62, 0);
        if (
          curEye.distanceTo(targetCenter) <= 3.15 &&
          !doesBotIntersectBlock(curPos, stopNearTargetBlock, 0.38)
        ) {
          break;
        }
      }

      // KATMAN DÜŞME KORUMASI:
      if (bot.entity.position.y < minAllowedY) {
        bot.setControlState('forward', false);
        bot.setControlState('sneak', true);
        break;
      }

      const nodeStartTime = Date.now();
      while (Date.now() - nodeStartTime < 1300) {
        if (session && session.builder && session.builder.status !== 'building') break;
        if (Date.now() - startTime > maxDurationMs) break;

        const cur = bot.entity.position;
        if (cur.y < minAllowedY) {
          bot.setControlState('forward', false);
          bot.setControlState('sneak', true);
          break;
        }

        const curEyeNow = cur.offset(0, 1.62, 0);
        if (
          targetCenter &&
          curEyeNow.distanceTo(targetCenter) <= 3.15 &&
          !doesBotIntersectBlock(cur, stopNearTargetBlock, 0.38)
        ) {
          break;
        }

        const hDist = Math.hypot(nodeCenter.x - cur.x, nodeCenter.z - cur.z);
        if (hDist <= 0.24 && Math.abs(nodeCenter.y - cur.y) <= 0.6) break;

        const dx = nodeCenter.x - cur.x;
        const dz = nodeCenter.z - cur.z;
        const yaw = Math.atan2(-dx, -dz);

        const isSteppingDown = allowStepDown && node.y < Math.round(cur.y);
        if (!isSafeToStep(bot, yaw, session, { allowStepDown: isSteppingDown })) {
          bot.setControlState('forward', false);
          bot.setControlState('sneak', true);
          break;
        }

        await bot.look(yaw, 0, true);
        bot.setControlState('forward', true);
        bot.setControlState('sprint', false);

        // Vulcan güvenli yürüyüş: Yalnızca uçurum/katman kenarına (<0.22m) yaklaşıldığında eğil (sneak),
        // güvenli zemin ve merdiven inişinde normal yürüme hızında ilerle
        const shouldSneak = Boolean(session && session.sneakLock) || (!isSteppingDown && isBotOverhangingOrNearEdge(bot, session));
        bot.setControlState('sneak', shouldSneak);

        const dy = nodeCenter.y - cur.y;
        if (dy >= 0.55 && dy <= 1.25) {
          bot.setControlState('jump', true);
        } else {
          bot.setControlState('jump', false);
        }

        await new Promise((r) => setTimeout(r, 45));
      }
    }
    return true;
  } finally {
    if (bot) {
      bot.setControlState('forward', false);
      bot.setControlState('sprint', false);
      bot.setControlState('jump', false);
      // EĞER BOT BLOK KENARINDAN SARKIYORSA ÖNCE MERKEZE ÇEK, KENARDAYSA SNEAK'İ ASLA BIRAKMA!
      await stabilizeBotOnBlockCenter(bot, session);
      const keepSneak =
        Boolean(session && session.sneakLock) ||
        isBotOverhangingOrNearEdge(bot, session);
      bot.setControlState('sneak', keepSneak);
    }
  }
}

async function builderMoveTowardsBlock(bot, session, targetWorldPos, maxDurationMs = 2500, precomputedPath = null) {
  if (!bot || !bot.entity || !bot.entity.position || !targetWorldPos) return false;
  const botPos = bot.entity.position;
  const startStand = getEffectiveBotStandBlock(bot, session) || botPos.floored();
  const targetCenter = targetWorldPos.offset(0.5, 0.5, 0.5);

  // Eğer zaten güvenli uzanma mesafesindeyse (<= 3.15m) ve hedef bloğun içinde değilse hareket etmeye gerek yok
  const currentEye = botPos.offset(0, 1.62, 0);
  if (
    currentEye.distanceTo(targetCenter) <= 3.15 &&
    !doesBotIntersectBlock(botPos, targetWorldPos, 0.38)
  ) {
    return true;
  }

  let path = precomputedPath;
  if (!path || path.length === 0) {
    const standResult = findBuilderStandingSpot(bot, targetWorldPos, session);
    if (!standResult) return false;
    if (standResult.spot && Array.isArray(standResult.path)) {
      path = standResult.path.length > 0 ? standResult.path : [standResult.spot];
    } else if (standResult.x !== undefined) {
      path = findBuilderPath(bot, startStand, standResult, session, 650, {
        allowStepDown: false,
        minY: startStand.y
      });
    }
  }

  if (!path || path.length === 0) return false;
  return await walkBotAlongPath(bot, session, path, maxDurationMs, targetWorldPos, {
    allowStepDown: false
  });
}

async function stepMoveBotTowards(bot, targetVec, durationMs = 380) {
  // Geriye dönük uyumluluk wrapper
  await builderMoveTowardsBlock(bot, null, targetVec, durationMs);
}

/**
 * Bir sandığa veya hedef noktaya güvenli GİDİŞ-DÖNÜŞ (two-way) A* yolu olup olmadığını
 * hareket etmeden ÖNCE hafızada hesaplar.
 * - Eğer sandık alt katmandaysa ve merdiven yoksa (veya tek yönlü düşüş varsa ve geri çıkılamıyorsa),
 *   null döndürür; böylece bot ASLA sandığa gitmeye çalışmaz ve aşağı düşmez!
 */
function findSafeTwoWayChestRoute(bot, session, targetBlockPos, maxNodes = 2000) {
  if (!bot || !bot.entity || !bot.entity.position || !targetBlockPos) return null;
  const botPos = bot.entity.position;
  const startStand = getEffectiveBotStandBlock(bot, session) || botPos.floored();
  const targetCenter = targetBlockPos.offset(0.5, 0.5, 0.5);

  // Zaten uzanma mesafesindeyse (<= 3.8m) yürümeye gerek yok
  if (botPos.offset(0, 1.62, 0).distanceTo(targetCenter) <= 3.85) {
    return { spot: startStand, pathToChest: [], pathBack: [] };
  }

  // Sandığın etrafındaki (dx: -3..3, dz: -3..3, dy: -1..1) yürünebilir duruş noktalarını bul
  const spotCandidates = [];
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        const spot = new Vec3(targetBlockPos.x + dx, targetBlockPos.y + dy, targetBlockPos.z + dz);
        const eyeFromSpot = spot.offset(0.5, 1.62, 0.5);
        const reachDist = eyeFromSpot.distanceTo(targetCenter);
        if (reachDist > 3.75) continue;
        if (isWalkablePosition(bot, spot, session)) {
          spotCandidates.push({
            spot,
            distToBot: botPos.distanceTo(spot.offset(0.5, 0, 0.5)),
            sameLevel: spot.y === startStand.y ? 0 : 1
          });
        }
      }
    }
  }

  if (spotCandidates.length === 0) return null;

  // Önce botla aynı katmanda olan ve en yakın olan duruş noktalarını dene
  spotCandidates.sort((a, b) => {
    if (a.sameLevel !== b.sameLevel) return a.sameLevel - b.sameLevel;
    return a.distToBot - b.distToBot;
  });

  // 1. Öncelik: Hiç katman değiştirmeden (allowStepDown: false) gidilebilen güvenli yol
  for (let i = 0; i < Math.min(spotCandidates.length, 10); i++) {
    const cand = spotCandidates[i];
    if (cand.spot.y < startStand.y) continue;
    const pathSameLayer = findBuilderPath(bot, startStand, cand.spot, session, maxNodes, {
      allowStepDown: false,
      minY: startStand.y
    });
    if (pathSameLayer !== null) {
      const pathBack = findBuilderPath(bot, cand.spot, startStand, session, maxNodes, {
        allowStepDown: true,
        minY: startStand.y
      });
      if (pathBack !== null) {
        return { spot: cand.spot, pathToChest: pathSameLayer, pathBack };
      }
    }
  }

  // 2. Öncelik: Merdiven/basamak ile inilip GERİ ÇIKILABİLEN (çift yönlü doğrulanmış) yol
  for (let i = 0; i < Math.min(spotCandidates.length, 8); i++) {
    const cand = spotCandidates[i];
    const pathToChest = findBuilderPath(bot, startStand, cand.spot, session, maxNodes, {
      allowStepDown: true
    });
    if (pathToChest !== null) {
      // Geri dönüş yolu (pathBack) da KESİNLİKLE mevcut olmalı (tek yönlü atlama/düşüş yasak!)
      const pathBack = findBuilderPath(bot, cand.spot, startStand, session, maxNodes, {
        allowStepDown: true
      });
      if (pathBack !== null) {
        return { spot: cand.spot, pathToChest, pathBack };
      }
    }
  }

  return null;
}

/**
 * Sandığa veya malzeme alanına KESİNTİSİZ ve GÜVENLİ A* rotasıyla gider.
 * Eğer havada asılı inşaat ile sandık arasında uçurum/boşluk varsa (veya geri çıkış yolu yoksa),
 * ASLA hareket etmez ve aşağı düşmez!
 */
async function safelyNavigateToChest(bot, session, targetBlockPos, maxTimeoutMs = 15000, precomputedPath = null) {
  if (!bot || !bot.entity || !bot.entity.position || !targetBlockPos) return false;
  const botPos = bot.entity.position;
  const targetCenter = targetBlockPos.offset(0.5, 0.5, 0.5);
  if (botPos.offset(0, 1.62, 0).distanceTo(targetCenter) <= 3.85) return true;

  let path = precomputedPath;
  if (!path) {
    const route = findSafeTwoWayChestRoute(bot, session, targetBlockPos, 2000);
    if (!route) {
      if (session && session.account) {
        addLog(
          session.account.id,
          'AUTO-BUILDER',
          `⚠️ Sandığa (${targetBlockPos.x}, ${targetBlockPos.y}, ${targetBlockPos.z}) güvenli gidiş-dönüş yolu bulunamadı. Düşmemek için hareket edilmedi.`,
          chalk.yellow
        );
      }
      return false;
    }
    path = route.pathToChest;
  }

  if (!path || path.length === 0) {
    return bot.entity.position.offset(0, 1.62, 0).distanceTo(targetCenter) <= 4.1;
  }

  // Bulunan rotadaki her adımı tam merkez hizalaması (<= 0.24m) ve düşme korumasıyla yürü
  const startTime = Date.now();
  let currentTargetIndex = 0;
  let lastAllowedY = Math.round(bot.entity.position.y);

  try {
    while (currentTargetIndex < path.length && Date.now() - startTime < maxTimeoutMs) {
      if (!session || !session.bot || session.status !== 'online') break;

      const curPos = bot.entity.position;
      const curEye = curPos.offset(0, 1.62, 0);

      // Sandığa yeterince yaklaştıysak (<= 3.75m) ve merkezimiz sağlam zemindeyse dur
      if (curEye.distanceTo(targetCenter) <= 3.75) {
        const floorBelow = bot.blockAt(new Vec3(Math.floor(curPos.x), Math.round(curPos.y) - 1, Math.floor(curPos.z)));
        if (floorBelow && isBlockWalkableFloor(floorBelow, session)) {
          break;
        }
      }

      const targetNode = path[currentTargetIndex];
      const nodeCenter = targetNode.offset(0.5, 0, 0.5);

      // Beklenmeyen düşme koruması (hedef düğümün Y değerinden 1 bloktan fazla aşağı düşüldüyse derhal dur)
      const minStepY = Math.min(lastAllowedY, targetNode.y) - 0.35;
      if (curPos.y < minStepY) {
        bot.setControlState('forward', false);
        bot.setControlState('sneak', true);
        return false;
      }

      const horizDist = Math.hypot(nodeCenter.x - curPos.x, nodeCenter.z - curPos.z);
      if (horizDist <= 0.24 && Math.abs(targetNode.y - curPos.y) <= 0.65) {
        lastAllowedY = targetNode.y;
        currentTargetIndex++;
        continue;
      }

      const dx = nodeCenter.x - curPos.x;
      const dz = nodeCenter.z - curPos.z;
      const targetYaw = Math.atan2(-dx, -dz);

      const isStepDown = targetNode.y < Math.round(curPos.y);
      if (!isSafeToStep(bot, targetYaw, session, { allowStepDown: isStepDown })) {
        bot.setControlState('forward', false);
        bot.setControlState('sprint', false);
        bot.setControlState('sneak', true);
        return false;
      }

      await bot.look(targetYaw, 0, true);
      bot.setControlState('forward', true);
      bot.setControlState('sprint', false);

      // Vulcan güvenli yürüyüş: Yalnızca uçurum/katman kenarına (<0.22m) yaklaşıldığında eğil (sneak),
      // güvenli zemin ve merdiven inişinde normal yürüme hızında ilerle
      const shouldSneak = Boolean(session && session.sneakLock) || (!isStepDown && isBotOverhangingOrNearEdge(bot, session));
      bot.setControlState('sneak', shouldSneak);

      const dy = targetNode.y - curPos.y;
      if (dy >= 0.5 && dy <= 1.25) {
        bot.setControlState('jump', true);
      } else {
        bot.setControlState('jump', false);
      }

      await new Promise((r) => setTimeout(r, 45));
    }
  } finally {
    if (bot) {
      bot.setControlState('forward', false);
      bot.setControlState('sprint', false);
      bot.setControlState('jump', false);
      await stabilizeBotOnBlockCenter(bot, session);
      const keepSneak =
        Boolean(session && session.sneakLock) ||
        isBotOverhangingOrNearEdge(bot, session);
      bot.setControlState('sneak', keepSneak);
    }
  }

  return bot.entity.position.offset(0, 1.62, 0).distanceTo(targetCenter) <= 4.25;
}

async function restockFromNearbyChestsForBuilder(accountId, primaryBlockName = null) {
  const session = sessions.get(accountId);
  if (!session || !session.bot || !session.builder || session.status !== 'online') return false;
  const bot = session.bot;
  const builder = session.builder;

  if (builder.isRestockingNow) return false;
  builder.isRestockingNow = true;

  try {
    const containerNames = new Set([
      'chest',
      'trapped_chest',
      'barrel',
      'shulker_box',
      'white_shulker_box',
      'orange_shulker_box',
      'magenta_shulker_box',
      'light_blue_shulker_box',
      'yellow_shulker_box',
      'lime_shulker_box',
      'pink_shulker_box',
      'gray_shulker_box',
      'light_gray_shulker_box',
      'cyan_shulker_box',
      'purple_shulker_box',
      'blue_shulker_box',
      'brown_shulker_box',
      'green_shulker_box',
      'red_shulker_box',
      'black_shulker_box'
    ]);
    const now = Date.now();

    if (!builder.knownChestPositions) {
      builder.knownChestPositions = new Map();
    }

    const botPos = bot.entity.position;
    const preRestockStand = getEffectiveBotStandBlock(bot, session) || botPos.floored();

    // 96 blok yarıçapındaki tüm sandıkları tara ve hafızaya kaydet
    try {
      const scanned = bot.findBlocks({
        matching: (blk) => blk && containerNames.has(blk.name),
        maxDistance: 80,
        count: 128
      });
      for (const p of scanned) {
        builder.knownChestPositions.set(`${p.x},${p.y},${p.z}`, new Vec3(p.x, p.y, p.z));
      }
    } catch (e) {}

    // Hafızadaki sandıklardan hala dünyada var olanları listele
    const positions = [];
    for (const [key, pos] of builder.knownChestPositions.entries()) {
      const blk = bot.blockAt(pos);
      if (blk && containerNames.has(blk.name)) {
        const dx = Math.abs(pos.x - botPos.x);
        const dz = Math.abs(pos.z - botPos.z);
        const dy = Math.abs(pos.y - botPos.y);
        if (dx <= 75 && dz <= 75 && dy <= 40) {
          positions.push(pos);
        }
      } else if (blk && blk.name === 'air') {
        builder.knownChestPositions.delete(key);
      }
    }

    if (positions.length === 0) {
      builder.statusMessage = `[SANDIK YOK] Çevrede malzeme sandığı bulunamadı.`;
      broadcastState();
      return false;
    }

    // Önce aynı Y katmanındaki ve en yakın olan sandıklardan başla
    positions.sort((a, b) => {
      const aSameY = Math.abs(a.y - preRestockStand.y) <= 1 ? 0 : 1;
      const bSameY = Math.abs(b.y - preRestockStand.y) <= 1 ? 0 : 1;
      if (aSameY !== bSameY) return aSameY - bSameY;
      return botPos.distanceTo(a) - botPos.distanceTo(b);
    });

    const neededMap = getRemainingNeededMaterials(builder);
    if (!primaryBlockName) {
      const firstUnplaced = Array.isArray(builder.blocks) ? builder.blocks.find((b) => !b.placed) : null;
      primaryBlockName = firstUnplaced ? firstUnplaced.name : Object.keys(neededMap)[0] || 'stone';
    }

    let anyChestHadRoute = false;

    for (const pos of positions) {
      const posKey = `${pos.x},${pos.y},${pos.z}`;
      const lastEmpty = builder.recentEmptyChests.get(posKey) || 0;
      if (now - lastEmpty < 8000) continue;

      const eyeDist = bot.entity.position.offset(0, 1.62, 0).distanceTo(pos.offset(0.5, 0.5, 0.5));
      let route = null;

      if (eyeDist > 3.85) {
        if (!builder.autoMove) continue;
        // HAREKET ETMEDEN ÖNCE GÜVENLİ GİDİŞ-DÖNÜŞ YOLU VAR MI KONTROL ET!
        route = findSafeTwoWayChestRoute(bot, session, pos, 2000);
        if (!route) {
          // Bu sandığa güvenli yol yok (uçurum / merdivensiz katman), ASLA gitmeye çalışma!
          continue;
        }
        anyChestHadRoute = true;
        builder.statusMessage = `[SANDIK] "${primaryBlockName}" tazelemek için güvenli yoldan sandığa gidiliyor (${pos.x}, ${pos.y}, ${pos.z})...`;
        broadcastState();

        const reached = await safelyNavigateToChest(
          bot,
          session,
          pos,
          Math.max(5000, Math.min(25000, Math.ceil(route.pathToChest.length * 420))),
          route.pathToChest
        );
        if (!reached) {
          continue;
        }
      } else {
        anyChestHadRoute = true;
      }

      const curEyeDist = bot.entity.position.offset(0, 1.62, 0).distanceTo(pos.offset(0.5, 0.5, 0.5));
      if (curEyeDist > 4.35) {
        continue;
      }

      const chestBlock = bot.blockAt(pos);
      if (!chestBlock) continue;

      let opened = null;
      try {
        opened = await safelyOpenContainer(bot, chestBlock, session);
        const container = opened.container;
        let withdrewAny = false;
        let withdrewPrimary = false;

        const primaryCandidateNames = resolveCandidateItemNamesForBlock(primaryBlockName);

        // 1. ÖNCE acil aranan birincil bloğu (primaryBlockName) çek
        for (let slot = 0; slot < container.inventoryStart; slot++) {
          if (isBotInventoryFull(bot)) break;
          const slotItem = container.slots[slot];
          if (!slotItem) continue;
          const normItem = normalizeBlockName(slotItem.name);
          if (primaryCandidateNames.includes(normItem)) {
            try {
              await withPromiseTimeout(bot.clickWindow(slot, 0, 1), 1600);
              await new Promise((r) => setTimeout(r, 95));
              withdrewAny = true;
              withdrewPrimary = true;
            } catch (e) {
              break;
            }
          }
        }

        // 2. SONRA kalan diğer gerekli şema malzemelerini çek
        for (let slot = 0; slot < container.inventoryStart; slot++) {
          if (isBotInventoryFull(bot)) break;
          const slotItem = container.slots[slot];
          if (!slotItem) continue;
          const normItem = normalizeBlockName(slotItem.name);
          if (primaryCandidateNames.includes(normItem)) continue;

          if (neededMap[normItem] > 0 || neededMap[slotItem.name] > 0) {
            try {
              await withPromiseTimeout(bot.clickWindow(slot, 0, 1), 1600);
              await new Promise((r) => setTimeout(r, 95));
              withdrewAny = true;
            } catch (e) {
              break;
            }
          }
        }

        try {
          container.close();
        } catch (e) {}

        if (withdrewPrimary || withdrewAny) {
          addLog(
            accountId,
            'AUTO-BUILDER',
            `📦 Sandıktan (${pos.x}, ${pos.y}, ${pos.z}) "${primaryBlockName}" ve inşa blokları tazelendi.`,
            chalk.green
          );

          // Sandıktan malzeme aldıktan sonra ayrıldığı inşa noktasına (preRestockStand) güvenle geri dön!
          if (builder.autoMove && route && route.pathBack && route.pathBack.length > 0) {
            builder.statusMessage = `[İNŞA] Malzemeler alındı, inşa noktasına güvenli yoldan dönülüyor...`;
            broadcastState();
            await safelyNavigateToChest(
              bot,
              session,
              preRestockStand,
              Math.max(5000, Math.min(25000, Math.ceil(route.pathBack.length * 420))),
              route.pathBack
            );
          }

          return true;
        }

        if (!withdrewAny) {
          builder.recentEmptyChests.set(posKey, Date.now());
        }
      } catch (err) {
        builder.recentEmptyChests.set(posKey, Date.now());
      } finally {
        if (opened && session.bot && session.status === 'online') {
          await stabilizeBotOnBlockCenter(bot, session);
          const keepSneak =
            Boolean(opened.hadSneakLock || session.sneakLock) ||
            isBotOverhangingOrNearEdge(bot, session);
          try {
            session.bot.setControlState('sneak', keepSneak);
          } catch (e) {}
        }
      }
    }

    if (!anyChestHadRoute && positions.length > 0) {
      builder.statusMessage = `[SANDIK YOLU YOK] Sandık bulundu ancak güvenli gidiş-dönüş yolu yok (düşme koruması nedeniyle gidilmedi).`;
      addLog(
        accountId,
        'AUTO-BUILDER',
        `⚠️ Sandık bulundu ancak güvenli zemin/merdiven yolu olmadığı için düşmemek adına sandığa gidilmedi.`,
        chalk.yellow
      );
      broadcastState();
    }

    return Boolean(findMatchingInventoryItem(bot, primaryBlockName));
  } finally {
    builder.isRestockingNow = false;
  }
}

function isSolidReferenceBlock(refBlock) {
  if (!refBlock || !refBlock.name) return false;
  const name = refBlock.name.toLowerCase();

  // Sıvılar, hava ve içinden geçilen görünmez/ışık blokları
  if (
    name === 'air' ||
    name === 'cave_air' ||
    name === 'void_air' ||
    name === 'water' ||
    name === 'flowing_water' ||
    name === 'lava' ||
    name === 'flowing_lava' ||
    name === 'fire' ||
    name === 'soul_fire' ||
    name === 'light' ||
    name === 'barrier' ||
    name === 'structure_void'
  ) return false;

  // grass_block, dirt_path, farmland, podzol, mycelium gibi zemin blokları KESİNLİKLE katıdır!
  if (
    name === 'grass_block' ||
    name === 'dirt_path' ||
    name === 'grass_path' ||
    name === 'farmland' ||
    name === 'podzol' ||
    name === 'mycelium'
  ) return true;

  // Bounding box boş olan nesneler (çiçek, meşale, ot vb.) tıklanamaz / destek olamaz
  if (refBlock.boundingBox === 'empty') return false;

  // İçinden geçilen ve tıklanmayan bitkiler
  if (
    name === 'grass' ||
    name === 'short_grass' ||
    name === 'tall_grass' ||
    name === 'seagrass' ||
    name === 'tall_seagrass' ||
    name === 'fern' ||
    name === 'large_fern' ||
    name === 'dead_bush' ||
    name === 'vine' ||
    name === 'weeping_vines' ||
    name === 'twisting_vines' ||
    name === 'cave_vines' ||
    name === 'cave_vines_plant' ||
    name === 'sweet_berry_bush' ||
    name === 'kelp' ||
    name === 'kelp_plant' ||
    name === 'sugar_cane' ||
    name === 'tripwire' ||
    name === 'string'
  ) return false;

  return true;
}

/**
 * Vanilla Minecraft BlockHitResult uyumlu yüzey tıklama koordinatı (cursorX, cursorY, cursorZ).
 * - Tıklanan yüzeyin normal ekseninde (face !== 0) koordinat KESİNLİKLE 0.0 veya 1.0 olmalıdır
 *   (0.96 / 0.04 gönderilmesi Vulcan Scaffold Type L / BadPackets InvalidCursor sebebidir!).
 * - Diğer iki teğet eksende (face === 0) ise her blokta tam 0.5 gönderilmesi Vulcan Scaffold Type K
 *   tarafından yakalanır; bu yüzden merkez etrafında [0.36 .. 0.64] aralığında (0.5 olmayan)
 *   insani mikro varyasyon üretilir.
 */
function randomFaceTangentOffset() {
  const sign = Math.random() < 0.5 ? -1 : 1;
  const mag = 0.03 + Math.random() * 0.11; // 0.03 .. 0.14 (asla 0.0 olmaz)
  return Number((0.5 + sign * mag).toFixed(4));
}

function computeStealthFaceDelta(faceVec) {
  const dx = faceVec.x !== 0 ? (0.5 + faceVec.x * 0.5) : randomFaceTangentOffset();
  const dy = faceVec.y !== 0 ? (0.5 + faceVec.y * 0.5) : randomFaceTangentOffset();
  const dz = faceVec.z !== 0 ? (0.5 + faceVec.z * 0.5) : randomFaceTangentOffset();
  return new Vec3(dx, dy, dz);
}

/**
 * Mineflayer'ın physicsTick döngüsüyle tam senkronize bekleme.
 * Windows'un 15.6ms zamanlayıcı çözünürlüğü nedeniyle sabit setTimeout(..., 45) çağrıları
 * çoğu zaman tickPhysics -> updatePosition çalışmadan önce tetiklenir ve sunucuya look paketi
 * gitmeden block_place paketi gönderilmesine (Vulcan Raytrace/Rotation kick) yol açar.
 */
function waitOnePhysicsTick(bot, maxWaitMs = 95) {
  return new Promise((resolve) => {
    if (!bot || typeof bot.once !== 'function') {
      return setTimeout(resolve, 55);
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        bot.removeListener('physicsTick', onTick);
      } catch (e) {}
      // emit('physicsTick') hemen ardından senkron olarak çalışan updatePosition(now)'un
      // look/position_look paketini sokete yazmasını garanti altına almak için 12ms bekle
      setTimeout(resolve, 12);
    };
    const onTick = () => finish();
    const timer = setTimeout(finish, maxWaitMs);
    bot.once('physicsTick', onTick);
  });
}

/**
 * Mineflayer'ın physics.js içindeki iki kritik hatayı (force=false modunda pitch'in
 * lookingTask tarafından yoksayılması + 8.594°/tick sabit hızla GCD bozulması ve
 * force=true modunda physicsTick beklenmeden paket gönderilmesi) tamamen çözen
 * Vulcan GCD & Raytrace uyumlu bakış fonksiyonu.
 */
async function lookAtBlockFaceStealth(bot, clickPos, overrideEyeHeight = null) {
  if (!bot || !bot.entity || !bot.entity.position || !clickPos) return;

  const isSneaking = Boolean(bot.getControlState && bot.getControlState('sneak'));
  const eyeHeight = overrideEyeHeight !== null
    ? overrideEyeHeight
    : (isSneaking ? 1.27 : (bot.entity.eyeHeight || 1.62));
  const eyePos = bot.entity.position.offset(0, eyeHeight, 0);

  const delta = clickPos.minus(eyePos);
  const targetYaw = Math.atan2(-delta.x, -delta.z);
  const groundDistance = Math.sqrt(delta.x * delta.x + delta.z * delta.z);
  const targetPitch = Math.atan2(delta.y, groundDistance);

  // Vanilla %100 fare hassasiyeti GCD adımı (0.15 derece)
  const sensitivity = (0.15 * Math.PI) / 180;
  const halfPi = Math.PI / 2;

  const curYaw = typeof bot.entity.yaw === 'number' ? bot.entity.yaw : targetYaw;
  const curPitch = typeof bot.entity.pitch === 'number' ? bot.entity.pitch : targetPitch;

  let dYaw = (targetYaw - curYaw) % (Math.PI * 2);
  if (dYaw < -Math.PI) dYaw += Math.PI * 2;
  else if (dYaw > Math.PI) dYaw -= Math.PI * 2;
  const dPitch = targetPitch - curPitch;

  const totalAngle = Math.hypot(dYaw, dPitch);

  // Büyük dönüşlerde (> 28 derece) tek tick'te 90-180 derece snap atmamak için
  // 2 tick'lik GCD-kuantize insani ivmeli (ease-out) dönüş uygula
  if (totalAngle > 0.49 && typeof bot.look === 'function') {
    const ratio = 0.58 + Math.random() * 0.10; // ~%63 ilk adım
    const stepYawChange = Math.round((dYaw * ratio) / sensitivity) * sensitivity;
    const stepPitchChange = Math.round((dPitch * ratio) / sensitivity) * sensitivity;
    const midYaw = curYaw + stepYawChange;
    const midPitch = Math.max(-halfPi, Math.min(halfPi, curPitch + stepPitchChange));
    try {
      await bot.look(midYaw, midPitch, true);
    } catch (e) {}
    await waitOnePhysicsTick(bot, 85);
  }

  // Son adım: Tam hedef yüzey noktasına GCD-kuantize kilitlen ve physicsTick'te paketin gönderilmesini bekle
  const nowYaw = typeof bot.entity.yaw === 'number' ? bot.entity.yaw : curYaw;
  const nowPitch = typeof bot.entity.pitch === 'number' ? bot.entity.pitch : curPitch;
  let remYaw = (targetYaw - nowYaw) % (Math.PI * 2);
  if (remYaw < -Math.PI) remYaw += Math.PI * 2;
  else if (remYaw > Math.PI) remYaw -= Math.PI * 2;
  const remPitch = targetPitch - nowPitch;

  const finalYawChange = Math.round(remYaw / sensitivity) * sensitivity;
  const finalPitchChange = Math.round(remPitch / sensitivity) * sensitivity;
  const finalYaw = nowYaw + finalYawChange;
  const finalPitch = Math.max(-halfPi, Math.min(halfPi, nowPitch + finalPitchChange));

  if (typeof bot.look === 'function') {
    try {
      await bot.look(finalYaw, finalPitch, true);
    } catch (e) {}
  } else if (typeof bot.lookAt === 'function') {
    try {
      await bot.lookAt(clickPos, true);
    } catch (e) {}
  }

  // Sunucuya look / position_look paketinin kesin olarak gönderildiğinden emin ol
  await waitOnePhysicsTick(bot, 95);
}

function findPlaceReferenceBlock(bot, targetPos, builder = null) {
  if (!bot || !targetPos) return null;

  // Hedef pozisyonda zaten katı bir blok varsa yerleştirilemez
  const currentAtTarget = bot.blockAt(targetPos);
  if (currentAtTarget && isSolidReferenceBlock(currentAtTarget)) {
    return null;
  }

  const isSneaking = Boolean(bot.getControlState && bot.getControlState('sneak'));
  const eyeHeight = isSneaking ? 1.27 : ((bot.entity && bot.entity.eyeHeight) || 1.62);
  const eyePos = (bot.entity && bot.entity.position)
    ? bot.entity.position.offset(0, eyeHeight, 0)
    : targetPos.offset(0.5, 2.0, 0.5);

  const neighbors = [
    { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },
    { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
    { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) },
    { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },
    { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },
    { offset: new Vec3(0, 1, 0), face: new Vec3(0, -1, 0) }
  ];

  const valid = [];
  for (const n of neighbors) {
    const refPos = targetPos.plus(n.offset);
    const refBlock = bot.blockAt(refPos);
    if (isSolidReferenceBlock(refBlock)) {
      const faceCenter = refPos.offset(
        0.5 + n.face.x * 0.5,
        0.5 + n.face.y * 0.5,
        0.5 + n.face.z * 0.5
      );
      const toEye = eyePos.minus(faceCenter);
      const dist = toEye.norm();
      const dot = dist > 0.001
        ? (toEye.x * n.face.x + toEye.y * n.face.y + toEye.z * n.face.z) / dist
        : 1;
      valid.push({
        refBlock,
        faceVec: n.face,
        dist,
        dot,
        isTopFace: n.face.y === 1
      });
    }
  }

  if (valid.length === 0) return null;

  // Botun gözüne dönük (dot > -0.05, yani bloğun arka yüzünde kalmayan) ve üst yüzey (0, 1, 0) olan komşuları seç
  valid.sort((a, b) => {
    const aVisible = a.dot > -0.05 ? 1 : 0;
    const bVisible = b.dot > -0.05 ? 1 : 0;
    if (aVisible !== bVisible) return bVisible - aVisible;
    if (a.isTopFace !== b.isTopFace) return a.isTopFace ? -1 : 1;
    return b.dot - a.dot;
  });

  return { refBlock: valid[0].refBlock, faceVec: valid[0].faceVec, dot: valid[0].dot };
}

function startBuilderContinuousRestockLoop(accountId) {
  const session = sessions.get(accountId);
  if (!session) return;
  if (!session.builder) session.builder = createDefaultBuilderState();
  const builder = session.builder;

  if (session.builderRestockTimer) {
    clearTimeout(session.builderRestockTimer);
    session.builderRestockTimer = null;
  }

  if (!builder.autoRestockChest) return;

  const tick = async () => {
    session.builderRestockTimer = null;
    if (!session.builder || !session.builder.autoRestockChest) return;

    // Eğer aktif inşa (status === 'building') çalışıyorsa sandık tedariğini zaten runAutoBuilderStep yönetir;
    // ancak inşa duraklatılmış veya beklemedeyse (idle/paused) ve şema yüklüyse eksik malzemeleri otomatik çeker.
    if (
      session.status === 'online' &&
      session.bot &&
      session.builder.status !== 'building' &&
      !session.builder.isStepBusy &&
      !session.builder.isRestockingNow &&
      Array.isArray(session.builder.blocks) &&
      session.builder.blocks.length > 0 &&
      !isBotInventoryFull(session.bot)
    ) {
      const neededMap = getRemainingNeededMaterials(session.builder);
      let missingBlockName = null;
      for (const [bName, neededCount] of Object.entries(neededMap)) {
        if (neededCount <= 0) continue;
        let haveCount = 0;
        const cands = resolveCandidateItemNamesForBlock(bName);
        for (const it of session.bot.inventory.items()) {
          if (cands.includes(normalizeBlockName(it.name))) {
            haveCount += it.count;
          }
        }
        if (haveCount < neededCount) {
          missingBlockName = bName;
          break;
        }
      }

      if (missingBlockName) {
        try {
          await restockFromNearbyChestsForBuilder(accountId, missingBlockName);
          broadcastState();
        } catch (e) {}
      }
    }

    if (session.builder && session.builder.autoRestockChest) {
      session.builderRestockTimer = setTimeout(tick, 4500);
    }
  };

  session.builderRestockTimer = setTimeout(tick, 300);
}

function stopBuilderContinuousRestockLoop(accountId) {
  const session = sessions.get(accountId);
  if (!session) return;
  if (session.builderRestockTimer) {
    clearTimeout(session.builderRestockTimer);
    session.builderRestockTimer = null;
  }
}

function scheduleNextBuilderStep(accountId, customDelayMs) {
  const session = sessions.get(accountId);
  if (!session || !session.builder || session.builder.status !== 'building') return;
  if (session.builderTimer) clearTimeout(session.builderTimer);
  const safeDelay = Math.max(250, Number(session.builder.delayMs) || 270);
  const delay = typeof customDelayMs === 'number' ? customDelayMs : safeDelay;
  session.builderTimer = setTimeout(() => {
    runAutoBuilderStep(accountId);
  }, delay);
}

async function runAutoBuilderStep(accountId) {
  const session = sessions.get(accountId);
  if (!session || !session.builder || session.builder.status !== 'building') return;
  const builder = session.builder;

  if (!session.bot || session.status !== 'online' || !session.bot.entity) {
    builder.statusMessage = 'Bot çevrimiçi değil, bağlantı bekleniyor...';
    broadcastState();
    scheduleNextBuilderStep(accountId, 1500);
    return;
  }

  // Asenkron kilit (isStepBusy) için 15 saniyelik watchdog koruması:
  // Herhangi bir paket veya promise yanıt vermezse botun sonsuza dek donmasını engeller.
  if (builder.isStepBusy && Date.now() - (builder.stepStartedAt || 0) > 15000) {
    builder.isStepBusy = false;
  }

  if (builder.isStepBusy || session.isEating || session.isDepositing || session.isDropping || session.isSolvingCaptcha) {
    scheduleNextBuilderStep(accountId, 250);
    return;
  }

  builder.isStepBusy = true;
  builder.stepStartedAt = Date.now();
  const bot = session.bot;

  try {
    // 0. placedMap ve failedAttemptsMap haritalarını hazırla
    if (!builder.placedMap) {
      builder.placedMap = new Map();
    }
    if (!builder.failedAttemptsMap) {
      builder.failedAttemptsMap = new Map();
    }
    if (builder.placedMap.size === 0 && Array.isArray(builder.blocks)) {
      for (const b of builder.blocks) {
        if (b.placed) {
          builder.placedMap.set(`${builder.origin.x + b.x},${builder.origin.y + b.y},${builder.origin.z + b.z}`, b.name);
        }
      }
    }

    // 1. Henüz yerleştirilmemiş blokları tespit et
    const unplaced = builder.blocks.filter((b) => !b.placed);
    if (unplaced.length === 0) {
      builder.status = 'completed';
      builder.currentBlock = null;
      builder.currentIndex = builder.blocks.length;
      builder.statusMessage = `[TAMAMLANDI] İnşa tamamlandı. Toplam ${builder.placedCount}/${builder.totalBlocks} blok başarıyla yerleştirildi.`;
      addLog(
        accountId,
        'AUTO-BUILDER',
        `"${builder.schematicName}" inşası tamamlandı! (${builder.placedCount} blok)`,
        chalk.green
      );

      const chainAcc = config.accounts.find((a) => a.id === accountId);
      const chainEnabled = builder.autoChainTillPlant !== false && !(chainAcc && chainAcc.autoChainTillPlant === false);
      if (chainEnabled) {
        if (session.autoMine) {
          stopAutoMineLoop(accountId);
          session.autoMine = false;
        }
        if (session.autoFarm) {
          stopAutoFarmLoop(accountId);
          session.autoFarm = false;
        }
        session.autoTill = true;
        builder.statusMessage = `[OTO-ÇAPALAMA AKTİF] İnşa tamamlandı (${builder.placedCount} blok). Zincirleme Çapalama yapılıyor...`;
        addLog(
          accountId,
          'OTO-ZİNCİR',
          `🔄 "${builder.schematicName}" inşası tamamlandı! Zincirleme Otomatik Çapalama başlatılıyor...`,
          chalk.cyanBright
        );
        setTimeout(() => {
          const cur = sessions.get(accountId);
          if (cur && cur.status === 'online' && cur.autoTill) {
            startAutoTillLoop(accountId);
            broadcastState();
          }
        }, 500);
      }

      broadcastState();
      return;
    }

    // 2. Aktif Y katmanını bul (en alttaki katmandan başlar)
    const activeY = unplaced[0].y;
    const layerBlocks = unplaced.filter((b) => b.y === activeY);

    // 3. Aktif katmandaki bloklardan dünyada zaten var olanları hızlıca placed = true yap
    for (const b of layerBlocks) {
      const worldPos = new Vec3(
        builder.origin.x + b.x,
        builder.origin.y + b.y,
        builder.origin.z + b.z
      );
      const existing = bot.blockAt(worldPos);
      if (existing && isSamePlacedBlock(existing.name, b.name)) {
        b.placed = true;
        builder.placedCount++;
        const posKey = `${worldPos.x},${worldPos.y},${worldPos.z}`;
        builder.placedMap.set(posKey, b.name);
        builder.failedAttemptsMap.delete(posKey);
      }
    }

    // Dünya kontrolünden sonra kalanlar
    const remainingInLayer = layerBlocks.filter((b) => !b.placed);
    if (remainingInLayer.length === 0) {
      // Katmandaki tüm bloklar bitti, sonraki katmana geç
      scheduleNextBuilderStep(accountId, 80);
      return;
    }

    // 4. Bu katmanda destek/komşu bloğu olan adayları tespit et
    const eyePos = bot.entity.position.offset(0, 1.62, 0);
    const supportedList = [];
    const now = Date.now();

    for (const b of remainingInLayer) {
      const targetPos = new Vec3(
        builder.origin.x + b.x,
        builder.origin.y + b.y,
        builder.origin.z + b.z
      );
      const refInfo = findPlaceReferenceBlock(bot, targetPos, builder);
      if (refInfo) {
        const face = refInfo.faceVec;
        const faceCenter = refInfo.refBlock.position.offset(
          0.5 + face.x * 0.5,
          0.5 + face.y * 0.5,
          0.5 + face.z * 0.5
        );
        const dist = eyePos.distanceTo(faceCenter);
        const posKey = `${targetPos.x},${targetPos.y},${targetPos.z}`;
        const failInfo = builder.failedAttemptsMap.get(posKey);
        const recentlyFailed = Boolean(failInfo && (now - failInfo.lastFailTime < 2500));
        supportedList.push({ blk: b, targetPos, clickPos: faceCenter, refInfo, dist, recentlyFailed });
      }
    }

    // 5. Botun şu anki duruşundan uzanabileceği destekli blok adaylarını tespit et
    const curEye = bot.entity.position.offset(0, 1.62, 0);
    const candidates = [];

    for (const b of remainingInLayer) {
      if (b.placed) continue;
      const targetPos = new Vec3(
        builder.origin.x + b.x,
        builder.origin.y + b.y,
        builder.origin.z + b.z
      );
      const refInfo = findPlaceReferenceBlock(bot, targetPos, builder);
      if (refInfo) {
        const refPos = refInfo.refBlock.position;
        const face = refInfo.faceVec;
        const deltaPos = computeStealthFaceDelta(face);
        const clickPos = refPos.plus(deltaPos);
        const dist = curEye.distanceTo(clickPos);
        if (dist >= 0.45 && dist <= 3.90) {
          const isBotInside = doesBotIntersectBlock(bot.entity.position, targetPos, 0.36);
          const posKey = `${targetPos.x},${targetPos.y},${targetPos.z}`;
          const failInfo = builder.failedAttemptsMap.get(posKey);
          const recentlyFailed = Boolean(failInfo && (now - failInfo.lastFailTime < 2500));
          const faceOccluded = typeof refInfo.dot === 'number' && refInfo.dot < -0.15;
          candidates.push({
            blk: b,
            targetPos,
            clickPos,
            deltaPos,
            refInfo,
            dist,
            isBotInside,
            recentlyFailed,
            faceOccluded
          });
        }
      }
    }

    if (candidates.length > 0) {
      // Sıralama:
      // 1. Botun hitbox'ı ile kesişmeyen bloklar önce
      // 2. Son 2.5 saniyede başarısız olmamış bloklar önce
      // 3. Tıklanacak yüzeyi bota doğrudan dönük olanlar (faceOccluded === false) önce
      // 4. En yakın mesafedeki blok önce
      candidates.sort((a, b) => {
        if (a.isBotInside !== b.isBotInside) return a.isBotInside ? 1 : -1;
        if (a.recentlyFailed !== b.recentlyFailed) return a.recentlyFailed ? 1 : -1;
        if (a.faceOccluded !== b.faceOccluded) return a.faceOccluded ? 1 : -1;
        return a.dist - b.dist;
      });

      const target = candidates[0];
      const blk = target.blk;
      const targetPos = target.targetPos;
      let clickPos = target.clickPos;
      let deltaPos = target.deltaPos;
      let refInfo = target.refInfo;
      const posKey = `${targetPos.x},${targetPos.y},${targetPos.z}`;

      builder.currentBlock = {
        x: targetPos.x,
        y: targetPos.y,
        z: targetPos.z,
        name: blk.name,
        layerY: blk.y
      };

      // Envanter kontrolü ve otomatik sandığa dönüş
      if (!builder.lastChestFailByBlock) {
        builder.lastChestFailByBlock = new Map();
      }
      let invItem = findMatchingInventoryItem(bot, blk.name);
      const lastFailAt = builder.lastChestFailByBlock.get(blk.name) || 0;
      if (!invItem && builder.autoRestockChest && (Date.now() - lastFailAt > 5000)) {
        builder.statusMessage = `[SANDIK] Envanterde "${blk.name}" bitti, sandığa dönülüyor...`;
        broadcastState();
        await restockFromNearbyChestsForBuilder(accountId, blk.name);
        invItem = findMatchingInventoryItem(bot, blk.name);
        if (invItem) {
          builder.lastChestFailByBlock.delete(blk.name);
        } else {
          builder.lastChestFailByBlock.set(blk.name, Date.now());
        }
      }

      if (!invItem) {
        // Çevrede (aynı katmanda <= 3.5m mesafe) yere atılmış eşya var mı?
        const dropped = findNearbyDroppedItem(bot, 3.5);
        if (dropped && Math.abs(dropped.position.y - bot.entity.position.y) <= 0.55) {
          builder.statusMessage = `[TOPLAMA] Aynı katmandaki yere atılan eşya toplanıyor...`;
          broadcastState();
          await stepMoveBotTowards(bot, dropped.position, 320);
          scheduleNextBuilderStep(accountId, 120);
          return;
        }

        if (builder.skipMissingBlocks) {
          addLog(accountId, 'AUTO-BUILDER', `"${blk.name}" bulunamadığı için atlandı (${targetPos.x}, ${targetPos.y}, ${targetPos.z}).`, chalk.yellow);
          blk.placed = true;
          builder.placedCount++;
          scheduleNextBuilderStep(accountId, 100);
          return;
        } else {
          builder.statusMessage = `[BEKLENİYOR] "${blk.name}" bloğu bitti. Envantere atın veya güvenli yoldaki sandığa ekleyin.`;
          broadcastState();
          scheduleNextBuilderStep(accountId, 1000);
          return;
        }
      }

      // Botun 0.6 genişliğindeki AABB hitbox'ı hedef bloğun içine giriyorsa AYNI KATMANDAKİ güvenli bir komşu bloğa çekil
      if (doesBotIntersectBlock(bot.entity.position, targetPos, 0.36)) {
        const botFloored = getEffectiveBotStandBlock(bot, session) || bot.entity.position.floored();
        bot.setControlState('sneak', true);
        const escapeDirs = [
          new Vec3(0, 0, -1),
          new Vec3(0, 0, 1),
          new Vec3(-1, 0, 0),
          new Vec3(1, 0, 0),
          new Vec3(-1, 0, -1),
          new Vec3(1, 0, -1),
          new Vec3(-1, 0, 1),
          new Vec3(1, 0, 1)
        ];
        let escapeTarget = null;
        for (const d of escapeDirs) {
          const p = botFloored.plus(d);
          if (
            p.y === botFloored.y &&
            !doesBotIntersectBlock(p.offset(0.5, 0, 0.5), targetPos, 0.40) &&
            isWalkablePosition(bot, p, session)
          ) {
            escapeTarget = p;
            break;
          }
        }
        if (escapeTarget) {
          await walkBotAlongPath(bot, session, [escapeTarget], 650, null, { allowStepDown: false });
        } else {
          const backYaw = (bot.entity.yaw || 0) + Math.PI;
          if (isSafeToStep(bot, backYaw, session, { allowStepDown: false })) {
            bot.setControlState('back', true);
            await new Promise((r) => setTimeout(r, 150));
            bot.setControlState('back', false);
          }
        }
        await stabilizeBotOnBlockCenter(bot, session);
        const keepSneak = Boolean(session.sneakLock) || isBotOverhangingOrNearEdge(bot, session);
        bot.setControlState('sneak', keepSneak);

        // Geri çekildikten sonra hala bloğun içindeyse bu adımı zorlama, sonraki adımda yeniden konumlan
        if (doesBotIntersectBlock(bot.entity.position, targetPos, 0.32)) {
          const prevFail = builder.failedAttemptsMap.get(posKey) || { count: 0, lastFailTime: 0 };
          builder.failedAttemptsMap.set(posKey, { count: prevFail.count + 1, lastFailTime: Date.now() });
          scheduleNextBuilderStep(accountId, 260);
          return;
        }

        // Bot hareket ettiği için referans bloğu ve tıklama noktasını güncel konumdan yeniden hesapla
        const updatedRef = findPlaceReferenceBlock(bot, targetPos, builder);
        if (updatedRef) {
          refInfo = updatedRef;
          deltaPos = computeStealthFaceDelta(refInfo.faceVec);
          clickPos = refInfo.refBlock.position.plus(deltaPos);
        }
      }

      // Engel temizleme
      const currentAtTarget = bot.blockAt(targetPos);
      if (
        currentAtTarget &&
        currentAtTarget.name !== 'air' &&
        currentAtTarget.name !== 'cave_air' &&
        currentAtTarget.name !== 'void_air' &&
        currentAtTarget.name !== 'water' &&
        currentAtTarget.name !== 'lava' &&
        !isSamePlacedBlock(currentAtTarget.name, blk.name)
      ) {
        if (builder.clearObstacles && isDiggableTargetBlock(currentAtTarget)) {
          builder.statusMessage = `[KAZIM] Engel blok kırılıyor: ${currentAtTarget.name} (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`;
          broadcastState();
          await equipBestToolForBlock(bot, currentAtTarget, true);
          await withPromiseTimeout(bot.dig(currentAtTarget), 4500);
        }
      }

      // Bloğu eline al (Önce hotbar slot geçişi + güvenli equip)
      await safelyEquipBlockForBuilder(bot, session, invItem);

      // VULCAN ANTI-CHEAT KUSURSUZ GİZLİLİK VE PAKET KORUMASI (v30):
      // 1. Blok koymadan önce tüm yürüme/zıplama/koşma tuşlarını tamamen durdur.
      const wasMoving = Boolean(
        bot.getControlState &&
        (bot.getControlState('forward') ||
          bot.getControlState('back') ||
          bot.getControlState('left') ||
          bot.getControlState('right') ||
          bot.getControlState('jump') ||
          bot.getControlState('sprint'))
      );
      bot.setControlState('forward', false);
      bot.setControlState('back', false);
      bot.setControlState('left', false);
      bot.setControlState('right', false);
      bot.setControlState('jump', false);
      bot.setControlState('sprint', false);
      if (wasMoving) {
        await waitOnePhysicsTick(bot, 80);
      }

      // 2. Her blokta sneak aç-kapa YAPMA! (Vulcan Scaffold Type E/F/J Eagle-AutoSneak tespiti +
      // 1.62 vs 1.27 eyeHeight kaymasını önler). Sadece referans blok sandık/fırın gibi
      // sağ tıklanınca GUI açılan interaktif bir bloksa sneak aç!
      const refName = refInfo.refBlock && refInfo.refBlock.name ? refInfo.refBlock.name.toLowerCase() : '';
      const needsInteractiveSneak = INTERACTIVE_CONTAINERS_SET.has(refName);
      let sneakTurnedOnForPlace = false;
      if (needsInteractiveSneak && !(bot.getControlState && bot.getControlState('sneak'))) {
        bot.setControlState('sneak', true);
        sneakTurnedOnForPlace = true;
        await waitOnePhysicsTick(bot, 80);
      }

      // 3. Vulcan Kusursuz Raytrace & GCD Bakış:
      // Tıklama yüzeyi üzerinde tam 0.0/1.0 düzlemine ve organik teğet noktasına kilitlen,
      // look paketinin sunucuya physicsTick ile gönderilmesini bekle.
      const activeEyeHeight = (needsInteractiveSneak || (bot.getControlState && bot.getControlState('sneak'))) ? 1.27 : 1.62;
      await lookAtBlockFaceStealth(bot, clickPos, activeEyeHeight);

      const heldSlotBefore =
        bot.heldItem && typeof bot.heldItem.slot === 'number'
          ? bot.heldItem.slot
          : 36 + (typeof bot.quickBarSlot === 'number' ? bot.quickBarSlot : 0);
      const heldCountBefore =
        bot.heldItem && typeof bot.heldItem.count === 'number' ? bot.heldItem.count : 0;

      let placedSuccess = false;
      try {
        // 4. Paket sırası: Önce block_place gönder (swingArm: false!), hemen ardından arm_animation
        if (typeof bot._genericPlace === 'function') {
          await bot._genericPlace(refInfo.refBlock, refInfo.faceVec, {
            swingArm: false,
            forceLook: 'ignore',
            delta: deltaPos
          });
        } else {
          await bot.placeBlock(refInfo.refBlock, refInfo.faceVec);
        }

        // Vanilla el sallama (use_item_on paketinden hemen sonra)
        try {
          bot.swingArm('right');
        } catch (e) {}

        // 5. Sunucunun bloğu onaylamasını bekle (Ghost block / Scaffold Type D koruması)
        const confirmed = await waitForBlockPlacement(bot, targetPos, blk.name, 400);
        if (confirmed) {
          blk.placed = true;
          builder.placedCount++;
          placedSuccess = true;
          builder.placedMap.set(posKey, blk.name);
          builder.failedAttemptsMap.delete(posKey);
          if (session.stats) {
            session.stats.blocksPlaced = (session.stats.blocksPlaced || 0) + 1;
          }
        }
      } catch (placeErr) {
        const afterBlock = bot.blockAt(targetPos);
        if (afterBlock && isSamePlacedBlock(afterBlock.name, blk.name)) {
          blk.placed = true;
          builder.placedCount++;
          placedSuccess = true;
          builder.placedMap.set(posKey, blk.name);
          builder.failedAttemptsMap.delete(posKey);
        }
      } finally {
        if (sneakTurnedOnForPlace && !session.sneakLock && !isBotOverhangingOrNearEdge(bot, session)) {
          bot.setControlState('sneak', false);
        }
      }

      if (placedSuccess) {
        // KRİTİK 1.17.1+ / 1.20+ ENVANTER YIĞIN (64 BLOK) SENKRONİZASYONU:
        const isCreative = Boolean(bot.game && bot.game.gameMode === 'creative');
        if (!isCreative && bot.inventory && Array.isArray(bot.inventory.slots)) {
          const curSlotItem = bot.inventory.slots[heldSlotBefore] || bot.heldItem;
          if (curSlotItem && heldCountBefore > 0 && curSlotItem.count === heldCountBefore) {
            if (curSlotItem.count > 1) {
              curSlotItem.count -= 1;
            } else {
              if (typeof bot.inventory.updateSlot === 'function') {
                bot.inventory.updateSlot(heldSlotBefore, null);
              } else {
                bot.inventory.slots[heldSlotBefore] = null;
              }
              syncBotInventoryWithServer(bot);
            }
          }
        }

        builder.statusMessage = `[İNŞA] Blok yerleştirildi: ${blk.name} (${targetPos.x}, ${targetPos.y}, ${targetPos.z}) • Toplam: ${builder.placedCount}/${builder.totalBlocks}`;
        broadcastState();

        // Vulcan FastPlace koruması: Doğal insan tıklama aralığı (270ms - 335ms) + organik insan jitter
        const baseDelay = Math.max(260, Number(builder.delayMs) || 280);
        const jitter = Math.floor(Math.random() * 55);
        scheduleNextBuilderStep(accountId, baseDelay + jitter);
        return;
      } else {
        // Yerleştirme sunucu tarafından onaylanmadıysa ASLA 50ms'lik Step 6 döngüsüne düşüp
        // aynı bloğa paket spamleme! Başarısızlığı kaydet ve gerekiyorsa duruş noktasını değiştir.
        const prevFail = builder.failedAttemptsMap.get(posKey) || { count: 0, lastFailTime: 0 };
        const nextCount = prevFail.count + 1;
        builder.failedAttemptsMap.set(posKey, { count: nextCount, lastFailTime: Date.now() });

        if (nextCount >= 2) {
          // Sunucu ile istemci arasında olası envanter/slot senkron kaybını gider
          syncBotInventoryWithServer(bot);
          if (builder.autoMove) {
            const altSpot = findBuilderStandingSpot(bot, targetPos, session, { excludeCurrentSpot: true });
            if (altSpot && altSpot.spot) {
              const altPath = Array.isArray(altSpot.path) && altSpot.path.length > 0 ? altSpot.path : [altSpot.spot];
              await walkBotAlongPath(bot, session, altPath, 1600, null, { allowStepDown: false });
            }
          }
        }

        if (nextCount >= 6 && builder.skipMissingBlocks) {
          addLog(accountId, 'AUTO-BUILDER', `Blok sunucu tarafından 6 kez reddedildiği için atlandı: ${blk.name} (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`, chalk.yellow);
          blk.placed = true;
          builder.placedCount++;
          builder.failedAttemptsMap.delete(posKey);
        }

        scheduleNextBuilderStep(accountId, 380);
        return;
      }
    }

    // 6. Uzanma mesafesinde supported blok yok ama katmanda başka destekli bloklar var:
    if (supportedList.length > 0) {
      supportedList.sort((a, b) => {
        if (a.recentlyFailed !== b.recentlyFailed) return a.recentlyFailed ? 1 : -1;
        return a.dist - b.dist;
      });

      // Uzaktaki bloğa yürümeden ÖNCE envanterde o bloğun olup olmadığını kontrol et;
      // eğer blok bittiyse boşuna uzağa yürümek yerine önce sandığa gidip tazele!
      const nextWantedName = supportedList[0].blk.name;
      if (!findMatchingInventoryItem(bot, nextWantedName) && builder.autoRestockChest) {
        if (!builder.lastChestFailByBlock) builder.lastChestFailByBlock = new Map();
        const lastFailAt = builder.lastChestFailByBlock.get(nextWantedName) || 0;
        if (Date.now() - lastFailAt > 5000) {
          builder.statusMessage = `[SANDIK] Envanterde "${nextWantedName}" bitti, sandığa dönülüyor...`;
          broadcastState();
          await restockFromNearbyChestsForBuilder(accountId, nextWantedName);
          if (findMatchingInventoryItem(bot, nextWantedName)) {
            builder.lastChestFailByBlock.delete(nextWantedName);
            scheduleNextBuilderStep(accountId, 120);
            return;
          } else {
            builder.lastChestFailByBlock.set(nextWantedName, Date.now());
          }
        }
      }

      let moved = false;
      if (builder.autoMove) {
        // En yakın destekli bloklardan başlayarak AYNI KATMANDA rotası olan İLK bloğu bul ve ona yürü
        for (let i = 0; i < Math.min(supportedList.length, 40); i++) {
          const candTarget = supportedList[i];
          const standResult = findBuilderStandingSpot(bot, candTarget.targetPos, session);
          if (standResult) {
            builder.statusMessage = `[HAREKET] Hedef bloğa yaklaşılıyor: (${candTarget.targetPos.x}, ${candTarget.targetPos.y}, ${candTarget.targetPos.z}) [${candTarget.blk.name}]`;
            broadcastState();
            const prePath =
              Array.isArray(standResult.path) && standResult.path.length > 0
                ? standResult.path
                : standResult.spot
                  ? [standResult.spot]
                  : null;
            await builderMoveTowardsBlock(bot, session, candTarget.targetPos, 2400, prePath);
            moved = true;
            scheduleNextBuilderStep(accountId, 140);
            return;
          }
        }
      }

      if (!moved) {
        builder.statusMessage = `[ERİŞİM] Katmandaki ${supportedList.length} destekli bloğa güvenli yürüyüş yolu aranıyor...`;
        broadcastState();
        scheduleNextBuilderStep(accountId, 1200);
        return;
      }
    }

    // 7. Bu katmanda henüz hiçbir bloğun komşu/zemin desteği yoksa:
    // Alt katmanda (activeY - 1) kalan blok var mı kontrol et
    const missedLower = builder.blocks.find((b) => b.y < activeY && !b.placed);
    if (missedLower) {
      // Alt katmana geri dön
      scheduleNextBuilderStep(accountId, 60);
      return;
    }

    // Alt katman yok ve bu katmanda hiçbir blok destek bulamıyorsa:
    if (builder.skipMissingBlocks) {
      const firstSkipped = remainingInLayer[0];
      const targetPos = new Vec3(
        builder.origin.x + firstSkipped.x,
        builder.origin.y + firstSkipped.y,
        builder.origin.z + firstSkipped.z
      );
      addLog(accountId, 'AUTO-BUILDER', `Destek bulunamadığı için atlandı: ${firstSkipped.name} (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`, chalk.yellow);
      firstSkipped.placed = true;
      builder.placedCount++;
      broadcastState();
      scheduleNextBuilderStep(accountId, 80);
      return;
    } else {
      builder.statusMessage = `[DESTEK BEKLENİYOR] Katman Y=${activeY} için zemin/destek blok bulunamadı. Lütfen bir destek bloğu yerleştirin veya 'Eksik Blokları Atla'yı açın.`;
      broadcastState();
      scheduleNextBuilderStep(accountId, 2000);
      return;
    }
  } catch (err) {
    builder.statusMessage = `[HATA] İnşa adımı hatası: ${err.message}`;
    broadcastState();
    scheduleNextBuilderStep(accountId, 800);
  } finally {
    // Senkronize et
    const firstUnplacedIdx = builder.blocks.findIndex((b) => !b.placed);
    builder.currentIndex = firstUnplacedIdx === -1 ? builder.blocks.length : firstUnplacedIdx;
    builder.isStepBusy = false;
  }
}

// --- 6. SOHBET CAPTCHA & AFK MATEMATİK ÇÖZÜCÜ ---
function handleCaptchaAndMath(accountId, text) {
  if (config.autoCaptcha && config.autoCaptcha.enabled === false) return;
  const session = sessions.get(accountId);
  const acc = config.accounts.find((a) => a.id === accountId);
  if (!session || !session.bot || !acc || session.status !== 'online') return;
  if (acc.autoCaptcha === false) return;

  const now = Date.now();
  if (now - (session.lastCaptchaTime || 0) < 3500) return;

  // Botun kendi mesajlarını yoksay
  const lower = text.toLowerCase();
  const uLower = acc.username.toLowerCase();
  if (lower.startsWith(`<${uLower}>`) || lower.startsWith(`${uLower}:`) || lower.startsWith(`[${uLower}]`)) {
    return;
  }

  // 1. Matematik Sorusu Algılama (Örn: "7 + 5 = ?", "12 * 3 kaçtır", "AFK doğrulama: 18 - 9")
  const hasMathContext =
    lower.includes('=?') ||
    lower.includes('= ?') ||
    lower.includes('kaçtır') ||
    lower.includes('kactir') ||
    lower.includes('sonuç') ||
    lower.includes('sonuc') ||
    lower.includes('işlem') ||
    lower.includes('islem') ||
    lower.includes('cevap') ||
    lower.includes('doğrula') ||
    lower.includes('dogrula') ||
    lower.includes('captcha') ||
    lower.includes('afk') ||
    lower.includes('solve') ||
    lower.includes('math');

  const mathMatch = text.match(/(?:^|[^\d/])(\d{1,4})\s*([+\-*xX×÷/])\s*(\d{1,4})(?:\s*=\s*\?|\b)/);
  if (mathMatch && (hasMathContext || text.includes('= ?') || text.includes('=?'))) {
    const a = Number(mathMatch[1]);
    const op = mathMatch[2].toLowerCase();
    const b = Number(mathMatch[3]);
    let ans = null;
    if (op === '+') ans = a + b;
    else if (op === '-') ans = a - b;
    else if (op === '*' || op === 'x' || op === '×') ans = a * b;
    else if ((op === '/' || op === '÷') && b !== 0 && a % b === 0) ans = a / b;

    if (ans !== null) {
      session.lastCaptchaTime = now;
      const ansStr = String(ans);
      setTimeout(() => {
        if (!session.bot || session.status !== 'online') return;
        addLog(accountId, 'OTO-CAPTCHA', `Matematik doğrulaması çözüldü (${a} ${op} ${b} = ${ansStr})`, chalk.greenBright);
        sendChatSafely(accountId, ansStr);
        if (session.stats) {
          session.stats.captchasSolved = (session.stats.captchasSolved || 0) + 1;
          broadcastState();
        }
        triggerSoundAlert('captcha', accountId, `Matematik sorusu çözüldü: ${ansStr}`);
        sendDesktopNotification('Captcha Çözüldü', `[${acc.username}] Matematik sorusu çözüldü: ${ansStr}`, accountId);
        if (!config.discord || config.discord.notifyCaptcha !== false) {
          sendDiscordWebhook('[BILGI] Otomatik Captcha Çözüldü', `Soru: \`${text}\`\nGönderilen Cevap: \`${ansStr}\``, 0x2af598, accountId);
        }
      }, 1250);
      return;
    }
  }

  // 2. Metin / Kod Captcha Algılama (Örn: "Doğrulamak için 'X9A2' yazın", "AFK kontrolü: [B7K4] kodunu sohbete yaz")
  const codePatterns = [
    /(?:doğrulamak|dogrulamak|afk|kontrol|captcha).*?(?:için|icin|:)\s*["'\[({]([a-zA-Z0-9]{3,12})["'\])}]/i,
    /["'\[({]([a-zA-Z0-9]{3,12})["'\])}]\s*(?:kodunu|kelimesini|metnini)\s*(?:sohbete\s*)?(?:yaz|gönder|gir)/i,
    /(?:type|write|enter)\s+["'\[({]([a-zA-Z0-9]{3,12})["'\])}]\s+(?:in\s+chat|to\s+verify)/i
  ];

  for (const pat of codePatterns) {
    const cm = text.match(pat);
    if (cm && cm[1]) {
      const code = cm[1];
      if (code.toLowerCase() === 'login' || code.toLowerCase() === 'register') continue;
      session.lastCaptchaTime = now;
      setTimeout(() => {
        if (!session.bot || session.status !== 'online') return;
        addLog(accountId, 'OTO-CAPTCHA', `Doğrulama kodu algılandı ve gönderildi -> ${code}`, chalk.greenBright);
        sendChatSafely(accountId, code);
        if (session.stats) {
          session.stats.captchasSolved = (session.stats.captchasSolved || 0) + 1;
          broadcastState();
        }
        triggerSoundAlert('captcha', accountId, `Captcha kodu çözüldü: ${code}`);
        sendDesktopNotification('Captcha Çözüldü', `[${acc.username}] Kod gönderildi: ${code}`, accountId);
        if (!config.discord || config.discord.notifyCaptcha !== false) {
          sendDiscordWebhook('[BILGI] Otomatik Captcha Kodu Çözüldü', `Mesaj: \`${text}\`\nGönderilen Kod: \`${code}\``, 0x2af598, accountId);
        }
      }, 1300);
      return;
    }
  }
}

// --- 6.1 GELİŞMİŞ TÜRKÇE & MENÜ ANTI-AFK DOĞRULAMA ÇÖZÜCÜ ---
function normalizeTr(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/§x(§[0-9a-f]){6}/gi, '')
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/&#[0-9a-f]{6}/gi, '')
    .replace(/&[0-9a-fk-or]/gi, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/Ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/Ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/Ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/Ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'c')
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TR_ITEM_MAP = {
  'nether yildizi': ['nether_star', 'nether star'],
  'nether star': ['nether_star'],
  'elmas': ['diamond', 'diamond_block'],
  'zumrut': ['emerald', 'emerald_block'],
  'altin': ['gold_ingot', 'gold_block', 'gold_nugget', 'raw_gold'],
  'altin kulcesi': ['gold_ingot'],
  'ham altin': ['raw_gold'],
  'demir': ['iron_ingot', 'iron_block', 'iron_nugget', 'raw_iron'],
  'demir kulcesi': ['iron_ingot'],
  'ham demir': ['raw_iron'],
  'bakir': ['copper_ingot', 'raw_copper', 'copper_block'],
  'bakir kulcesi': ['copper_ingot'],
  'ham bakir': ['raw_copper'],
  'ametist': ['amethyst_shard', 'amethyst_cluster', 'amethyst_block'],
  'ametist parcasi': ['amethyst_shard'],
  'komur': ['coal', 'charcoal', 'coal_block'],
  'kiziltas': ['redstone', 'redstone_block'],
  'kiziltas tozu': ['redstone'],
  'lapis': ['lapis_lazuli', 'lapis_block'],
  'lapis lazuli': ['lapis_lazuli'],
  'kuvars': ['quartz', 'nether_quartz', 'quartz_block'],
  'nether kuvarsi': ['quartz'],
  'elma': ['apple'],
  'altin elma': ['golden_apple', 'enchanted_golden_apple'],
  'buyulu altin elma': ['enchanted_golden_apple'],
  'ekmek': ['bread'],
  'havuc': ['carrot', 'golden_carrot'],
  'altin havuc': ['golden_carrot'],
  'patates': ['potato', 'baked_potato'],
  'pismis patates': ['baked_potato'],
  'biftek': ['cooked_beef'],
  'pismis et': ['cooked_beef', 'cooked_porkchop', 'cooked_mutton'],
  'pismis domuz eti': ['cooked_porkchop'],
  'pismis tavuk': ['cooked_chicken'],
  'cig tavuk': ['chicken'],
  'pismis koyun eti': ['cooked_mutton'],
  'pismis balik': ['cooked_cod', 'cooked_salmon'],
  'balcik': ['slime_ball'],
  'balcik topu': ['slime_ball'],
  'blaze cubugu': ['blaze_rod'],
  'ender incisi': ['ender_pearl'],
  'ender gozu': ['ender_eye'],
  'ghast gozyasi': ['ghast_tear'],
  'magma kremi': ['magma_cream'],
  'isik tasi': ['glowstone', 'glowstone_dust'],
  'isik tasi tozu': ['glowstone_dust'],
  'obsidyen': ['obsidian'],
  'kemik': ['bone'],
  'barut': ['gunpowder'],
  'tuy': ['feather'],
  'deri': ['leather'],
  'ip': ['string'],
  'kitap': ['book', 'writable_book', 'enchanted_book'],
  'yay': ['bow'],
  'ok': ['arrow'],
  'oltu': ['fishing_rod'],
  'olta': ['fishing_rod'],
  'makas': ['shears'],
  'cakmak': ['flint_and_steel'],
  'pusula': ['compass'],
  'saat': ['clock'],
  'kova': ['bucket', 'water_bucket', 'lava_bucket', 'milk_bucket'],
  'su kovasi': ['water_bucket'],
  'lav kovasi': ['lava_bucket'],
  'sut kovasi': ['milk_bucket'],
  'yatak': ['bed', 'red_bed', 'white_bed'],
  'sandik': ['chest', 'trapped_chest', 'ender_chest'],
  'piston': ['piston', 'sticky_piston'],
  'tnt': ['tnt'],
  'cam': ['glass', 'glass_pane'],
  'tas': ['stone', 'cobblestone'],
  'kiriktas': ['cobblestone'],
  'toprak': ['dirt', 'grass_block'],
  'odun': ['log', 'wood', 'oak_log', 'planks'],
  'fener': ['beacon'],
  'ors': ['anvil'],
  'totem': ['totem_of_undying'],
  'olumsuzluk totemi': ['totem_of_undying'],
  'elytra': ['elytra']
};


function isDecorativeItem(itemName) {
  if (!itemName) return false;
  const n = itemName.toLowerCase().replace('minecraft:', '');
  return (
    n.includes('glass') ||
    n.includes('pane') ||
    n === 'barrier' ||
    n === 'bedrock' ||
    n === 'structure_void' ||
    n === 'air' ||
    n === 'iron_bars'
  );
}

function extractAntiAfkTarget(text) {
  if (!text) return null;
  const norm = normalizeTr(text);

  // Strip countdown / time info like "30 saniye", "30 sn"
  const cleaned = norm.replace(/\b\d+\s*(?:saniye|sn|second|sec)\b/g, '');

  // 1. En yaygın ve net kalıplar (Normalize edilmiş Türkçe metin üzerinden)
  const patterns = [
    // Menüden / lütfen sonrasından eşyasına tıkla'ya kadar olan kısım
    /(?:menuden|acilan menuden|menudeki)\s+(.+?)\s+(?:esyasina|esyasi|ogesine|nesnesine|butonuna)\s+(?:tikla|secin|sec|basin)/,
    /(?:lutfen|yanlis esya)\s+(.+?)\s+(?:esyasina|esyasi|ogesine|nesnesine|butonuna)\s+(?:tikla|secin|sec|basin)/,
    // Başlık kalıbı: "Doğrulama: Zümrüt eşyasına tıkla!"
    /(?:dogrulama|kontrol)\s*[:\-]\s*(.+?)\s+(?:esyasina|esyasi|ogesine|nesnesine|butonuna)\s+(?:tikla|secin|sec|basin)/,
    // Sadece "menuden ... tikla"
    /(?:menuden|acilan menuden)\s+(.+?)\s+(?:tikla|secin|sec|basin)/,
    // Genel "... esyasina tikla"
    /(?:dogrulama|gerekli|anti afk)?\s*(?:icinde)?\s*([a-z0-9\s_-]+?)\s+(?:esyasina|esyasi|ogesine|nesnesine|butonuna)\s+(?:tikla|secin|sec|basin)/,
    // [Eşya] parantez içinde
    /\[([a-z0-9\s_-]+)\]\s*(?:esyasina|esyasi)?\s*(?:tikla|sec)/,
    // English patterns
    /(?:click|select|press)\s+(?:on\s+)?(?:the\s+)?([a-z0-9\s_-]+?)(?:\s+(?:in\s+the\s+menu|to\s+verify|item)|$)/
  ];

  for (const pat of patterns) {
    const m = cleaned.match(pat);
    if (m && m[1]) {
      let t = m[1].trim();
      t = t.replace(/^(?:anti\s*afk|dogrulama|gerekli|yanlis\s*esya|lutfen|menuden|acilan\s*menuden|icinde)\s*[»:\-!]*\s*/g, '').trim();
      t = t.replace(/\s*(?:esyasina|esyasi|ogesine|ogesi|item|in the menu|to verify)$/g, '').trim();
      if (t.length >= 2 && !['dogrulama', 'gerekli', 'yanlis', 'esya', 'menu', 'anti'].includes(t)) {
        return t;
      }
    }
  }

  // 2. Özel bilinen eşya taraması: Eğer chat metninde bilinen kritik eşyalar geçiyorsa ve tıkla deniyorsa
  if (norm.includes('tikla') || norm.includes('sec')) {
    const allKnown = Object.keys(TR_ITEM_MAP).sort((a, b) => b.length - a.length);
    for (const item of allKnown) {
      if (norm.includes(item)) {
        return item;
      }
    }
  }

  return null;
}

function scoreItemForTarget(item, targetNorm) {
  if (!item) return -999999;
  const itemName = (item.name || '').toLowerCase().replace('minecraft:', '');
  const customName = getItemCustomName(item);
  const displayName = item.displayName || '';
  const lore = getItemLoreText(item);

  const normName = normalizeTr(itemName);
  const normCustom = normalizeTr(customName);
  const normDisplay = normalizeTr(displayName);
  const normLore = normalizeTr(lore);

  const targetIsGlass = targetNorm && (targetNorm.includes('cam') || targetNorm.includes('glass'));
  if (!targetIsGlass && isDecorativeItem(itemName)) {
    return -999999;
  }

  let score = 0;

  // 1. ÖZEL NETHER STAR KURALI
  if (
    targetNorm &&
    targetNorm.includes('nether') &&
    (itemName === 'nether_star' || normName.includes('nether_star') || normCustom.includes('nether') || normDisplay.includes('nether'))
  ) {
    score += 10000;
  }

  // 2. TR_ITEM_MAP eşleşmesi
  if (targetNorm) {
    const mappedIds = TR_ITEM_MAP[targetNorm] || [];
    if (mappedIds.some((id) => itemName === id || itemName.replace(/_/g, ' ') === id)) {
      score += 5000;
    }
  }

  // 3. Özel isimde veya Display Name'de tam eşleşme
  if (targetNorm) {
    if (normCustom === targetNorm || normDisplay === targetNorm) {
      score += 4000;
    } else if (normCustom.includes(targetNorm) || normDisplay.includes(targetNorm)) {
      score += 3000;
    } else if (targetNorm.includes(normCustom) && normCustom.length >= 3) {
      score += 2500;
    }

    // 4. Kelime bazlı eşleşme
    const targetWords = targetNorm.split(' ').filter((w) => w.length > 2);
    let matchedWordCount = 0;
    for (const w of targetWords) {
      if (normName.includes(w) || normDisplay.includes(w) || normCustom.includes(w)) {
        matchedWordCount++;
      }
    }
    if (matchedWordCount === targetWords.length && targetWords.length > 0) {
      score += 3500;
    } else if (matchedWordCount > 0) {
      score += 1000 * matchedWordCount;
    }
  }

  // 5. Lore içinde tıkla/doğrula geçiyorsa bonus
  if (normLore.includes('tikla') || normLore.includes('dogrula') || normLore.includes('click')) {
    score += 200;
  }

  return score;
}


function handleMenuCaptchaFromChat(accountId, text) {
  if (config.autoCaptcha && config.autoCaptcha.enabled === false) return false;
  const session = sessions.get(accountId);
  const acc = config.accounts.find((a) => a.id === accountId);
  if (!session || !session.bot || !acc || session.status !== 'online') return false;
  if (acc.autoCaptcha === false) return false;

  const normalizedText = normalizeTr(text);
  if (
    normalizedText.includes('dogrulama basarili') ||
    normalizedText.includes('afk kontrolu basarili') ||
    normalizedText.includes('dogrulama tamamlandi') ||
    normalizedText.includes('afk dogrulamasi tamamlandi')
  ) {
    if (session.pendingMenuCaptcha) {
      session.pendingMenuCaptcha = null;
      session.isSolvingCaptcha = false;
      addLog(accountId, 'OTO-CAPTCHA', 'Anti-AFK doğrulaması sunucu tarafından onaylandı!', chalk.greenBright);
    }
    return false;
  }

  // Eşyayı çıkar
  const targetItem = extractAntiAfkTarget(text);
  if (targetItem) {
    const isRetry = normalizedText.includes('yanlis esya') || normalizedText.includes('yanlis');
    session.isSolvingCaptcha = false; // Yeniden denemede kilidi aç
    session.pendingMenuCaptcha = {
      targetText: targetItem,
      normalizedTarget: normalizeTr(targetItem),
      detectedAt: Date.now(),
      expiresAt: Date.now() + 35000,
      solved: false
    };

    addLog(
      accountId,
      'OTO-CAPTCHA',
      isRetry
        ? `Anti-AFK uyarısı: Hedef "${targetItem}" için menü yeniden taranıp tıklanacak!`
        : `Anti-AFK doğrulaması algılandı: Hedef "${targetItem}". Menüde aranıp tıklanacak.`,
      chalk.yellowBright
    );
    triggerSoundAlert('captcha', accountId, `Anti-AFK doğrulaması: ${targetItem}`);

    // Menü açıksa hemen çözmeyi dene
    if (session.bot.currentWindow) {
      attemptSolveMenuCaptcha(accountId, session.bot.currentWindow, 0);
    }
    return true;
  }
  return false;
}

async function attemptSolveMenuCaptcha(accountId, window, attemptCount = 0) {
  const session = sessions.get(accountId);
  const acc = config.accounts.find((a) => a.id === accountId);
  if (!session || !session.bot || !acc || !window) return false;
  if (session.isSolvingCaptcha || session.isRepairing) return false;

  const pending = session.pendingMenuCaptcha;
  const now = Date.now();

  const winTitle = parseWindowTitle(window);
  const normTitle = normalizeTr(winTitle);
  // Eğer menü başlığı demirci veya tamir menüsü ise captcha değildir
  if (normTitle.includes('demirci') || normTitle.includes('tamir')) {
    return false;
  }
  const isAntiAfkTitle =
    normTitle.includes('afk') ||
    normTitle.includes('dogrula') ||
    normTitle.includes('guvenlik') ||
    normTitle.includes('kontrol') ||
    normTitle.includes('tikla') ||
    normTitle.includes('verify');

  let targetNorm = pending && now < pending.expiresAt ? pending.normalizedTarget : '';
  let targetDisplay = pending ? pending.targetText : '';

  if (!targetNorm) {
    const extractedFromTitle = extractAntiAfkTarget(winTitle);
    if (extractedFromTitle) {
      targetDisplay = extractedFromTitle;
      targetNorm = normalizeTr(extractedFromTitle);
    }
  }

  // Ne pending captcha var ne de pencere başlığı Anti-AFK ise bu menü captcha değildir
  if (!targetNorm && !isAntiAfkTitle && !pending) {
    return false;
  }

  const containerEnd = typeof window.inventoryStart === 'number' ? window.inventoryStart : 27;
  const items = window.slots || [];
  const containerItems = items.slice(0, containerEnd).filter(Boolean);

  // Eşyalar sunucudan henüz yüklenmemişse bekle ve tekrar dene
  if (containerItems.length === 0 && attemptCount < 8) {
    setTimeout(() => {
      if (session.bot && session.bot.currentWindow) {
        attemptSolveMenuCaptcha(accountId, session.bot.currentWindow, attemptCount + 1);
      }
    }, 200);
    return false;
  }

  // Menüdeki dekoratif olmayan eşyaları listele
  const nonDecorativeItems = [];
  for (let s = 0; s < containerEnd; s++) {
    const it = items[s];
    if (it && !isDecorativeItem(it.name)) {
      nonDecorativeItems.push({
        slot: it.slot !== undefined ? it.slot : s,
        item: it,
        name: it.name,
        displayName: getItemCustomName(it) || it.displayName || it.name
      });
    }
  }

  if (nonDecorativeItems.length > 0 && attemptCount === 0) {
    const itemDesc = nonDecorativeItems.map((n) => `[Slot ${n.slot}: ${n.name} (${n.displayName})]`).join(' ');
    addLog(accountId, 'OTO-CAPTCHA', `Menü tarandı (${containerItems.length} eşya, ${nonDecorativeItems.length} etkileşimli): ${itemDesc}`, chalk.cyan);
  }

  // Adayları puanla
  const candidates = [];
  for (let slot = 0; slot < containerEnd; slot++) {
    const item = items[slot];
    if (!item) continue;
    const score = scoreItemForTarget(item, targetNorm);
    if (score > 0) {
      candidates.push({
        slot: item.slot !== undefined ? item.slot : slot,
        score,
        itemName: item.name,
        displayName: getItemCustomName(item) || item.displayName || item.name
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  let best = candidates[0];

  // FALLBACK: Eğer chat'ten hedef tam eşleşmediyse AMA menüde dekoratif olmayan SADECE 1 eşya varsa
  if ((!best || best.score < 100) && nonDecorativeItems.length === 1 && (isAntiAfkTitle || pending)) {
    const single = nonDecorativeItems[0];
    best = {
      slot: single.slot,
      score: 9999,
      itemName: single.name,
      displayName: single.displayName
    };
    addLog(accountId, 'OTO-CAPTCHA', `Menüde tek etkileşimli eşya bulundu: "${best.displayName}" (Slot: ${best.slot})`, chalk.yellowBright);
  }

  if (!best || best.score < 100) {
    if (attemptCount < 8) {
      setTimeout(() => {
        if (session.bot && session.bot.currentWindow) {
          attemptSolveMenuCaptcha(accountId, session.bot.currentWindow, attemptCount + 1);
        }
      }, 250);
      return false;
    }
    if (targetDisplay || isAntiAfkTitle) {
      addLog(accountId, 'OTO-CAPTCHA', `Anti-AFK menüsünde hedef "${targetDisplay || 'Belirsiz'}" bulunamadı! Menü: "${winTitle}"`, chalk.yellow);
    }
    return false;
  }

  // Kilit koy, aynı anda iki kere tıklanmasını engelle
  session.isSolvingCaptcha = true;

  const clickDelay = 650 + Math.floor(Math.random() * 350); // 650 - 1000 ms doğal insan gecikmesi

  addLog(
    accountId,
    'OTO-CAPTCHA',
    `Doğrulama eşyası seçildi -> "${best.displayName}" (Slot: ${best.slot}, Puan: ${best.score}). ${clickDelay}ms sonra tıklanıyor...`,
    chalk.greenBright
  );

  setTimeout(async () => {
    try {
      if (!session.bot || !session.bot.currentWindow) {
        addLog(accountId, 'OTO-CAPTCHA', 'Menü tıklama öncesinde kapandı.', chalk.yellow);
        session.isSolvingCaptcha = false;
        return;
      }

      await session.bot.clickWindow(best.slot, 0, 0);
      addLog(accountId, 'OTO-CAPTCHA', `Menü eşyasına sol tıklandı -> "${best.displayName}" (Slot: ${best.slot})`, chalk.greenBright);

      if (session.pendingMenuCaptcha) {
        session.pendingMenuCaptcha.solved = true;
      }

      if (session.stats) {
        session.stats.captchasSolved = (session.stats.captchasSolved || 0) + 1;
        broadcastState();
      }

      triggerSoundAlert('captcha', accountId, `Anti-AFK tıklandı: ${best.displayName}`);

      if (!config.discord || config.discord.notifyCaptcha !== false) {
        sendDiscordWebhook(
          '[BILGI] Anti-AFK Menü Doğrulaması Çözüldü',
          `Hesap: \`${acc.username}\`\nEşya: \`${best.displayName}\` (\`${best.itemName}\`)\nSlot: \`${best.slot}\`\nPuan: \`${best.score}\``,
          0x2af598,
          accountId
        );
      }
    } catch (err) {
      if (err.message && (err.message.includes('closed') || err.message.includes('transaction'))) {
        addLog(accountId, 'OTO-CAPTCHA', `Menü eşyasına tıklandı ve pencere kapandı -> "${best.displayName}"`, chalk.greenBright);
        if (session.pendingMenuCaptcha) session.pendingMenuCaptcha.solved = true;
      } else {
        addLog(accountId, 'OTO-CAPTCHA', `Menü eşyasına tıklama hatası: ${err.message}`, chalk.red);
      }
    } finally {
      setTimeout(() => {
        session.isSolvingCaptcha = false;
      }, 1500);
    }
  }, clickDelay);

  return true;
}

function startSessionAntiAfk(accountId) {
  const session = getOrCreateSession(accountId);
  if (session.afkInterval) {
    clearInterval(session.afkInterval);
    session.afkInterval = null;
  }
  if (session.builderTimer) {
    clearTimeout(session.builderTimer);
    session.builderTimer = null;
  }

  const acc = config.accounts.find((a) => a.id === accountId);
  if (!acc || acc.antiAfk === false || (config.antiAfk && config.antiAfk.enabled === false)) {
    return;
  }

  const interval = (config.antiAfk && config.antiAfk.intervalMs) || 15000;

  session.afkInterval = setInterval(() => {
    const bot = session.bot;
    const currentAcc = config.accounts.find((a) => a.id === accountId);
    const isBuilderActive = Boolean(session.builder && session.builder.status === 'building');
    const isFarmingActive = Boolean(session.autoTill || session.autoPlant || session.autoFarm || session.isFarmerSelling);
    if (
      !bot ||
      !bot.entity ||
      !currentAcc ||
      currentAcc.antiAfk === false ||
      session.isDepositing ||
      session.isDropping ||
      session.isEating ||
      session.isSolvingCaptcha ||
      isBuilderActive ||
      isFarmingActive
    ) return;

    const actions = (config.antiAfk && config.antiAfk.actions) || {
      jump: true,
      rotate: true,
      swingArm: true,
      sneak: true
    };
    const available = [];
    if (actions.rotate !== false && !session.autoMine) available.push('rotate');
    if (actions.jump !== false && !session.autoMine) available.push('jump');
    if (actions.swingArm !== false) available.push('swingArm');
    if (actions.sneak !== false && !session.sneakLock) available.push('sneak');
    if (available.length === 0) return;

    const chosen = available[Math.floor(Math.random() * available.length)];
    try {
      switch (chosen) {
        case 'rotate': {
          const yaw = Math.random() * Math.PI * 2 - Math.PI;
          const pitch = Math.random() * (Math.PI / 2) - Math.PI / 4;
          bot.look(yaw, pitch, false);
          break;
        }
        case 'jump': {
          bot.setControlState('jump', true);
          setTimeout(() => {
            if (session.bot) session.bot.setControlState('jump', false);
          }, 400);
          break;
        }
        case 'swingArm': {
          bot.swingArm('right');
          break;
        }
        case 'sneak': {
          bot.setControlState('sneak', true);
          setTimeout(() => {
            if (session.bot && !session.sneakLock) session.bot.setControlState('sneak', false);
          }, 750);
          break;
        }
      }
      broadcastState();
    } catch (e) {}
  }, interval);
}

function runAccountJoinCommands(accountId) {
  const session = sessions.get(accountId);
  const acc = config.accounts.find((a) => a.id === accountId);
  if (!session || !acc) return;

  const globalCmds =
    config.autoAuth && Array.isArray(config.autoAuth.customJoinCommands)
      ? config.autoAuth.customJoinCommands
      : [];
  const accCmds = Array.isArray(acc.customJoinCommands) ? acc.customJoinCommands : [];
  const allCmds = [...globalCmds, ...accCmds];

  allCmds.forEach((cmd, idx) => {
    setTimeout(() => {
      if (session.bot && session.status === 'online') {
        addLog(accountId, 'OTO-KOMUT', `Gönderiliyor: ${cmd}`, chalk.yellow);
        sendChatSafely(accountId, cmd);
      }
    }, (idx + 1) * 2200);
  });
}

function handleAuthPromptForBot(accountId, text) {
  const session = sessions.get(accountId);
  const acc = config.accounts.find((a) => a.id === accountId);
  if (!session || !session.bot || !acc) return;
  if (config.autoAuth && config.autoAuth.enabled === false) return;

  const now = Date.now();
  if (now - session.lastAuthTime < 2500) return;

  const lower = text.toLowerCase();
  const password = acc.password || '';
  const email = acc.email || '';

  const isRegisterPrompt =
    lower.includes('/register') ||
    lower.includes('/reg ') ||
    lower.includes('/kayit') ||
    lower.includes('/kayıt') ||
    (lower.includes('kayıt ol') &&
      (lower.includes('şifre') || lower.includes('sifre') || lower.includes('eposta') || lower.includes('email')));

  if (isRegisterPrompt && password) {
    session.lastAuthTime = now;
    session.hasAuthenticated = true;
    if (session.authFallbackTimeout) {
      clearTimeout(session.authFallbackTimeout);
      session.authFallbackTimeout = null;
    }

    const regCmd = buildSmartRegisterCommand(text, acc);
    setTimeout(() => {
      if (!session.bot) return;
      addLog(accountId, 'OTO-KAYIT', `Kayıt isteği algılandı -> ${regCmd}`, chalk.yellow);
      sendChatSafely(accountId, regCmd);
      runAccountJoinCommands(accountId);
    }, 800);
    return;
  }

  if (lower.includes('/email add') && email) {
    session.lastAuthTime = now;
    const emailCmd =
      lower.includes('<tekrar>') || (lower.match(/eposta|email|mail/g) || []).length >= 2
        ? `/email add ${email} ${email}`
        : `/email add ${email}`;

    setTimeout(() => {
      if (!session.bot) return;
      addLog(accountId, 'OTO-EPOSTA', `E-posta isteği algılandı -> ${emailCmd}`, chalk.yellow);
      sendChatSafely(accountId, emailCmd);
    }, 800);
    return;
  }

  const isLoginPrompt =
    lower.includes('/login') ||
    lower.includes('/l ') ||
    lower.includes('/giris') ||
    lower.includes('/giriş');

  if (isLoginPrompt && password && !session.hasAuthenticated) {
    session.lastAuthTime = now;
    session.hasAuthenticated = true;
    if (session.authFallbackTimeout) {
      clearTimeout(session.authFallbackTimeout);
      session.authFallbackTimeout = null;
    }

    const loginTemplate = (config.autoAuth && config.autoAuth.loginCommand) || '/login {password}';
    const loginCmd = loginTemplate
      .replace(/\{password\}/g, password)
      .replace(/\{email\}/g, email);

    setTimeout(() => {
      if (!session.bot) return;
      addLog(accountId, 'OTO-GİRİŞ', `Giriş isteği algılandı -> ${loginCmd}`, chalk.yellow);
      sendChatSafely(accountId, loginCmd);
      runAccountJoinCommands(accountId);
    }, 800);
  }
}

function parseProxyString(rawProxy, defaultType = 'socks5') {
  if (!rawProxy || typeof rawProxy !== 'string') return null;
  let str = rawProxy.trim();
  if (!str) return null;

  let type = (defaultType || 'socks5').toLowerCase();
  if (type === 'none') return null;

  if (str.startsWith('socks5://')) {
    type = 'socks5';
    str = str.slice(9);
  } else if (str.startsWith('socks4://')) {
    type = 'socks4';
    str = str.slice(9);
  } else if (str.startsWith('http://')) {
    type = 'http';
    str = str.slice(7);
  } else if (str.startsWith('https://')) {
    type = 'http';
    str = str.slice(8);
  }

  let host = '';
  let port = 1080;
  let username = '';
  let password = '';

  if (str.includes('@')) {
    const [authPart, hostPart] = str.split('@');
    const [u, p] = authPart.split(':');
    username = u || '';
    password = p || '';
    const [h, prt] = hostPart.split(':');
    host = h;
    port = Number(prt) || 1080;
  } else {
    const parts = str.split(':');
    host = parts[0];
    port = Number(parts[1]) || 1080;
    if (parts.length >= 4) {
      username = parts[2];
      password = parts.slice(3).join(':');
    }
  }

  if (!host || !port) return null;
  return { type, host, port, username, password };
}

async function resolveMinecraftTarget(host, port) {
  if (port !== 25565 || net.isIP(host)) {
    return { host, port };
  }
  try {
    const records = await Promise.race([
      dns.promises.resolveSrv(`_minecraft._tcp.${host}`),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))
    ]);
    if (Array.isArray(records) && records.length > 0) {
      return { host: records[0].name, port: records[0].port };
    }
  } catch (e) {}
  return { host, port };
}

function connectThroughProxy(client, targetHost, targetPort, proxyCfg, accountId) {
  const socket = new net.Socket();
  socket.setTimeout(12000);

  const fail = (msg) => {
    try {
      socket.destroy();
    } catch (e) {}
    client.emit('error', new Error(msg));
  };

  socket.once('timeout', () => fail(`Proxy zaman aşımına uğradı (${proxyCfg.host}:${proxyCfg.port})`));
  socket.once('error', (err) => fail(`Proxy bağlantı hatası (${proxyCfg.host}:${proxyCfg.port}): ${err.message}`));

  socket.connect(proxyCfg.port, proxyCfg.host, async () => {
    socket.setTimeout(0);

    try {
      if (proxyCfg.type === 'socks5') {
        const hasAuth = Boolean(proxyCfg.username);
        // 1. Greeting
        socket.write(hasAuth ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));

        const readBytes = (minLen) =>
          new Promise((resolve, reject) => {
            const onData = (chunk) => {
              if (chunk.length >= minLen) {
                socket.removeListener('data', onData);
                resolve(chunk);
              }
            };
            socket.on('data', onData);
            socket.once('error', reject);
          });

        const greetRes = await readBytes(2);
        if (greetRes[0] !== 0x05) return fail('Geçersiz SOCKS5 yanıtı');

        if (greetRes[1] === 0x02) {
          const uBuf = Buffer.from(proxyCfg.username, 'utf8');
          const pBuf = Buffer.from(proxyCfg.password || '', 'utf8');
          const authPkt = Buffer.concat([
            Buffer.from([0x01, uBuf.length]),
            uBuf,
            Buffer.from([pBuf.length]),
            pBuf
          ]);
          socket.write(authPkt);
          const authRes = await readBytes(2);
          if (authRes[1] !== 0x00) return fail('SOCKS5 Proxy kullanıcı adı/şifre hatası');
        } else if (greetRes[1] !== 0x00) {
          return fail('SOCKS5 Proxy kimlik doğrulama yöntemini reddetti');
        }

        // 2. Connect Request
        const portBuf = Buffer.alloc(2);
        portBuf.writeUInt16BE(targetPort, 0);

        let reqPkt;
        if (net.isIPv4(targetHost)) {
          const ipBytes = targetHost.split('.').map((n) => Number(n));
          reqPkt = Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x01, ...ipBytes]), portBuf]);
        } else {
          const hostBuf = Buffer.from(targetHost, 'utf8');
          reqPkt = Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]), hostBuf, portBuf]);
        }

        socket.write(reqPkt);
        const connRes = await readBytes(4);
        if (connRes[1] !== 0x00) {
          return fail(`SOCKS5 hedef sunucuya bağlanamadı (Kod: ${connRes[1]})`);
        }

        addLog(accountId, 'PROXY', `SOCKS5 Proxy üzerinden tünel kuruldu (${proxyCfg.host}:${proxyCfg.port})`, chalk.cyan);
        client.setSocket(socket);
        client.emit('connect');
      } else if (proxyCfg.type === 'socks4') {
        const portBuf = Buffer.alloc(2);
        portBuf.writeUInt16BE(targetPort, 0);

        let targetIp = targetHost;
        if (!net.isIPv4(targetHost)) {
          try {
            const resolved = await dns.promises.lookup(targetHost, { family: 4 });
            targetIp = resolved.address;
          } catch (e) {
            return fail(`SOCKS4 için alan adı çözümlenemedi: ${targetHost}`);
          }
        }

        const ipBytes = targetIp.split('.').map((n) => Number(n));
        const pkt = Buffer.concat([Buffer.from([0x04, 0x01]), portBuf, Buffer.from([...ipBytes, 0x00])]);

        socket.once('data', (chunk) => {
          if (chunk.length >= 2 && chunk[1] === 0x5a) {
            addLog(accountId, 'PROXY', `SOCKS4 Proxy üzerinden tünel kuruldu (${proxyCfg.host}:${proxyCfg.port})`, chalk.cyan);
            client.setSocket(socket);
            client.emit('connect');
          } else {
            fail('SOCKS4 Proxy bağlantıyı reddetti');
          }
        });
        socket.write(pkt);
      } else if (proxyCfg.type === 'http') {
        let headers = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
        if (proxyCfg.username) {
          const b64 = Buffer.from(`${proxyCfg.username}:${proxyCfg.password || ''}`).toString('base64');
          headers += `Proxy-Authorization: Basic ${b64}\r\n`;
        }
        headers += '\r\n';

        socket.once('data', (chunk) => {
          const str = chunk.toString('utf8');
          if (str.includes(' 200 ')) {
            addLog(accountId, 'PROXY', `HTTP Proxy üzerinden tünel kuruldu (${proxyCfg.host}:${proxyCfg.port})`, chalk.cyan);
            client.setSocket(socket);
            client.emit('connect');
          } else {
            fail(`HTTP Proxy hatası: ${str.split('\r\n')[0]}`);
          }
        });
        socket.write(headers);
      }
    } catch (err) {
      fail(`Proxy protokol hatası: ${err.message}`);
    }
  });
}

async function startBot(accountId) {
  const acc = config.accounts.find((a) => a.id === accountId);
  if (!acc) return;

  const session = getOrCreateSession(accountId);
  clearSessionTimers(session);

  if (session.bot) {
    try {
      session.bot.removeAllListeners();
      session.bot.quit();
    } catch (e) {}
    session.bot = null;
  }

  session.manualStop = false;
  session.hasAuthenticated = false;
  session.isEating = false;
  session.isDropping = false;
  session.isDepositing = false;
  session.lastHealth = 20;
  session.initialSpawnHealth = null;
  session.safeRecoveryMode = false;
  session.lastAuthTime = 0;
  session.status = 'connecting';
  broadcastState();

  const rawHost = config.server.host || 'localhost';
  const rawPort = Number(config.server.port) || 25565;

  if (!acc.hwid) {
    acc.hwid = generateHwidString(acc.username || acc.id);
    saveConfig();
  }

  const resolvedBrand = resolveAccountBrand(acc);
  const resolvedViewDist = Number(acc.viewDistance) || 10;
  const resolvedMainHand = acc.mainHand === 'left' ? 'left' : 'right';
  const resolvedLocale = acc.clientLocale || 'tr_TR';
  const resolvedSkinParts = deriveSkinPartsFromHwid(acc.hwid);

  const botOptions = {
    host: rawHost,
    port: rawPort,
    username: acc.username,
    auth: 'offline',
    version: config.server.version || false,
    brand: resolvedBrand,
    viewDistance: resolvedViewDist,
    mainHand: resolvedMainHand,
    skinParts: resolvedSkinParts,
    hideErrors: true
  };

  const proxyCfg = parseProxyString(acc.proxy, acc.proxyType || 'socks5');
  if (proxyCfg) {
    const resolved = await resolveMinecraftTarget(rawHost, rawPort);
    botOptions.host = resolved.host;
    botOptions.port = resolved.port;
    botOptions.connect = (client) => {
      connectThroughProxy(client, resolved.host, resolved.port, proxyCfg, accountId);
    };
    addLog(
      accountId,
      'BAĞLANTI',
      `${rawHost}:${rawPort} sunucusuna ${proxyCfg.type.toUpperCase()} Proxy (${proxyCfg.host}:${proxyCfg.port}) ile bağlanılıyor...`,
      chalk.blue
    );
  } else {
    addLog(
      accountId,
      'BAĞLANTI',
      `${botOptions.host}:${botOptions.port} sunucusuna doğrudan bağlanılıyor...`,
      chalk.blue
    );
  }

  let bot;
  try {
    bot = mineflayer.createBot(botOptions);
  } catch (err) {
    addLog(accountId, 'HATA', `Bot oluşturulamadı: ${err.message}`, chalk.red);
    session.status = 'offline';
    broadcastState();
    return;
  }

  session.bot = bot;
  initSessionScoreboard(session);
  attachScoreboardTracker(bot, session, accountId);

  // 1. YAPILANDIRMA AŞAMASI SÜZGECİ (Velocity / BungeeCord sunucu aktarımında "internal error" atılmasını önler)
  if (bot._client) {
    const istemci = bot._client;
    const YAPILANDIRMA_PAKETLERI = new Set([
      'settings', 'cookie_response', 'custom_payload', 'finish_configuration',
      'keep_alive', 'pong', 'resource_pack_receive', 'select_known_packs',
      'custom_click_action', 'accept_code_of_conduct'
    ]);
    const hamYaz = istemci.write.bind(istemci);
    istemci.write = (ad, veri) => {
      if (istemci.state === 'configuration' && !YAPILANDIRMA_PAKETLERI.has(ad)) return;
      return hamYaz(ad, veri);
    };
  }

  // 2. KAYNAK PAKETİ OTOMATİK ONAYI (Sunucuda require-resource-pack=true varsa atılmayı önler)
  bot.on('resourcePack', () => {
    try {
      bot.acceptResourcePack();
      addLog(accountId, 'SUNUCU', 'Sunucu kaynak paketi isteği otomatik olarak onaylandı.', chalk.gray);
    } catch (err) {
      addLog(accountId, 'HATA', `Kaynak paketi cevabı gönderilemedi: ${err.message}`, chalk.red);
    }
  });

  bot.once('login', () => {
    session.status = 'online';
    if (session.stats && !session.stats.connectedSince) {
      session.stats.connectedSince = Date.now();
    }
    try {
      if (typeof bot.setSettings === 'function') {
        bot.setSettings({
          locale: resolvedLocale,
          viewDistance: resolvedViewDist,
          mainHand: resolvedMainHand,
          skinParts: resolvedSkinParts
        });
      }
    } catch (e) {}
    addLog(accountId, 'BAĞLANTI', `Sunucuya giriş yapıldı! (Sürüm: ${bot.version})`, chalk.green);
    addLog(
      accountId,
      'SPOOF',
      `İstemci Kimliği: "${resolvedBrand}" | HWID: ${acc.hwid} | Dil: ${resolvedLocale} (${resolvedViewDist} Chunk)`,
      chalk.cyan
    );
    broadcastState();
  });

  // 7. DİNLENEN OLAYLARI VE SÜRE SAYACINI SUNUCU AKTARIMINDA KORU
  bot.on('spawn', () => {
    session.status = 'online';
    const isFirstSpawn = !bot._sctIlkDogus;
    if (isFirstSpawn) {
      bot._sctIlkDogus = true;
      if (session.stats && !session.stats.connectedSince) {
        session.stats.connectedSince = Date.now();
      }
    }

    session.lastHealth = typeof bot.health === 'number' ? bot.health : 20;
    const p = bot.entity?.position;
    const coords = p ? `X:${Math.floor(p.x)} Y:${Math.floor(p.y)} Z:${Math.floor(p.z)}` : 'Bilinmiyor';

    if (isFirstSpawn) {
      addLog(
        accountId,
        'SPAWN',
        `Dünyada doğuldu! Konum: ${coords}`,
        chalk.green
      );
    } else {
      addLog(
        accountId,
        'SPAWN',
        `Sunucu aktarımı yapıldı! Konum: ${coords}`,
        chalk.cyan
      );
    }

    if (session.sneakLock) {
      bot.setControlState('sneak', true);
    }

    broadcastState();

    if (isFirstSpawn && config.autoAuth && config.autoAuth.enabled !== false && acc.password) {
      const delay = config.autoAuth.delayMs || 3000;
      session.authFallbackTimeout = setTimeout(() => {
        if (!session.bot || session.hasAuthenticated) return;
        session.hasAuthenticated = true;
        const tpl = config.autoAuth.loginCommand || '/login {password}';
        const cmd = tpl
          .replace(/\{password\}/g, acc.password)
          .replace(/\{email\}/g, acc.email || '');
        addLog(accountId, 'OTO-GİRİŞ', `Giriş komutu gönderiliyor: ${cmd}`, chalk.yellow);
        sendChatSafely(accountId, cmd);
        runAccountJoinCommands(accountId);
      }, delay);
    }

    startSessionAntiAfk(accountId);
    startAutoCommandLoop(accountId);
    if (session.autoMine) startAutoMineLoop(accountId);
    if (session.autoAttack) startAutoAttackLoop(accountId);
    if (session.autoRightClick) startAutoRightClickLoop(accountId);
    if (session.autoChest) startAutoChestLoop(accountId);
    if (session.autoFarm) startAutoFarmLoop(accountId);
    if (session.autoTill) startAutoTillLoop(accountId);
    if (session.autoPlant) startAutoPlantLoop(accountId);
    if (acc.autoFarmerSell && acc.autoFarmerSell.enabled) startFarmerSellLoop(accountId);
  });

  bot.on('messagestr', (message, position) => {
    if (position === 'game_info') {
      handleHarvestActionBar(session, message, accountId);
      return;
    }
    const trimmed = message.trim();
    if (!trimmed) return;
    addLog(accountId, 'CHAT', trimmed, chalk.white);
    handleHarvestLimitMessage(session, trimmed, accountId);
    handleAuthPromptForBot(accountId, trimmed);
    handleCaptchaAndMath(accountId, trimmed);
    handleMenuCaptchaFromChat(accountId, trimmed);
    handleMiningWarning(accountId, trimmed);

    const lower = trimmed.toLowerCase();
    const uLower = acc.username.toLowerCase();

    // 9. GELEN ÖZEL MESAJLARI (WHISPER) VE AD GEÇMESİNİ (MENTION) ALGILA VE BİLDİR
    const isWhisper =
      (lower.includes('fısıldıyor') ||
        lower.includes('whispers') ||
        lower.includes('-> size') ||
        lower.includes('-> bana') ||
        lower.includes('-> siz') ||
        lower.includes('-> me')) &&
      !lower.includes('bana fısıldıyor') &&
      !lower.includes('size fısıldıyor') &&
      !lower.startsWith('fısıldanan:') &&
      !lower.startsWith('[bana ->');

    if (isWhisper) {
      triggerSoundAlert('mention', accountId, `[ÖZEL MESAJ] ${trimmed}`);
      sendDesktopNotification('Gelen Özel Mesaj', `[${acc.username}] ${trimmed}`, accountId);
    } else if (
      lower.includes(uLower) &&
      !lower.startsWith(`<${uLower}>`) &&
      !lower.startsWith(`${uLower}:`) &&
      !lower.startsWith(`[${uLower}]`)
    ) {
      triggerSoundAlert('mention', accountId, trimmed);
      sendDesktopNotification('Adınız Geçti (Mention)', `[${acc.username}] ${trimmed}`, accountId);
    }
  });

  bot.on('message', (jsonMsg, position) => {
    try {
      const raw = jsonMsg && typeof jsonMsg.toString === 'function' ? jsonMsg.toString().trim() : '';
      if (raw) {
        if (position === 'game_info') {
          handleHarvestActionBar(session, raw, accountId);
        } else {
          handleHarvestLimitMessage(session, raw, accountId);
        }
        handleAuthPromptForBot(accountId, raw);
        handleCaptchaAndMath(accountId, raw);
        handleMenuCaptchaFromChat(accountId, raw);
        handleMiningWarning(accountId, raw);
      }
    } catch (e) {}
  });

  bot.on('title', (text) => {
    if (typeof text === 'string' && text.trim()) {
      const t = text.trim();
      handleAuthPromptForBot(accountId, t);
      handleCaptchaAndMath(accountId, t);
      handleMenuCaptchaFromChat(accountId, t);
      handleMiningWarning(accountId, t);
    }
  });

  bot.on('actionBar', (text) => {
    try {
      const t = (typeof text === 'string' ? text : text && text.toString ? text.toString() : '').trim();
      if (t) {
        handleHarvestActionBar(session, t, accountId);
        handleMenuCaptchaFromChat(accountId, t);
        handleMiningWarning(accountId, t);
      }
    } catch (e) {}
  });

  bot.on('health', () => {
    if (typeof bot.health === 'number') {
      if (bot.health < (session.lastHealth || 20) - 0.5) {
        triggerSoundAlert('damage', accountId, `Hasar alındı! Can: ${Math.round(bot.health)}/20`);
      }
      session.lastHealth = bot.health;
    }
    broadcastState();
    checkHealthAndHunger(accountId);
  });

  bot.on('windowOpen', (window) => {
    addLog(accountId, 'MENÜ', `"${parseWindowTitle(window)}" menüsü açıldı.`, chalk.cyan);
    broadcastState();

    // Menü açıldığında blok kazmayı derhal durdur
    if (session.bot && session.bot.targetDigBlock) {
      try {
        session.bot.stopDigging();
      } catch (e) {}
      session.bot.targetDigBlock = null;
    }
    session.isMiningBlock = false;

    // Sunucudan pencereye gelen her yeni slot güncellemesinde de çözmeyi dene
    const onWindowUpdateSlot = () => {
      broadcastState();
      attemptSolveMenuCaptcha(accountId, window);
    };
    window.on('updateSlot', onWindowUpdateSlot);

    attemptSolveMenuCaptcha(accountId, window);
  });

  bot.on('windowClose', (window) => {
    session.isSolvingCaptcha = false;
    if (window && typeof window.removeAllListeners === 'function') {
      try {
        window.removeAllListeners('updateSlot');
      } catch (e) {}
    }
    if (session.pendingMenuCaptcha && session.pendingMenuCaptcha.solved) {
      session.pendingMenuCaptcha = null;
    }
    broadcastState();
  });

  if (bot.inventory && typeof bot.inventory.on === 'function') {
    bot.inventory.on('updateSlot', () => {
      broadcastState();
      if (session.builder && session.builder.status === 'building') {
        scheduleNextBuilderStep(accountId, 50);
      }
    });
  }

  bot.on('playerCollect', (collector) => {
    if (collector === bot.entity) {
      broadcastState();
      if (session.builder && session.builder.status === 'building') {
        scheduleNextBuilderStep(accountId, 50);
      }
    }
  });

  bot.on('heldItemChanged', () => broadcastState());
  bot.on('playerJoined', () => broadcastState());
  bot.on('playerLeft', () => broadcastState());

  // Canlı Scoreboard (Para, Ada, Rütbe vb.) Takibi
  const onScoreboardUpdate = () => debouncedBroadcastState(120);
  bot.on('scoreUpdated', onScoreboardUpdate);
  bot.on('scoreRemoved', onScoreboardUpdate);
  bot.on('scoreboardPosition', onScoreboardUpdate);
  bot.on('scoreboardTitleChanged', onScoreboardUpdate);
  bot.on('scoreboardCreated', onScoreboardUpdate);
  bot.on('scoreboardDeleted', onScoreboardUpdate);
  bot.on('teamCreated', onScoreboardUpdate);
  bot.on('teamUpdated', onScoreboardUpdate);
  bot.on('teamMemberAdded', onScoreboardUpdate);
  bot.on('teamMemberRemoved', onScoreboardUpdate);

  bot.on('death', () => {
    addLog(accountId, 'ÖLÜM', 'Bot öldü! Otomatik yeniden doğuluyor...', chalk.red);
    triggerSoundAlert('damage', accountId, 'Bot öldü!');
    sendDesktopNotification('Bot Öldü', `[${acc.username}] Sunucuda öldü ve yeniden doğuyor.`, accountId);
    if (!config.discord || config.discord.notifyDeath !== false) {
      sendDiscordWebhook('[UYARI] Bot Öldü!', 'Bot sunucuda öldü ve otomatik yeniden doğuyor.', 0xff5252, accountId);
    }
  });

  // 3. ATILMA SEBEBİNİ NBT'DEN DÜZ METNE ÇEVİR VE GELİŞMİŞ HATA YAKALA
  bot.on('kicked', (reason) => {
    let readable = 'Bilinmeyen sebep';
    if (reason) {
      if (typeof reason === 'string') {
        readable = reason;
      } else if (typeof reason === 'object') {
        try {
          const cozulen = extractTextFromChat(reason).trim();
          if (cozulen) {
            readable = cozulen;
          } else {
            const res = typeof reason.toString === 'function' ? reason.toString() : '';
            readable = (res && res !== '[object Object]') ? res : JSON.stringify(reason);
          }
        } catch (e) {
          readable = JSON.stringify(reason);
        }
      } else {
        readable = String(reason);
      }
    }
    // Renk kodlarını temizle (§a, §c vs.)
    readable = readable.replace(/§[0-9a-fk-or]/gi, '').trim();

    addLog(accountId, 'ATILDI', `Sunucudan atıldı: ${readable}`, chalk.red);
    triggerSoundAlert('disconnect', accountId, `Sunucudan atıldı: ${readable}`);
    sendDesktopNotification('Sunucudan Atıldı', `[${acc.username}] ${readable}`, accountId);

    if (/internal error occurred in your connection/i.test(readable)) {
      addLog(accountId, 'VEKİL-SUNUCU', '⚠️ Velocity / Bungee sunucu aktarım reddi algılandı.', chalk.yellow);
    }

    if (!config.discord || config.discord.notifyDisconnect !== false) {
      sendDiscordWebhook('[BILGI] Sunucudan Atıldı (Kick)', `Sebep: \`${readable}\``, 0xff5252, accountId);
    }
  });

  bot.on('error', (err) => {
    addLog(accountId, 'HATA', `Bağlantı hatası: ${err.message}`, chalk.red);
  });

  bot.on('end', (reason) => {
    clearSessionTimers(session);
    session.bot = null;
    if (session.stats) {
      session.stats.connectedSince = null;
    }

    if (session.manualStop) {
      session.status = 'offline';
      addLog(accountId, 'BAĞLANTI', 'Bot durduruldu.', chalk.gray);
      broadcastState();
      return;
    }

    triggerSoundAlert('disconnect', accountId, `Bağlantı koptu: ${reason || 'Bilinmeyen'}`);
    if (!config.discord || config.discord.notifyDisconnect !== false) {
      sendDiscordWebhook('[UYARI] Bağlantı Koptu', `Sebep: \`${reason || 'Bilinmeyen'}\``, 0xffc107, accountId);
    }

    const currentAcc = config.accounts.find((a) => a.id === accountId);
    const shouldReconnect =
      currentAcc &&
      currentAcc.autoReconnect !== false &&
      (!config.reconnect || config.reconnect.enabled !== false);

    if (shouldReconnect) {
      session.status = 'reconnecting';
      const delay = (config.reconnect && config.reconnect.delayMs) || 5000;
      addLog(
        accountId,
        'BAĞLANTI',
        `Bağlantı koptu (${reason || 'Bilinmeyen'}). ${delay / 1000} sn içinde yeniden bağlanılacak...`,
        chalk.yellow
      );
      broadcastState();

      session.reconnectTimeout = setTimeout(() => {
        startBot(accountId);
      }, delay);
    } else {
      session.status = 'offline';
      addLog(accountId, 'BAĞLANTI', `Bağlantı sona erdi (${reason || 'Kapatıldı'}).`, chalk.red);
      broadcastState();
    }
  });
}

function stopBot(accountId) {
  const session = sessions.get(accountId);
  if (!session) return;

  session.manualStop = true;
  clearSessionTimers(session);

  if (session.bot) {
    try {
      session.bot.quit();
    } catch (e) {}
    session.bot = null;
  }

  session.status = 'offline';
  if (session.stats) {
    session.stats.connectedSince = null;
  }
  addLog(accountId, 'BAĞLANTI', 'Kullanıcı tarafından durduruldu.', chalk.yellow);
  broadcastState();
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 5 * 1024 * 1024) { // 5MB limit
        tooLarge = true;
        body = '';
      }
    });
    req.on('end', () => {
      if (tooLarge) return resolve({});
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/') {
    try {
      const html = fs.readFileSync(HTML_PATH, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
      });
      res.end(html);
    } catch (err) {
      res.writeHead(500);
      res.end('Arayuz dosyasi okunamadi: ' + err.message);
    }
    return;
  }

  // Harici linkleri (Discord vb.) kullanıcının normal varsayılan tarayıcısında aç
  if (req.method === 'GET' && pathname === '/api/open-external') {
    const target = url.searchParams.get('url') || '';
    if (/^https:\/\/(discord\.com|discord\.gg)\//i.test(target)) {
      openExternalUrl(target);
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 400, { ok: false });
  }

  if (req.method === 'GET' && pathname === '/manifest.json') {
    return sendJson(res, 200, {
      name: 'SCT AFK Service',
      short_name: 'SCT AFK',
      start_url: '/?v=20261024',
      display: 'standalone',
      background_color: '#0a0b0d',
      theme_color: '#0a0b0d',
      icons: [
        {
          src: '/favicon.ico?v=20261024',
          sizes: '16x16 32x32 48x48 64x64 128x128 256x256',
          type: 'image/x-icon',
          purpose: 'any'
        },
        {
          src: '/logo.jpg?v=20261024',
          sizes: '256x256 512x512',
          type: 'image/jpeg',
          purpose: 'any maskable'
        }
      ]
    });
  }

  if (req.method === 'GET' && (pathname === '/logo.jpg' || pathname === '/favicon.ico' || pathname === '/app.ico')) {
    try {
      if (pathname === '/favicon.ico' || pathname === '/app.ico') {
        const icoFile = path.join(__dirname, 'app.ico');
        if (fs.existsSync(icoFile)) {
          const icoBuf = fs.readFileSync(icoFile);
          res.writeHead(200, {
            'Content-Type': 'image/x-icon',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          });
          return res.end(icoBuf);
        }
      }
      const logoBuf = fs.readFileSync(path.join(__dirname, 'public', 'logo.jpg'));
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(logoBuf);
    } catch (err) {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('\n');
    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
      setTimeout(() => {
        if (sseClients.size === 0) {
          const anyActiveBot = Array.from(sessions.values()).some(
            (s) => s.status === 'online' || s.status === 'connecting' || s.status === 'reconnecting'
          );
          if (!anyActiveBot) {
            process.exit(0);
          }
        }
      }, 4000);
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shutdown') {
    config.accounts.forEach((acc) => stopBot(acc.id));
    sendJson(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 300);
    return;
  }

  // --- KEYAUTH LİSANS & GİRİŞ UÇ NOKTALARI ---
  if (req.method === 'GET' && pathname === '/api/keyauth/status') {
    return sendJson(res, 200, getPublicKeyAuthStatus());
  }

  if (req.method === 'POST' && pathname === '/api/keyauth/autologin') {
    if (keyAuthSession.plan === 'pro') {
      return sendJson(res, 200, { ok: true, keyauth: getPublicKeyAuthStatus() });
    }
    const saved = loadLocalKeyAuthCredentials();
    if (!saved || !saved.username || !saved.password) {
      return sendJson(res, 200, { ok: false, keyauth: getPublicKeyAuthStatus() });
    }
    try {
      const kaStatus = await performKeyAuthLogin(saved.username, saved.password, true);
      addLog(null, 'KEYAUTH', `"${kaStatus.username}" (${kaStatus.planLabel} Paket) otomatik doğrulandı.`, chalk.green);
      broadcastState();
      return sendJson(res, 200, { ok: true, keyauth: kaStatus });
    } catch (err) {
      // Ağ / KeyAuth sunucu hatasında kayıtlı oturumu SİLME; yalnızca açık şifre/lisans hatasında sil
      const msg = String(err && err.message || '').toLowerCase();
      const isCredentialError = msg.includes('şifre') || msg.includes('bulunamadı') || msg.includes('süreniz') || msg.includes('engellenmiş') || msg.includes('hwid');
      if (isCredentialError) {
        clearLocalKeyAuthCredentials();
      } else {
        applySavedKeyAuthAsPro(saved);
      }
      return sendJson(res, 200, { ok: !isCredentialError, error: err.message, keyauth: getPublicKeyAuthStatus() });
    }
  }

  if (req.method === 'POST' && pathname === '/api/keyauth/login') {
    const body = await readJsonBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const remember = body.remember !== false;
    if (!username || !password) {
      return sendJson(res, 400, { error: 'Lütfen kullanıcı adı ve şifrenizi girin.' });
    }
    try {
      const kaStatus = await performKeyAuthLogin(username, password, remember);
      addLog(null, 'KEYAUTH', `"${kaStatus.username}" (${kaStatus.planLabel} Paket) olarak giriş yapıldı.`, chalk.green);
      broadcastState();
      return sendJson(res, 200, { ok: true, keyauth: kaStatus });
    } catch (err) {
      return sendJson(res, 401, { error: err.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/keyauth/register') {
    const body = await readJsonBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const key = String(body.key || '').trim();
    const remember = body.remember !== false;
    if (!username || !password || !key) {
      return sendJson(res, 400, { error: 'Lütfen Kullanıcı Adı, Şifre ve Lisans Anahtarı (Key) alanlarının tümünü doldurun.' });
    }
    try {
      const kaStatus = await performKeyAuthRegister(username, password, key, remember);
      addLog(null, 'KEYAUTH', `"${kaStatus.username}" hesabı oluşturuldu (${kaStatus.planLabel} Paket aktifleştirildi)!`, chalk.green);
      broadcastState();
      return sendJson(res, 200, { ok: true, keyauth: kaStatus });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/keyauth/upgrade') {
    const body = await readJsonBody(req);
    const username = String(body.username || '').trim();
    const key = String(body.key || '').trim();
    if (!username || !key) {
      return sendJson(res, 400, { error: 'Lütfen kullanıcı adınızı ve yeni lisans anahtarınızı girin.' });
    }
    try {
      const result = await performKeyAuthUpgrade(username, key);
      // Eğer kullanıcı zaten giriş yapmışsa aboneliğini de hemen tazele
      const saved = loadLocalKeyAuthCredentials();
      if (keyAuthSession.authenticated && saved && saved.username.toLowerCase() === username.toLowerCase()) {
        try {
          await performKeyAuthLogin(saved.username, saved.password, true);
          broadcastState();
        } catch (e) {}
      }
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/keyauth/logout') {
    config.accounts.forEach((acc) => stopBot(acc.id));
    keyAuthSession.authenticated = true;
    keyAuthSession.isPro = false;
    keyAuthSession.sessionid = '';
    keyAuthSession.username = 'Ücretsiz Sürüm';
    keyAuthSession.subscription = 'Starter (Ücretsiz)';
    keyAuthSession.plan = 'starter';
    keyAuthSession.planLabel = 'STARTER';
    keyAuthSession.expiryTimestamp = null;
    clearLocalKeyAuthCredentials();
    broadcastState();
    return sendJson(res, 200, { ok: true, keyauth: getPublicKeyAuthStatus() });
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    sendJson(res, 200, {
      ...getPublicState(),
      logs: recentLogs
    });
    return;
  }

  // PRO Paket Gerektiren API Uç Noktaları Kontrolü (Radar, Schematic, Proxy Havuzu)
  if (
    (pathname === '/api/radar' || pathname.startsWith('/api/builder/') || pathname === '/api/proxies/assign') &&
    keyAuthSession.plan !== 'pro'
  ) {
    return sendJson(res, 403, {
      error: 'Bu özellik yalnızca PRO Paket üyelerine açıktır (175.00 TL - Discord: cagat).',
      requiresPro: true
    });
  }

  if (req.method === 'GET' && pathname === '/api/radar') {
    const accountId = url.searchParams.get('accountId') || '';
    const radius = url.searchParams.get('radius') || '12';
    const mode = url.searchParams.get('mode') || 'surface';
    const yOffset = url.searchParams.get('yOffset') || '0';
    const snapshot = buildRadarSnapshot(accountId, { radius, mode, yOffset });
    return sendJson(res, 200, snapshot);
  }

  // Schematica / Litematica Dosya Yükleme (.schem / .litematic / .schematic / .json)
  if (req.method === 'POST' && pathname === '/api/builder/upload') {
    try {
      const body = await readJsonBody(req);
      const acc = config.accounts.find((a) => a.id === body.accountId) || config.accounts[0];
      if (!acc) return sendJson(res, 404, { error: 'Hesap bulunamadı' });
      if (!body.base64Data) return sendJson(res, 400, { error: 'Şema verisi boş' });

      const buf = Buffer.from(body.base64Data, 'base64');
      const parsed = await parseSchematicBuffer(buf, body.filename || 'yapim.schem');
      loadSchematicIntoSession(acc.id, parsed, Number(body.rotation) || 0);
      const s = getOrCreateSession(acc.id);
      return sendJson(res, 200, { ok: true, builder: getPublicBuilderSummary(s) });
    } catch (err) {
      return sendJson(res, 400, { error: `Şema dosyası çözümlenemedi: ${err.message}` });
    }
  }

  // Hazır Farm Şablonu Yükleme
  if (req.method === 'POST' && pathname === '/api/builder/preset') {
    try {
      const body = await readJsonBody(req);
      const acc = config.accounts.find((a) => a.id === body.accountId) || config.accounts[0];
      if (!acc) return sendJson(res, 404, { error: 'Hesap bulunamadı' });
      const parsed = buildPresetSchematic(body.presetId || 'cactus_farm_tower');
      loadSchematicIntoSession(acc.id, parsed, Number(body.rotation) || 0);
      const s = getOrCreateSession(acc.id);
      return sendJson(res, 200, { ok: true, builder: getPublicBuilderSummary(s) });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // 2D / 3D Şema Katman Önizleme Verisi
  if (req.method === 'GET' && pathname === '/api/builder/preview') {
    const accountId = url.searchParams.get('accountId') || '';
    const acc = config.accounts.find((a) => a.id === accountId) || config.accounts[0];
    if (!acc) return sendJson(res, 404, { error: 'Hesap bulunamadı' });
    const s = getOrCreateSession(acc.id);
    const b = s.builder || createDefaultBuilderState();
    return sendJson(res, 200, {
      ...getPublicBuilderSummary(s),
      blocks: (b.blocks || []).slice(0, 6000).map((blk) => ({
        x: blk.x,
        y: blk.y,
        z: blk.z,
        n: blk.name,
        p: blk.placed ? 1 : 0
      }))
    });
  }

  if (req.method === 'GET' && pathname === '/api/backup') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="SCT_AFK_Service_Yedek.json"'
    });
    res.end(JSON.stringify(config, null, 2));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/restore') {
    const body = await readJsonBody(req);
    if (!body || (!Array.isArray(body.accounts) && !Array.isArray(body.servers))) {
      return sendJson(res, 400, { error: 'Geçersiz yedek dosyası formatı' });
    }
    if (Array.isArray(body.accounts)) config.accounts = body.accounts;
    if (Array.isArray(body.servers)) config.servers = body.servers;
    if (body.selectedServerId) config.selectedServerId = body.selectedServerId;
    if (body.server) config.server = body.server;
    if (body.autoAuth) config.autoAuth = body.autoAuth;
    if (body.antiAfk) config.antiAfk = body.antiAfk;
    if (body.reconnect) config.reconnect = body.reconnect;
    saveConfig();
    addLog(null, 'SİSTEM', 'Yedek dosyası başarıyla yüklendi ve EXE içine gömüldü.', chalk.green);
    broadcastState();
    return sendJson(res, 200, { ok: true });
  }

  // Sunucu Ekleme
  if (req.method === 'POST' && pathname === '/api/servers') {
    const body = await readJsonBody(req);
    if (!body.host) {
      return sendJson(res, 400, { error: 'Sunucu adresi (IP/Domain) gerekli' });
    }
    const hostClean = String(body.host).trim();
    const newSrv = {
      id: 'srv_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name: String(body.name || hostClean).trim(),
      host: hostClean,
      port: Number(body.port) || 25565,
      version: body.version || false
    };
    if (!Array.isArray(config.servers)) config.servers = [];
    config.servers.push(newSrv);
    config.selectedServerId = newSrv.id;
    config.server = {
      ...config.server,
      host: newSrv.host,
      port: newSrv.port,
      version: newSrv.version
    };
    saveConfig();
    broadcastState();
    return sendJson(res, 200, newSrv);
  }

  // Sunucu Seçme / Düzenleme / Silme
  const srvMatch = pathname.match(/^\/api\/servers\/([^/]+)(?:\/(select))?$/);
  if (srvMatch) {
    const srvId = decodeURIComponent(srvMatch[1]);
    const isSelect = srvMatch[2] === 'select';
    if (!Array.isArray(config.servers)) config.servers = [];
    const srvIdx = config.servers.findIndex((s) => s.id === srvId);

    if (srvIdx === -1) {
      return sendJson(res, 404, { error: 'Sunucu bulunamadı' });
    }

    if (req.method === 'POST' && isSelect) {
      const target = config.servers[srvIdx];
      config.selectedServerId = target.id;
      config.server = {
        ...config.server,
        host: target.host,
        port: target.port,
        version: target.version
      };
      saveConfig();
      broadcastState();
      return sendJson(res, 200, target);
    }

    if (req.method === 'PUT' && !isSelect) {
      const body = await readJsonBody(req);
      const updatedSrv = {
        ...config.servers[srvIdx],
        name: String(body.name || body.host || config.servers[srvIdx].name).trim(),
        host: String(body.host || config.servers[srvIdx].host).trim(),
        port: Number(body.port) || 25565,
        version: typeof body.version !== 'undefined' ? body.version : config.servers[srvIdx].version,
        id: srvId
      };
      config.servers[srvIdx] = updatedSrv;

      if (config.selectedServerId === srvId) {
        config.server = {
          ...config.server,
          host: updatedSrv.host,
          port: updatedSrv.port,
          version: updatedSrv.version
        };
      }
      saveConfig();
      broadcastState();
      return sendJson(res, 200, updatedSrv);
    }

    if (req.method === 'DELETE' && !isSelect) {
      config.servers.splice(srvIdx, 1);
      if (config.servers.length === 0) {
        config.servers.push({
          id: 'srv_' + Date.now(),
          name: 'Varsayılan Sunucu',
          host: 'localhost',
          port: 25565,
          version: false
        });
      }
      if (!config.servers.find((s) => s.id === config.selectedServerId)) {
        config.selectedServerId = config.servers[0].id;
      }
      const active = config.servers.find((s) => s.id === config.selectedServerId);
      config.server = {
        ...config.server,
        host: active.host,
        port: active.port,
        version: active.version
      };
      saveConfig();
      broadcastState();
      return sendJson(res, 200, { ok: true });
    }
  }

  if (req.method === 'POST' && pathname === '/api/accounts') {
    const isPro = keyAuthSession.plan === 'pro';
    if (!isPro && config.accounts.length >= 3) {
      return sendJson(res, 403, {
        error: 'Starter (Ücretsiz) sürümde en fazla 3 hesap ekleyebilirsiniz. Sınırsız hesap için PRO sürüme geçin (175.00 TL - Discord: cagat).',
        requiresPro: true
      });
    }
    const body = await readJsonBody(req);
    if (!body.username) {
      return sendJson(res, 400, { error: 'Kullanıcı adı gerekli' });
    }
    if (!isPro && body.proxy && body.proxyType && body.proxyType !== 'none') {
      return sendJson(res, 403, {
        error: 'Proxy desteği yalnızca PRO Paket üyelerine açıktır (175.00 TL - Discord: cagat).',
        requiresPro: true
      });
    }
    const usernameClean = String(body.username).trim();
    const newAcc = {
      id: 'acc_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      username: usernameClean,
      password: body.password || '',
      email: body.email || '',
      proxyType: body.proxyType || 'none',
      proxy: (body.proxy || '').trim(),
      clientBrand: body.clientBrand || 'vanilla',
      customBrand: (body.customBrand || '').trim(),
      clientLocale: body.clientLocale || 'tr_TR',
      viewDistance: Number(body.viewDistance) || 10,
      mainHand: body.mainHand === 'left' ? 'left' : 'right',
      hwid: body.hwid || generateHwidString(usernameClean),
      antiAfk: body.antiAfk !== false,
      autoReconnect: body.autoReconnect !== false,
      autoEat: body.autoEat !== false,
      autoTool: body.autoTool !== false,
      autoRepair: body.autoRepair !== false,
      autoRepairThreshold: typeof body.autoRepairThreshold === 'number' ? body.autoRepairThreshold : 15,
      autoRepairCommand: body.autoRepairCommand || '/tamir',
      autoReplant: body.autoReplant !== false,
      farmRadius: typeof body.farmRadius === 'number' ? body.farmRadius : 4.2,
      farmWalk: body.farmWalk !== false,
      autoSellEnabled: body.autoSellEnabled !== false,
      autoSellCommand: body.autoSellCommand || '/sat hepsi',
      panicDisconnect: Boolean(body.panicDisconnect),
      panicHealth: Number(body.panicHealth) || 6,
      autoCommandEnabled: Boolean(body.autoCommandEnabled),
      autoCommandIntervalSec: Number(body.autoCommandIntervalSec) || 180,
      autoCommandText: body.autoCommandText || '/sell all',
      customJoinCommands: Array.isArray(body.customJoinCommands) ? body.customJoinCommands : []
    };
    config.accounts.push(newAcc);
    saveConfig();
    addLog(newAcc.id, 'SİSTEM', `"${newAcc.username}" hesabı eklendi.`, chalk.green);
    broadcastState();
    return sendJson(res, 200, newAcc);
  }

  // Toplu Proxy Havuzu Dağıtımı
  if (req.method === 'POST' && pathname === '/api/proxies/assign') {
    const isPro = keyAuthSession.plan === 'pro';
    if (!isPro) {
      return sendJson(res, 403, {
        error: 'Proxy Havuzu özelliği yalnızca PRO Paket üyelerine açıktır (175.00 TL - Discord: cagat).',
        requiresPro: true
      });
    }
    const body = await readJsonBody(req);
    if (body.action === 'clearAll') {
      config.accounts.forEach((acc) => {
        acc.proxyType = 'none';
        acc.proxy = '';
      });
      saveConfig();
      broadcastState();
      return sendJson(res, 200, { ok: true, assigned: 0 });
    }

    const proxyType = body.proxyType || 'socks5';
    const rawList = Array.isArray(body.proxies) ? body.proxies : [];
    const cleanProxies = rawList.map((s) => String(s).trim()).filter(Boolean);

    if (cleanProxies.length === 0) {
      return sendJson(res, 400, { error: 'Proxy listesi boş' });
    }

    config.accounts.forEach((acc, idx) => {
      acc.proxyType = proxyType;
      acc.proxy = cleanProxies[idx % cleanProxies.length];
    });

    saveConfig();
    broadcastState();
    return sendJson(res, 200, { ok: true, assigned: config.accounts.length });
  }

  if (req.method === 'POST' && pathname === '/api/accounts/bulk') {
    const body = await readJsonBody(req);
    const delayStep = Number(config.server.joinDelayMs) || 2500;
    const isPro = keyAuthSession.plan === 'pro';
    if (body.action === 'startAll') {
      let startedCount = 0;
      config.accounts.forEach((acc) => {
        if (!isPro && startedCount >= 3) return;
        const s = sessions.get(acc.id);
        if (!s || s.status === 'offline') {
          setTimeout(() => startBot(acc.id), startedCount * delayStep);
          startedCount++;
        }
      });
    } else if (body.action === 'stopAll') {
      config.accounts.forEach((acc) => stopBot(acc.id));
    }
    return sendJson(res, 200, { ok: true });
  }

  const accMatch = pathname.match(/^\/api\/accounts\/([^/]+)(?:\/(action))?$/);
  if (accMatch) {
    const accId = decodeURIComponent(accMatch[1]);
    const isAction = accMatch[2] === 'action';
    const accIdx = config.accounts.findIndex((a) => a.id === accId);

    if (accIdx === -1) {
      return sendJson(res, 404, { error: 'Hesap bulunamadı' });
    }

    const acc = config.accounts[accIdx];

    if (req.method === 'PUT' && !isAction) {
      const body = await readJsonBody(req);
      const isPro = keyAuthSession.plan === 'pro';
      if (!isPro && body.proxy && body.proxyType && body.proxyType !== 'none') {
        return sendJson(res, 403, {
          error: 'Proxy desteği yalnızca PRO Paket üyelerine açıktır (175.00 TL - Discord: cagat).',
          requiresPro: true
        });
      }
      config.accounts[accIdx] = {
        ...acc,
        ...body,
        id: acc.id
      };
      saveConfig();
      startSessionAntiAfk(acc.id);
      startAutoCommandLoop(acc.id);
      broadcastState();
      return sendJson(res, 200, config.accounts[accIdx]);
    }

    if (req.method === 'DELETE' && !isAction) {
      stopBot(accId);
      sessions.delete(accId);
      config.accounts.splice(accIdx, 1);
      saveConfig();
      broadcastState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && isAction) {
      const body = await readJsonBody(req);
      const s = getOrCreateSession(accId);

      const proOnlyActions = new Set([
        'moveStep',
        'lookDelta',
        'lookAtCoords',
        'jump',
        'toggleSneak',
        'regenerateHwid',
        'updateSpoofConfig',
        'builderStart',
        'builderPause',
        'builderStop',
        'builderUseBotPos',
        'builderUpdateConfig',
        'builderRestockNow',
        'builderSetCorners',
        'builderUseBotPosForCorner',
        'builderFitCorners',
        'builderFillBox',
        'builderSavePreset',
        'builderApplyPresetToAll',
        'builderDeletePreset'
      ]);
      if (proOnlyActions.has(body.action) && keyAuthSession.plan !== 'pro') {
        addLog(accId, 'KEYAUTH', 'Bu özellik yalnızca PRO Paket üyelerine açıktır (175.00 TL - Discord: cagat).', chalk.yellow);
        return sendJson(res, 403, {
          error: 'Bu özellik yalnızca PRO Paket üyelerine açıktır (175.00 TL - Discord: cagat).',
          requiresPro: true
        });
      }

      switch (body.action) {
        case 'start': {
          const isPro = keyAuthSession.plan === 'pro';
          if (!isPro) {
            let activeCount = 0;
            for (const [, sess] of sessions) {
              if (sess && (sess.status === 'online' || sess.status === 'connecting' || sess.status === 'reconnecting')) {
                activeCount++;
              }
            }
            const curSess = sessions.get(accId);
            const isCurRunning = curSess && (curSess.status === 'online' || curSess.status === 'connecting');
            if (!isCurRunning && activeCount >= 3) {
              return sendJson(res, 403, {
                error: 'Starter (Ücretsiz) sürümde aynı anda en fazla 3 bot çalıştırabilirsiniz. Sınırsız bot için PRO sürüme geçin (175.00 TL - Discord: cagat).',
                requiresPro: true
              });
            }
          }
          startBot(accId);
          break;
        }
        case 'stop':
          stopBot(accId);
          break;
        case 'reconnect':
          startBot(accId);
          break;
        case 'jump':
          if (s.bot && s.bot.entity) {
            s.bot.setControlState('jump', true);
            setTimeout(() => {
              if (s.bot) s.bot.setControlState('jump', false);
            }, 400);
          }
          break;
        case 'swing':
          if (s.bot && s.bot.entity) {
            s.bot.swingArm('right');
          }
          break;
        case 'toggleAutoMine':
          s.autoMine = !s.autoMine;
          if (s.autoMine) {
            if (s.autoFarm) {
              stopAutoFarmLoop(accId);
              s.autoFarm = false;
            }
            if (s.autoTill) {
              stopAutoTillLoop(accId);
              s.autoTill = false;
            }
            if (s.autoPlant) {
              stopAutoPlantLoop(accId);
              s.autoPlant = false;
            }
            s.isMiningBlock = false;
            if (s.bot && s.bot.entity) {
              s.baseYaw = s.bot.entity.yaw;
              s.basePitch = s.bot.entity.pitch;
            }
            s.lockedMinePos = null;
            s.lockedMineEmptySince = null;
            addLog(accId, 'OTO-KAZIM', 'Otomatik blok kırma başlatıldı. Nişangah hattı kilitlendi.', chalk.magenta);
            startAutoMineLoop(accId);
          } else {
            stopAutoMineLoop(accId);
            addLog(accId, 'OTO-KAZIM', 'Otomatik blok kırma durduruldu.', chalk.magenta);
          }
          broadcastState();
          break;
        case 'toggleAutoAttack':
          s.autoAttack = !s.autoAttack;
          if (s.autoAttack) {
            addLog(accId, 'OTO-SALDIRI', 'Otomatik mob kesme (Yalnızca önündeki hedef) başlatıldı.', chalk.magenta);
            startAutoAttackLoop(accId);
          } else {
            if (s.attackInterval) {
              clearInterval(s.attackInterval);
              s.attackInterval = null;
            }
            addLog(accId, 'OTO-SALDIRI', 'Otomatik mob kesme durduruldu.', chalk.magenta);
          }
          broadcastState();
          break;
        case 'toggleAutoRightClick':
          s.autoRightClick = !s.autoRightClick;
          if (s.autoRightClick) {
            addLog(accId, 'OTO-SAĞTIK', 'Otomatik sağ tıklama başlatıldı.', chalk.magenta);
            startAutoRightClickLoop(accId);
          } else {
            if (s.rightClickInterval) {
              clearInterval(s.rightClickInterval);
              s.rightClickInterval = null;
            }
            addLog(accId, 'OTO-SAĞTIK', 'Otomatik sağ tıklama durduruldu.', chalk.magenta);
          }
          broadcastState();
          break;
        case 'toggleSneak':
          s.sneakLock = !s.sneakLock;
          if (s.bot && s.bot.entity) {
            s.bot.setControlState('sneak', s.sneakLock);
          }
          addLog(accId, 'HAREKET', `Eğilme kilidi (Sneak): ${s.sneakLock ? 'Açık' : 'Kapalı'}`, chalk.cyan);
          broadcastState();
          break;
        case 'dropAll':
          dropAllInventory(accId);
          break;
        case 'toggleAutoChest':
          s.autoChest = !s.autoChest;
          if (s.autoChest) {
            addLog(accId, 'OTO-SANDIK', 'Otomatik sandık boşaltma başlatıldı (Envanter dolunca yakındaki sandığa aktarır).', chalk.magenta);
            startAutoChestLoop(accId);
          } else {
            if (s.chestInterval) {
              clearInterval(s.chestInterval);
              s.chestInterval = null;
            }
            addLog(accId, 'OTO-SANDIK', 'Otomatik sandık boşaltma durduruldu.', chalk.magenta);
          }
          broadcastState();
          break;
        case 'toggleAutoFarm':
          s.autoFarm = !s.autoFarm;
          if (s.autoFarm) {
            if (s.autoMine) {
              stopAutoMineLoop(accId);
              s.autoMine = false;
            }
            if (s.autoTill) {
              stopAutoTillLoop(accId);
              s.autoTill = false;
            }
            if (s.autoPlant) {
              stopAutoPlantLoop(accId);
              s.autoPlant = false;
            }
            addLog(accId, 'OTO-HASAT', '🌾 Otomatik tarla hasatı başlatıldı. Olgunlaşmış ekinler toplanıyor...', chalk.greenBright);
            startAutoFarmLoop(accId);
          } else {
            stopAutoFarmLoop(accId);
            addLog(accId, 'OTO-HASAT', '🌾 Otomatik tarla hasatı durduruldu.', chalk.magenta);
          }
          broadcastState();
          break;
        case 'toggleAutoTill':
          s.autoTill = !s.autoTill;
          if (s.autoTill) {
            if (s.autoMine) {
              stopAutoMineLoop(accId);
              s.autoMine = false;
            }
            if (s.autoFarm) {
              stopAutoFarmLoop(accId);
              s.autoFarm = false;
            }
            if (s.autoPlant) {
              stopAutoPlantLoop(accId);
              s.autoPlant = false;
            }
            addLog(accId, 'OTO-ÇAPALAMA', '🌱 Otomatik tarla çapalama başlatıldı. Toprak blokları çapalanıyor...', chalk.greenBright);
            startAutoTillLoop(accId);
          } else {
            stopAutoTillLoop(accId);
            addLog(accId, 'OTO-ÇAPALAMA', '🌱 Otomatik tarla çapalama durduruldu.', chalk.magenta);
          }
          broadcastState();
          break;
        case 'toggleAutoPlant':
          s.autoPlant = !s.autoPlant;
          if (s.autoPlant) {
            if (s.autoMine) {
              stopAutoMineLoop(accId);
              s.autoMine = false;
            }
            if (s.autoFarm) {
              stopAutoFarmLoop(accId);
              s.autoFarm = false;
            }
            if (s.autoTill) {
              stopAutoTillLoop(accId);
              s.autoTill = false;
            }
            addLog(accId, 'OTO-EKİM', '🌿 Otomatik tarla ekimi başlatıldı. Boş tarlalar taranıyor...', chalk.greenBright);
            startAutoPlantLoop(accId);
          } else {
            stopAutoPlantLoop(accId);
            addLog(accId, 'OTO-EKİM', '🌿 Otomatik tarla ekimi durduruldu.', chalk.magenta);
          }
          broadcastState();
          break;
        case 'farmerSellNow':
          if (s.bot && s.bot.entity && s.status === 'online') {
            executeFarmerSellRoutine(accId, true);
          } else {
            addLog(accId, 'ÇİFTÇİ', 'Bot sunucuya bağlı değil!', chalk.red);
          }
          break;
        case 'toggleAutoFarmerSell':
          if (!acc.autoFarmerSell) {
            acc.autoFarmerSell = { enabled: false, intervalSec: 120 };
          }
          acc.autoFarmerSell.enabled = !acc.autoFarmerSell.enabled;
          saveConfig();
          if (acc.autoFarmerSell.enabled) {
            addLog(accId, 'ÇİFTÇİ', `💰 Otomatik Çiftçi Satıcı başlatıldı. Satış aralığı: ${acc.autoFarmerSell.intervalSec || 120} saniye.`, chalk.greenBright);
            startFarmerSellLoop(accId);
          } else {
            stopFarmerSellLoop(accId);
            addLog(accId, 'ÇİFTÇİ', '💰 Otomatik Çiftçi Satıcı durduruldu.', chalk.magenta);
          }
          broadcastState();
          break;
        case 'updateFarmerSellConfig':
          if (!acc.autoFarmerSell) {
            acc.autoFarmerSell = { enabled: false, intervalSec: 120 };
          }
          if (typeof body.enabled !== 'undefined') acc.autoFarmerSell.enabled = Boolean(body.enabled);
          if (typeof body.intervalSec !== 'undefined') acc.autoFarmerSell.intervalSec = Math.max(5, Number(body.intervalSec) || 120);
          saveConfig();
          if (acc.autoFarmerSell.enabled) {
            startFarmerSellLoop(accId);
          } else {
            stopFarmerSellLoop(accId);
          }
          addLog(accId, 'ÇİFTÇİ', `Çiftçi satış aralığı ${acc.autoFarmerSell.intervalSec} saniye olarak güncellendi.`, chalk.cyan);
          broadcastState();
          break;
        case 'depositChestNow':
          depositToNearbyChest(accId, false);
          break;
        case 'repairHeldItemNow':
          if (s.bot && s.bot.entity && s.status === 'online') {
            executeAutoRepairRoutine(s.bot, s, accId, true);
          } else {
            addLog(accId, 'TAMİR', 'Bot sunucuya bağlı değil veya tamir edilecek alet tespit edilemedi.', chalk.red);
          }
          break;
        case 'resetStats':
          s.stats = {
            blocksMined: 0,
            mobsAttacked: 0,
            captchasSolved: 0,
            chestsDeposited: 0,
            blocksPlaced: 0,
            cropsHarvested: 0,
            blocksTilled: 0,
            cropsPlanted: 0,
            farmerSalesCount: 0,
            repairsCount: 0,
            connectedSince: s.status === 'online' ? Date.now() : null
          };
          addLog(accId, 'İSTATİSTİK', 'Oturum ve farm sayaçları sıfırlandı.', chalk.cyan);
          broadcastState();
          break;
        case 'equipItem':
          if (s.bot && s.bot.inventory) {
            const targetItem = s.bot.inventory.slots[Number(body.slot)];
            if (targetItem) {
              try {
                await s.bot.equip(targetItem, 'hand');
                addLog(accId, 'ENVANTER', `"${targetItem.displayName || targetItem.name}" ele alındı.`, chalk.cyan);
                broadcastState();
              } catch (e) {}
            }
          }
          break;
        case 'dropItem':
          if (s.bot && s.bot.inventory) {
            const targetItem = s.bot.inventory.slots[Number(body.slot)];
            if (targetItem) {
              try {
                await s.bot.tossStack(targetItem);
                addLog(accId, 'ENVANTER', `"${targetItem.displayName || targetItem.name}" yere atıldı.`, chalk.cyan);
                broadcastState();
              } catch (e) {}
            }
          }
          break;
        case 'useHeldItem':
          if (s.bot && s.bot.entity) {
            try {
              s.bot.activateItem();
              addLog(accId, 'EYLEM', 'Eldeki eşyaya sağ tıklandı (Menü / Pusula / Eşya kullanımı).', chalk.cyan);
            } catch (e) {}
          }
          break;
        case 'clickWindowSlot':
          if (s.bot && s.bot.currentWindow) {
            const slotNum = Number(body.slot);
            const btn = Number(body.button) || 0;
            try {
              await s.bot.clickWindow(slotNum, btn, 0);
              addLog(accId, 'MENÜ', `Menüde ${slotNum}. slota tıklandı.`, chalk.cyan);
              setTimeout(() => broadcastState(), 250);
            } catch (e) {}
          }
          break;
        case 'closeWindow':
          if (s.bot && s.bot.currentWindow) {
            try {
              s.bot.closeWindow(s.bot.currentWindow);
              broadcastState();
            } catch (e) {}
          }
          break;
        case 'moveStep':
          if (s.bot && s.bot.entity) {
            const dir = body.direction; // forward, back, left, right
            const validDirs = ['forward', 'back', 'left', 'right'];
            if (validDirs.includes(dir)) {
              const duration = Number(body.duration) || 450;
              s.bot.setControlState(dir, true);
              setTimeout(() => {
                if (s.bot) {
                  s.bot.setControlState(dir, false);
                  broadcastState();
                }
              }, duration);
            }
          }
          break;
        case 'lookDelta':
          if (s.bot && s.bot.entity) {
            const dYaw = Number(body.dYaw) || 0;
            const dPitch = Number(body.dPitch) || 0;
            if (body.resetPitch) {
              s.bot.look(s.bot.entity.yaw, 0, true);
            } else {
              const newYaw = s.bot.entity.yaw + dYaw;
              const newPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, s.bot.entity.pitch + dPitch));
              s.bot.look(newYaw, newPitch, true);
            }
            if (s.autoMine) {
              s.baseYaw = s.bot.entity.yaw;
              s.basePitch = s.bot.entity.pitch;
              s.lockedMinePos = null;
              s.lockedMineEmptySince = null;
            }
            broadcastState();
          }
          break;
        case 'lookAtCoords':
          if (s.bot && s.bot.entity && s.bot.entity.position) {
            const tx = Number(body.x);
            const ty = Number(body.y);
            const tz = Number(body.z);
            if (!Number.isNaN(tx) && !Number.isNaN(ty) && !Number.isNaN(tz)) {
              try {
                const targetVec = s.bot.entity.position.offset(
                  tx - s.bot.entity.position.x + 0.5,
                  ty - s.bot.entity.position.y + 0.5,
                  tz - s.bot.entity.position.z + 0.5
                );
                await s.bot.lookAt(targetVec, true);
                if (s.autoMine) {
                  s.baseYaw = s.bot.entity.yaw;
                  s.basePitch = s.bot.entity.pitch;
                  s.lockedMinePos = null;
                  s.lockedMineEmptySince = null;
                }
                addLog(accId, 'RADAR', `Hedef koordinata yönelindi: X:${Math.floor(tx)} Y:${Math.floor(ty)} Z:${Math.floor(tz)}`, chalk.cyan);
                broadcastState();
              } catch (e) {}
            }
          }
          break;
        case 'regenerateHwid':
          acc.hwid = generateHwidString(acc.username || acc.id);
          saveConfig();
          addLog(accId, 'SPOOF', `Yeni Donanım Kimliği (HWID) oluşturuldu: ${acc.hwid}`, chalk.cyan);
          broadcastState();
          break;
        case 'updateSpoofConfig':
          if (typeof body.clientBrand !== 'undefined') acc.clientBrand = body.clientBrand;
          if (typeof body.customBrand !== 'undefined') acc.customBrand = String(body.customBrand).trim();
          if (typeof body.clientLocale !== 'undefined') acc.clientLocale = body.clientLocale;
          if (typeof body.viewDistance !== 'undefined') acc.viewDistance = Number(body.viewDistance) || 10;
          if (typeof body.mainHand !== 'undefined') acc.mainHand = body.mainHand === 'left' ? 'left' : 'right';
          saveConfig();
          {
            const brandNow = resolveAccountBrand(acc);
            if (s.bot && s.status === 'online') {
              try {
                if (typeof s.bot.setSettings === 'function') {
                  s.bot.setSettings({
                    locale: acc.clientLocale || 'tr_TR',
                    viewDistance: Number(acc.viewDistance) || 10,
                    mainHand: acc.mainHand || 'right',
                    skinParts: deriveSkinPartsFromHwid(acc.hwid)
                  });
                }
                const chName = s.bot.supportFeature && s.bot.supportFeature('customChannelMCPrefixed')
                  ? 'MC|Brand'
                  : 'minecraft:brand';
                if (s.bot._client && typeof s.bot._client.writeChannel === 'function') {
                  s.bot._client.writeChannel(chName, brandNow);
                }
              } catch (e) {}
            }
            addLog(
              accId,
              'SPOOF',
              `Paket gizleme güncellendi -> Brand: "${brandNow}" | Dil: ${acc.clientLocale || 'tr_TR'} | Görüş: ${acc.viewDistance || 10} Chunk | HWID: ${acc.hwid}`,
              chalk.cyan
            );
          }
          broadcastState();
          break;
        case 'builderStart':
          if (!s.builder || !s.builder.blocks || s.builder.blocks.length === 0) {
            addLog(accId, 'AUTO-BUILDER', 'Önce bir .schem / .litematic dosyası yükleyin veya hazır şablon seçin!', chalk.red);
          } else {
            if (typeof body.originX === 'number' && !Number.isNaN(body.originX)) {
              s.builder.origin = {
                x: Math.floor(Number(body.originX)),
                y: Math.floor(Number(body.originY)),
                z: Math.floor(Number(body.originZ)),
                initialized: true
              };
            }
            if (s.builder.status === 'completed' || s.builder.currentIndex >= s.builder.blocks.length) {
              s.builder.currentIndex = 0;
              s.builder.placedCount = 0;
              s.builder.blocks.forEach((blk) => {
                blk.placed = false;
              });
            }
            if (s.builder.recentEmptyChests) s.builder.recentEmptyChests.clear();
            if (s.builder.lastChestFailByBlock) s.builder.lastChestFailByBlock.clear();
            s.builder.status = 'building';
            s.builder.statusMessage = `[İNŞA] İnşa başlatıldı. Hedef başlangıç: X:${s.builder.origin.x} Y:${s.builder.origin.y} Z:${s.builder.origin.z}`;
            addLog(
              accId,
              'AUTO-BUILDER',
              `"${s.builder.schematicName}" inşası başlatıldı -> Başlangıç: (${s.builder.origin.x}, ${s.builder.origin.y}, ${s.builder.origin.z})`,
              chalk.green
            );
            broadcastState();
            scheduleNextBuilderStep(accId, 100);
          }
          break;
        case 'builderPause':
          if (s.builder) {
            if (s.builderTimer) {
              clearTimeout(s.builderTimer);
              s.builderTimer = null;
            }
            s.builder.status = s.builder.status === 'paused' ? 'building' : 'paused';
            s.builder.statusMessage =
              s.builder.status === 'building'
                ? '[DEVAM] İnşaya kaldığı yerden devam ediliyor...'
                : `[DURAKLATILDI] İnşa duraklatıldı (${s.builder.placedCount}/${s.builder.totalBlocks} blok).`;
            addLog(accId, 'AUTO-BUILDER', s.builder.statusMessage, chalk.yellow);
            broadcastState();
            if (s.builder.status === 'building') {
              scheduleNextBuilderStep(accId, 150);
            }
          }
          break;
        case 'builderStop':
          if (s.builder) {
            if (s.builderTimer) {
              clearTimeout(s.builderTimer);
              s.builderTimer = null;
            }
            s.builder.status = 'idle';
            s.builder.currentIndex = 0;
            s.builder.placedCount = 0;
            s.builder.currentBlock = null;
            if (Array.isArray(s.builder.blocks)) {
              s.builder.blocks.forEach((blk) => {
                blk.placed = false;
              });
            }
            s.builder.statusMessage = '[DURDURULDU] İnşa durduruldu ve ilerleme sıfırlandı.';
            addLog(accId, 'AUTO-BUILDER', 'İnşa işlemi durduruldu ve sıfırlandı.', chalk.yellow);
            broadcastState();
          }
          break;
        case 'builderUseBotPos':
          if (!s.builder) s.builder = createDefaultBuilderState();
          if (s.bot && s.bot.entity && s.bot.entity.position) {
            const p = s.bot.entity.position.floored();
            s.builder.origin = { x: p.x, y: p.y, z: p.z, initialized: true };
            s.builder.statusMessage = `[KONUM] Başlangıç koordinatı botun konumuna ayarlandı: X:${s.builder.origin.x} Y:${s.builder.origin.y} Z:${s.builder.origin.z}`;
            addLog(accId, 'AUTO-BUILDER', s.builder.statusMessage, chalk.cyan);
            broadcastState();
          }
          break;
        case 'builderUpdateConfig':
          if (!s.builder) s.builder = createDefaultBuilderState();
          if (typeof body.originX !== 'undefined' && typeof body.originY !== 'undefined' && typeof body.originZ !== 'undefined') {
            s.builder.origin = {
              x: Math.floor(Number(body.originX) || 0),
              y: Math.floor(Number(body.originY) || 64),
              z: Math.floor(Number(body.originZ) || 0),
              initialized: true
            };
          }
          if (typeof body.delayMs !== 'undefined') {
            s.builder.delayMs = Math.max(160, Math.min(3000, Number(body.delayMs) || 190));
          }
          if (typeof body.autoRestockChest !== 'undefined') {
            s.builder.autoRestockChest = Boolean(body.autoRestockChest);
            if (s.builder.autoRestockChest) {
              if (s.builder.recentEmptyChests) s.builder.recentEmptyChests.clear();
              if (s.builder.lastChestFailByBlock) s.builder.lastChestFailByBlock.clear();
              startBuilderContinuousRestockLoop(accId);
            } else {
              stopBuilderContinuousRestockLoop(accId);
            }
          }
          if (typeof body.autoMove !== 'undefined') {
            s.builder.autoMove = Boolean(body.autoMove);
          }
          if (typeof body.clearObstacles !== 'undefined') {
            s.builder.clearObstacles = Boolean(body.clearObstacles);
          }
          if (typeof body.skipMissingBlocks !== 'undefined') {
            s.builder.skipMissingBlocks = Boolean(body.skipMissingBlocks);
          }
          if (typeof body.rotation !== 'undefined' && Number(body.rotation) !== s.builder.rotation) {
            const newRot = Number(body.rotation) || 0;
            if (Array.isArray(s.builder.rawBlocks) && s.builder.rawBlocks.length > 0) {
              const baseW = s.builder.rawWidth || (s.builder.rotation === 90 || s.builder.rotation === 270 ? s.builder.length : s.builder.width);
              const baseH = s.builder.rawHeight || s.builder.height;
              const baseL = s.builder.rawLength || (s.builder.rotation === 90 || s.builder.rotation === 270 ? s.builder.width : s.builder.length);
              const reordered = applyRotationAndOrderBlocks(
                s.builder.rawBlocks,
                baseW,
                baseH,
                baseL,
                newRot
              );
              s.builder.rotation = newRot;
              s.builder.width = reordered.width;
              s.builder.length = reordered.length;
              s.builder.blocks = reordered.blocks;
              s.builder.currentIndex = 0;
              s.builder.placedCount = 0;
            } else {
              s.builder.rotation = newRot;
            }
          }
          broadcastState();
          break;
        case 'builderToggleChain':
        case 'toggleAutoChainTillPlant':
          if (!s.builder) s.builder = createDefaultBuilderState(accId);
          if (typeof body.enabled === 'boolean') {
            s.builder.autoChainTillPlant = body.enabled;
          } else {
            s.builder.autoChainTillPlant = !s.builder.autoChainTillPlant;
          }
          acc.autoChainTillPlant = s.builder.autoChainTillPlant;
          if (!config.builderSharedCoords) config.builderSharedCoords = {};
          config.builderSharedCoords.autoChainTillPlant = s.builder.autoChainTillPlant;
          saveConfig();
          addLog(
            accId,
            'AUTO-BUILDER',
            `🔄 İnşa ➔ Çapa ➔ Ekim Otomatik Zinciri: ${s.builder.autoChainTillPlant ? 'AÇIK (İnşa bitince çapalama ve ekim yapacak)' : 'KAPALI'}`,
            s.builder.autoChainTillPlant ? chalk.cyanBright : chalk.yellow
          );
          broadcastState(true);
          break;
        case 'builderToggleRestock':
        case 'builderRestockNow':
          if (!s.builder) s.builder = createDefaultBuilderState();
          if (body.action === 'builderToggleRestock' || typeof body.enabled === 'boolean') {
            s.builder.autoRestockChest = typeof body.enabled === 'boolean' ? body.enabled : !s.builder.autoRestockChest;
          } else {
            s.builder.autoRestockChest = !s.builder.autoRestockChest;
          }
          if (s.builder.autoRestockChest) {
            if (s.builder.recentEmptyChests) s.builder.recentEmptyChests.clear();
            if (s.builder.lastChestFailByBlock) s.builder.lastChestFailByBlock.clear();
            addLog(
              accId,
              'AUTO-BUILDER',
              '📦 Yakındaki Sandıktan Sürekli Malzeme Çekme: AÇIK (Blok bittiğinde güvenli yoldan sandığa gidip tazeler)',
              chalk.greenBright
            );
            startBuilderContinuousRestockLoop(accId);
          } else {
            stopBuilderContinuousRestockLoop(accId);
            addLog(
              accId,
              'AUTO-BUILDER',
              '📦 Yakındaki Sandıktan Sürekli Malzeme Çekme: KAPALI',
              chalk.yellow
            );
          }
          broadcastState();
          break;
        case 'builderSetCorners':
          if (!s.builder) s.builder = createDefaultBuilderState();
          if (!s.builder.corners) {
            s.builder.corners = {
              pos1: { x: 0, y: 64, z: 0 },
              pos2: { x: 0, y: 64, z: 0 }
            };
          }
          if (body.pos1) {
            s.builder.corners.pos1 = {
              x: Math.floor(Number(body.pos1.x) || 0),
              y: Math.floor(Number(body.pos1.y) || 0),
              z: Math.floor(Number(body.pos1.z) || 0)
            };
          }
          if (body.pos2) {
            s.builder.corners.pos2 = {
              x: Math.floor(Number(body.pos2.x) || 0),
              y: Math.floor(Number(body.pos2.y) || 0),
              z: Math.floor(Number(body.pos2.z) || 0)
            };
          }
          broadcastState();
          break;
        case 'builderUseBotPosForCorner':
          if (!s.builder) s.builder = createDefaultBuilderState();
          if (!s.builder.corners) {
            s.builder.corners = {
              pos1: { x: 0, y: 64, z: 0 },
              pos2: { x: 0, y: 64, z: 0 }
            };
          }
          if (s.bot && s.bot.entity && s.bot.entity.position) {
            const p = s.bot.entity.position.floored();
            const cornerKey = body.corner === 'pos2' ? 'pos2' : 'pos1';
            s.builder.corners[cornerKey] = { x: p.x, y: p.y, z: p.z };
            addLog(
              accId,
              'AUTO-BUILDER',
              `Köşe (${cornerKey.toUpperCase()}) botun koordinatına ayarlandı: X:${p.x} Y:${p.y} Z:${p.z}`,
              chalk.cyan
            );
            broadcastState();
          }
          break;
        case 'builderFitCorners':
          if (!s.builder) s.builder = createDefaultBuilderState();
          {
            const p1 = (body.pos1 && typeof body.pos1.x !== 'undefined') ? body.pos1 : (s.builder.corners ? s.builder.corners.pos1 : { x: 0, y: 64, z: 0 });
            const p2 = (body.pos2 && typeof body.pos2.x !== 'undefined') ? body.pos2 : (s.builder.corners ? s.builder.corners.pos2 : { x: 0, y: 64, z: 0 });
            const minX = Math.min(Math.floor(Number(p1.x) || 0), Math.floor(Number(p2.x) || 0));
            const maxX = Math.max(Math.floor(Number(p1.x) || 0), Math.floor(Number(p2.x) || 0));
            const minY = Math.min(Math.floor(Number(p1.y) || 0), Math.floor(Number(p2.y) || 0));
            const maxY = Math.max(Math.floor(Number(p1.y) || 0), Math.floor(Number(p2.y) || 0));
            const minZ = Math.min(Math.floor(Number(p1.z) || 0), Math.floor(Number(p2.z) || 0));
            const maxZ = Math.max(Math.floor(Number(p1.z) || 0), Math.floor(Number(p2.z) || 0));

            s.builder.origin = { x: minX, y: minY, z: minZ, initialized: true };
            if (s.builder.corners) {
              s.builder.corners.pos1 = { x: Number(p1.x) || 0, y: Number(p1.y) || 0, z: Number(p1.z) || 0 };
              s.builder.corners.pos2 = { x: Number(p2.x) || 0, y: Number(p2.y) || 0, z: Number(p2.z) || 0 };
            }

            const boxW = maxX - minX + 1;
            const boxH = maxY - minY + 1;
            const boxL = maxZ - minZ + 1;

            // Eğer yüklü şema varsa ve yatay boyutları ters dönmüşse uygun döndürmeyi uygula
            if (Array.isArray(s.builder.rawBlocks) && s.builder.rawBlocks.length > 0) {
              const baseW = s.builder.rawWidth || (s.builder.rotation === 90 || s.builder.rotation === 270 ? s.builder.length : s.builder.width);
              const baseH = s.builder.rawHeight || s.builder.height;
              const baseL = s.builder.rawLength || (s.builder.rotation === 90 || s.builder.rotation === 270 ? s.builder.width : s.builder.length);

              let bestRot = s.builder.rotation || 0;
              // Sadece belirgin bir dikdörtgen alan varsa ve şemanın uzun kenarı ters ise yönlendir (kare alanlarda zorlama yapma)
              if (boxW > boxL && baseW < baseL) {
                bestRot = 90;
              } else if (boxW < boxL && baseW > baseL) {
                bestRot = 0;
              }

              const reordered = applyRotationAndOrderBlocks(
                s.builder.rawBlocks,
                baseW,
                baseH,
                baseL,
                bestRot
              );
              s.builder.rotation = bestRot;
              s.builder.width = reordered.width;
              s.builder.length = reordered.length;
              s.builder.blocks = reordered.blocks;
              s.builder.currentIndex = 0;
              s.builder.placedCount = 0;
            }

            s.builder.statusMessage = `[KÖŞE ALANI] Şema başlangıç koordinatı iki köşenin tabanına oturtuldu: X:${minX} Y:${minY} Z:${minZ} (Alan: ${boxW}x${boxH}x${boxL})`;
            addLog(accId, 'AUTO-BUILDER', s.builder.statusMessage, chalk.cyan);
            broadcastState();
          }
          break;
        case 'builderFillBox':
          {
            const p1 = (body.pos1 && typeof body.pos1.x !== 'undefined') ? body.pos1 : (s.builder.corners ? s.builder.corners.pos1 : { x: 0, y: 64, z: 0 });
            const p2 = (body.pos2 && typeof body.pos2.x !== 'undefined') ? body.pos2 : (s.builder.corners ? s.builder.corners.pos2 : { x: 29, y: 65, z: 29 });
            const blkName = body.blockName || (s.builder.corners && s.builder.corners.fillBlock) || 'stone_bricks';
            const fMode = body.fillMode || (s.builder.corners && s.builder.corners.fillMode) || 'solid';

            const boxSchem = generateBoxSchematic(p1, p2, blkName, fMode);
            loadSchematicIntoSession(accId, boxSchem, 0);

            if (s.builder) {
              if (!s.builder.corners) s.builder.corners = {};
              s.builder.corners.pos1 = { x: Math.floor(Number(p1.x) || 0), y: Math.floor(Number(p1.y) || 0), z: Math.floor(Number(p1.z) || 0) };
              s.builder.corners.pos2 = { x: Math.floor(Number(p2.x) || 0), y: Math.floor(Number(p2.y) || 0), z: Math.floor(Number(p2.z) || 0) };
              s.builder.corners.fillBlock = blkName;
              s.builder.corners.fillMode = fMode;
            }

            addLog(
              accId,
              'AUTO-BUILDER',
              `Çapraz koordinat yapısı oluşturuldu (${boxSchem.width}x${boxSchem.height}x${boxSchem.length} • ${boxSchem.rawBlocks.length} blok - ${blkName}).`,
              chalk.green
            );
            broadcastState();
          }
          break;
        case 'builderSavePreset': {
          if (!Array.isArray(config.builderPresets)) {
            config.builderPresets = [];
          }
          const presetId = body.id || `preset_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const presetName = (body.name || `Konum ${config.builderPresets.length + 1}`).trim();
          const mode = body.mode === 'corners' ? 'corners' : 'origin';
          const pos1 = body.pos1 ? {
            x: Math.floor(Number(body.pos1.x) || 0),
            y: Math.floor(Number(body.pos1.y) || 0),
            z: Math.floor(Number(body.pos1.z) || 0)
          } : null;
          const pos2 = body.pos2 ? {
            x: Math.floor(Number(body.pos2.x) || 0),
            y: Math.floor(Number(body.pos2.y) || 0),
            z: Math.floor(Number(body.pos2.z) || 0)
          } : null;
          const origin = body.origin ? {
            x: Math.floor(Number(body.origin.x) || 0),
            y: Math.floor(Number(body.origin.y) || 0),
            z: Math.floor(Number(body.origin.z) || 0)
          } : (pos1 && pos2 ? {
            x: Math.min(pos1.x, pos2.x),
            y: Math.min(pos1.y, pos2.y),
            z: Math.min(pos1.z, pos2.z)
          } : null);
          const rotation = typeof body.rotation !== 'undefined' ? Number(body.rotation) || 0 : 0;
          const delayMs = typeof body.delayMs !== 'undefined' ? Number(body.delayMs) || 190 : 190;

          const presetObj = {
            id: presetId,
            name: presetName,
            mode,
            pos1,
            pos2,
            origin,
            rotation,
            delayMs,
            updatedAt: Date.now()
          };

          const existIdx = config.builderPresets.findIndex(p => p.id === presetId || p.name.toLowerCase() === presetName.toLowerCase());
          if (existIdx >= 0) {
            presetObj.id = config.builderPresets[existIdx].id;
            config.builderPresets[existIdx] = presetObj;
          } else {
            config.builderPresets.push(presetObj);
          }

          config.builderSharedCoords = {
            mode,
            pos1,
            pos2,
            origin,
            rotation,
            delayMs
          };
          saveConfig();

          if (body.syncAll !== false) {
            for (const a of config.accounts) {
              const sess = getOrCreateSession(a.id);
              if (!sess) continue;
              if (!sess.builder) sess.builder = createDefaultBuilderState();
              if (pos1 && pos2) {
                sess.builder.corners = {
                  pos1: { ...pos1 },
                  pos2: { ...pos2 }
                };
              }
              if (origin) {
                sess.builder.origin = { ...origin, initialized: true };
              }
              if (typeof rotation === 'number') {
                sess.builder.rotation = rotation;
              }
              if (typeof delayMs === 'number') {
                sess.builder.delayMs = delayMs;
              }
              addLog(
                a.id,
                'AUTO-BUILDER',
                `[ORTAK KONUM] "${presetName}" koordinatları bu bota uygulandı${pos1 ? ` (Pos1: ${pos1.x},${pos1.y},${pos1.z} - Pos2: ${pos2.x},${pos2.y},${pos2.z})` : ` (Origin: ${origin.x},${origin.y},${origin.z})`}.`,
                chalk.cyan
              );
            }
          }

          broadcastState();
          return sendJson(res, 200, { ok: true, preset: presetObj });
        }
        case 'builderApplyPresetToAll': {
          const mode = body.mode === 'corners' ? 'corners' : 'origin';
          const pos1 = body.pos1 ? {
            x: Math.floor(Number(body.pos1.x) || 0),
            y: Math.floor(Number(body.pos1.y) || 0),
            z: Math.floor(Number(body.pos1.z) || 0)
          } : null;
          const pos2 = body.pos2 ? {
            x: Math.floor(Number(body.pos2.x) || 0),
            y: Math.floor(Number(body.pos2.y) || 0),
            z: Math.floor(Number(body.pos2.z) || 0)
          } : null;
          const origin = body.origin ? {
            x: Math.floor(Number(body.origin.x) || 0),
            y: Math.floor(Number(body.origin.y) || 0),
            z: Math.floor(Number(body.origin.z) || 0)
          } : (pos1 && pos2 ? {
            x: Math.min(pos1.x, pos2.x),
            y: Math.min(pos1.y, pos2.y),
            z: Math.min(pos1.z, pos2.z)
          } : null);
          const rotation = typeof body.rotation !== 'undefined' ? Number(body.rotation) || 0 : undefined;
          const delayMs = typeof body.delayMs !== 'undefined' ? Number(body.delayMs) || 190 : undefined;
          const presetLabel = body.presetName ? `"${body.presetName}"` : 'Koordinatlar';

          config.builderSharedCoords = {
            mode,
            pos1,
            pos2,
            origin,
            rotation: typeof rotation === 'number' ? rotation : 0,
            delayMs: typeof delayMs === 'number' ? delayMs : 190
          };
          saveConfig();

          let count = 0;
          for (const a of config.accounts) {
            const sess = getOrCreateSession(a.id);
            if (!sess) continue;
            if (!sess.builder) sess.builder = createDefaultBuilderState();
            if (pos1 && pos2) {
              sess.builder.corners = {
                pos1: { ...pos1 },
                pos2: { ...pos2 }
              };
            }
            if (origin) {
              sess.builder.origin = { ...origin, initialized: true };
            }
            if (typeof rotation === 'number') {
              sess.builder.rotation = rotation;
            }
            if (typeof delayMs === 'number') {
              sess.builder.delayMs = delayMs;
            }
            addLog(
              a.id,
              'AUTO-BUILDER',
              `[ORTAK KONUM] ${presetLabel} tüm botlara eşitlendi.`,
              chalk.cyan
            );
            count++;
          }

          broadcastState();
          return sendJson(res, 200, { ok: true, syncedCount: count });
        }
        case 'builderDeletePreset': {
          if (Array.isArray(config.builderPresets)) {
            config.builderPresets = config.builderPresets.filter(p => p.id !== body.id);
            saveConfig();
          }
          broadcastState();
          return sendJson(res, 200, { ok: true });
        }
        case 'login':
          if (s.bot && acc.password) {
            const cmd = ((config.autoAuth && config.autoAuth.loginCommand) || '/login {password}')
              .replace(/\{password\}/g, acc.password)
              .replace(/\{email\}/g, acc.email || '');
            addLog(accId, 'SEN', cmd, chalk.cyanBright);
            s.bot.chat(cmd);
          }
          break;
        case 'register':
          if (s.bot && acc.password) {
            const cmd = buildSmartRegisterCommand('', acc);
            addLog(accId, 'SEN', cmd, chalk.cyanBright);
            s.bot.chat(cmd);
          }
          break;
      }
      return sendJson(res, 200, { ok: true });
    }
  }

  if (req.method === 'POST' && pathname === '/api/config') {
    const body = await readJsonBody(req);
    if (body.server) {
      config.server = { ...config.server, ...body.server };
      const activeIdx = (config.servers || []).findIndex((s) => s.id === config.selectedServerId);
      if (activeIdx !== -1) {
        config.servers[activeIdx] = {
          ...config.servers[activeIdx],
          host: config.server.host,
          port: config.server.port,
          version: config.server.version
        };
      }
    }
    if (body.autoAuth) config.autoAuth = { ...config.autoAuth, ...body.autoAuth };
    if (body.antiAfk) config.antiAfk = { ...config.antiAfk, ...body.antiAfk };
    if (body.reconnect) config.reconnect = { ...config.reconnect, ...body.reconnect };
    if (body.discord) config.discord = { ...(config.discord || {}), ...body.discord };
    if (body.soundAlerts) config.soundAlerts = { ...(config.soundAlerts || {}), ...body.soundAlerts };
    if (body.autoCaptcha) config.autoCaptcha = { ...(config.autoCaptcha || {}), ...body.autoCaptcha };
    if (body.discordRpc) {
      const oldClientId = config.discordRpc?.clientId;
      const oldEnabled = config.discordRpc?.enabled;
      config.discordRpc = { ...(config.discordRpc || {}), ...body.discordRpc };
      if (oldClientId !== config.discordRpc.clientId || oldEnabled !== config.discordRpc.enabled) {
        initDiscordRPC();
      } else {
        updateDiscordRPC(true);
      }
    }
    saveConfig();

    for (const acc of config.accounts) {
      startSessionAntiAfk(acc.id);
    }
    broadcastState();
    return sendJson(res, 200, config);
  }

  if (req.method === 'POST' && pathname === '/api/discord/test') {
    const body = await readJsonBody(req);
    if (body.webhookUrl) {
      config.discord = { ...(config.discord || {}), webhookUrl: String(body.webhookUrl).trim() };
    }
    const ok = await sendDiscordWebhook(
      'SCT AFK Service - Test Bildirimi',
      'Discord Webhook bağlantınız başarıyla çalışıyor! Bot durum bildirimleri bu kanala iletilecektir.',
      0xffffff,
      null,
      true
    );
    return sendJson(res, 200, { ok });
  }

  // --- HOT-UPDATE ENDPOINTLERİ ---
  if (req.method === 'GET' && pathname === '/api/updates/status') {
    return sendJson(res, 200, {
      currentBuildId: ENGINE_BUILD_ID,
      ...updateCheckState,
      config: config.updates
    });
  }

  if (req.method === 'POST' && pathname === '/api/updates/check') {
    const status = await checkForUpdates();
    broadcastState();
    return sendJson(res, 200, {
      currentBuildId: ENGINE_BUILD_ID,
      ...status,
      config: config.updates
    });
  }

  if (req.method === 'POST' && pathname === '/api/updates/apply') {
    try {
      const result = await applyHotUpdate();
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/updates/config') {
    const body = await readJsonBody(req);
    config.updates = {
      ...(config.updates || {}),
      ...body
    };
    saveConfig();
    broadcastState();
    return sendJson(res, 200, { ok: true, config: config.updates });
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    const body = await readJsonBody(req);
    const msg = String(body.message || '').trim();
    if (!msg) return sendJson(res, 400, { error: 'Boş mesaj' });

    if (body.accountId === 'all') {
      for (const acc of config.accounts) {
        const s = sessions.get(acc.id);
        if (s && s.bot && s.status === 'online') {
          s.bot.chat(msg);
          addLog(acc.id, 'SEN', msg, chalk.cyanBright);
        }
      }
    } else {
      const s = sessions.get(body.accountId);
      if (s && s.bot && s.status === 'online') {
        s.bot.chat(msg);
        addLog(body.accountId, 'SEN', msg, chalk.cyanBright);
      } else {
        addLog(body.accountId, 'UYARI', 'Bot çevrimiçi olmadığı için mesaj gönderilemedi.', chalk.yellow);
      }
    }
    return sendJson(res, 200, { ok: true });
  }

  res.writeHead(404);
  res.end('Not found');
});

function applyWindowIconWin32() {
  const icoPath = path.join(__dirname, 'app.ico');
  if (!fs.existsSync(icoPath)) return;
  const escapedIco = icoPath.replace(/'/g, "''");
  const psScript = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinIconSetter {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder strText, int maxCount);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", EntryPoint = "SetClassLongPtrW")] public static extern IntPtr SetClassLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
}
"@ -ErrorAction SilentlyContinue
$ico = New-Object System.Drawing.Icon('${escapedIco}', 256, 256)
$icoSm = New-Object System.Drawing.Icon('${escapedIco}', 32, 32)
for ($i = 0; $i -lt 16; $i++) {
    $found = $false
    [WinIconSetter]::EnumWindows({
        param($hWnd, $lParam)
        if ([WinIconSetter]::IsWindowVisible($hWnd)) {
            $sb = New-Object System.Text.StringBuilder 256
            [void][WinIconSetter]::GetWindowText($hWnd, $sb, 256)
            $title = $sb.ToString()
            if ($title -like '*SCT AFK Service*') {
                [void][WinIconSetter]::SendMessage($hWnd, 0x0080, [IntPtr]1, $ico.Handle)
                [void][WinIconSetter]::SendMessage($hWnd, 0x0080, [IntPtr]0, $icoSm.Handle)
                try {
                    [void][WinIconSetter]::SetClassLongPtr64($hWnd, -14, $ico.Handle)
                    [void][WinIconSetter]::SetClassLongPtr64($hWnd, -34, $icoSm.Handle)
                } catch {}
                $script:found = $true
            }
        }
        return $true
    }, [IntPtr]::Zero) | Out-Null
    if ($found) { Start-Sleep -Milliseconds 600; break }
    Start-Sleep -Milliseconds 350
}
`;
  execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psScript], { windowsHide: true }, () => {});
}

function openExternalUrl(target) {
  if (process.platform === 'win32') {
    exec(`start "" "${target}"`, { windowsHide: true }, () => {});
  } else if (process.platform === 'darwin') {
    exec(`open "${target}"`);
  } else {
    exec(`xdg-open "${target}"`);
  }
}

const CHROMIUM_EXE_NAMES = ['chrome.exe', 'msedge.exe', 'brave.exe', 'opera.exe', 'launcher.exe', 'vivaldi.exe', 'browser.exe', 'chromium.exe', 'thorium.exe'];

function regQueryValue(key, valueArgs, cb) {
  execFile('reg', ['query', key, ...valueArgs], { windowsHide: true }, (err, stdout) => {
    if (err || !stdout) return cb(null);
    const m = stdout.match(/REG_(?:EXPAND_)?SZ\s+(.+)/);
    cb(m ? m[1].trim() : null);
  });
}

function getDefaultBrowserExe(cb) {
  regQueryValue('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', ['/v', 'ProgId'], (progId) => {
    if (!progId) return cb(null);
    regQueryValue(`HKCR\\${progId}\\shell\\open\\command`, ['/ve'], (cmd) => {
      if (!cmd) return cb(null);
      const m = cmd.match(/^"([^"]+\.exe)"/i) || cmd.match(/^(\S+\.exe)/i);
      cb(m && fs.existsSync(m[1]) ? m[1] : null);
    });
  });
}

function findInstalledChromium() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';
  const candidates = [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ];
  return candidates.find((c) => c && fs.existsSync(c)) || null;
}

function launchAppWindow(browserExe, appUrl) {
  // Kullanıcının mevcut tarayıcı profili kullanılır: ayrı/boş profil açılmadığı için
  // "oturum açıldı / eşitleme / ilk çalıştırma" gibi pop-up'lar hiç çıkmaz.
  try {
    const oldProfile = path.join(__dirname, '.app-window-profile');
    if (fs.existsSync(oldProfile)) {
      fs.rm(oldProfile, { recursive: true, force: true }, () => {});
    }
  } catch (e) {}

  try {
    const child = spawn(browserExe, [`--app=${appUrl}`, '--window-size=1200,760'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.on('error', () => openExternalUrl(appUrl));
    child.unref();
    return true;
  } catch (e) {
    return false;
  }
}

function openClientWindow(url) {
  const appUrl = url.includes('?') ? url : `${url}/?v=${ENGINE_BUILD_ID}`;

  if (process.platform !== 'win32') {
    openExternalUrl(appUrl);
    return;
  }

  // Varsayılan tarayıcı Chromium tabanlıysa (Chrome, Opera, Brave, Edge, Vivaldi) onu uygulama penceresi modunda aç.
  // Varsayılan tarayıcı Firefox gibi app modu desteklemeyen bir tarayıcıysa, yüklü bir Chromium tarayıcıyla uygulama penceresi aç.
  getDefaultBrowserExe((defaultExe) => {
    let browserExe = null;
    if (defaultExe && CHROMIUM_EXE_NAMES.includes(path.basename(defaultExe).toLowerCase())) {
      browserExe = defaultExe;
    } else {
      browserExe = findInstalledChromium();
    }

    if (!browserExe || !launchAppWindow(browserExe, appUrl)) {
      openExternalUrl(appUrl);
    }
  });
}

const PORT = Number(config.uiPort) || 3847;
const CLIENT_URL = `http://127.0.0.1:${PORT}`;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    http
      .get(`http://127.0.0.1:${PORT}/api/keyauth/status`, (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let isSameBuild = false;
          try {
            const parsed = JSON.parse(raw);
            if (res.statusCode === 200 && parsed && parsed.engineBuildId === ENGINE_BUILD_ID) {
              isSameBuild = true;
            }
          } catch (e) {}

          if (isSameBuild) {
            openClientWindow(CLIENT_URL);
            setTimeout(() => process.exit(0), 500);
          } else {
            // Eski motor çalışıyorsa kapatıp yeni KeyAuth motorunu başlat
            const req = http.request({ hostname: '127.0.0.1', port: PORT, path: '/api/shutdown', method: 'POST' }, () => {
              setTimeout(() => {
                server.listen(PORT, '127.0.0.1');
              }, 650);
            });
            req.on('error', () => {
              setTimeout(() => server.listen(PORT, '127.0.0.1'), 650);
            });
            req.end();
          }
        });
      })
      .on('error', () => {
        setTimeout(() => {
          try {
            server.listen(PORT, '127.0.0.1');
          } catch (e) {}
        }, 1000);
      });
  }
});

// Lisans Süresi Kontrolcüsü (Süre dolduğunda aktif botları durdurur ve Starter'a çeker)
setInterval(() => {
  if (
    keyAuthSession.plan === 'pro' &&
    keyAuthSession.expiryTimestamp &&
    keyAuthSession.expiryTimestamp > 0 &&
    Date.now() >= keyAuthSession.expiryTimestamp
  ) {
    config.accounts.forEach((acc) => stopBot(acc.id));
    keyAuthSession.plan = 'starter';
    keyAuthSession.planLabel = 'STARTER';
    keyAuthSession.isPro = false;
    keyAuthSession.subscription = 'Starter (Ücretsiz)';
    keyAuthSession.expiryTimestamp = null;
    clearLocalKeyAuthCredentials();
    addLog(null, 'KEYAUTH', 'Lisans süreniz sona erdi! Starter (ücretsiz) sürüme geçildi.', chalk.red);
    broadcastState();
  }
}, 30000);

// --- SCT MERKEZİ ADMİN & TELEMETRİ KÖPRÜ RAPORLAYICISI ---
function startAdminRelayReporter() {
  const DEFAULT_MASTER_RELAY_URL = 'http://148.135.181.63:4890';
  const relayCfg = config.adminRelay || {};
  if (relayCfg.enabled === false) return;

  let rawUrl = (relayCfg.serverUrl || '').trim();
  if (!rawUrl || rawUrl.includes('127.0.0.1') || rawUrl.includes('localhost')) {
    rawUrl = DEFAULT_MASTER_RELAY_URL;
  }

  let urlParsed;
  try {
    urlParsed = new URL(rawUrl);
  } catch (e) {
    console.warn('[ADMIN-RELAY] Geçersiz serverUrl:', rawUrl);
    return;
  }

  const isHttps = urlParsed.protocol === 'https:';
  const httpMod = isHttps ? require('https') : require('http');

  function sendPost(pathname, data, callback) {
    try {
      const postData = JSON.stringify(data);
      const req = httpMod.request(
        {
          hostname: urlParsed.hostname,
          port: urlParsed.port || (isHttps ? 443 : 80),
          path: pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'X-Client-Key': relayCfg.clientKey || 'SCT_CLIENT_RELAY_KEY_2026'
          },
          timeout: 4000
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              if (callback) callback(null, parsed);
            } catch (e) {
              if (callback) callback(e);
            }
          });
        }
      );
      req.on('error', (err) => {
        if (callback) callback(err);
      });
      req.on('timeout', () => {
        req.destroy();
        if (callback) callback(new Error('Relay request timed out'));
      });
      req.write(postData);
      req.end();
    } catch (err) {
      if (callback) callback(err);
    }
  }

  function sendCommandAck(commandId, command, status, message) {
    try {
      const authStatus = getPublicKeyAuthStatus();
      const clientId = authStatus.hwid || authStatus.username || 'SCT_CLIENT';
      sendPost('/api/client/command-response', {
        clientId,
        commandId,
        command,
        status,
        message
      });
    } catch (e) {}
  }

  function collectBotsSummary() {
    const bots = [];
    if (!Array.isArray(config.accounts)) return bots;

    for (const acc of config.accounts) {
      const s = sessions.get(acc.id);
      const isOnline = Boolean(s && s.status === 'online' && s.bot);
      let moduleName = 'Boşta';

      if (isOnline) {
        if (s.autoMine) moduleName = '⛏️ Kazıcı';
        else if (s.autoAttack) moduleName = '⚔️ Savaşçı';
        else if (s.autoFarm) moduleName = '🌾 Çiftçi';
        else if (s.autoTill) moduleName = '🌱 Çapa';
        else if (s.autoPlant) moduleName = '🌿 Ekim';
        else if (s.builder && s.builder.active) moduleName = '🧱 İnşaat';
        else moduleName = '⚡ AFK Bekleme';
      } else {
        moduleName = s && s.status ? s.status : 'Çevrimdışı';
      }

      const botEntity = s && s.bot && s.bot.entity;
      const pos = botEntity && botEntity.position ? {
        x: Math.round(botEntity.position.x),
        y: Math.round(botEntity.position.y),
        z: Math.round(botEntity.position.z)
      } : null;

      bots.push({
        accountId: acc.id,
        username: acc.username,
        connected: isOnline,
        module: moduleName,
        health: (s && s.bot && typeof s.bot.health === 'number') ? s.bot.health : 20,
        food: (s && s.bot && typeof s.bot.food === 'number') ? s.bot.food : 20,
        position: pos,
        stats: s && s.stats ? s.stats : {}
      });
    }

    return bots;
  }

  function handleIncomingCommand(cmd) {
    if (!cmd || !cmd.command) return;
    const { id: cmdId, command, payload = {} } = cmd;

    try {
      switch (command) {
        case 'restart_app': {
          sendCommandAck(cmdId, command, 'success', 'Uygulama yeniden başlatılıyor...');
          addLog(null, 'ADMİN', 'Admin tarafından uygulama uzaktan yeniden başlatılıyor...', chalk.yellow);
          for (const a of config.accounts) {
            stopBot(a.id);
          }
          setTimeout(() => {
            try {
              const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
                cwd: __dirname,
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
                env: process.env
              });
              child.unref();
            } catch (e) {}
            process.exit(0);
          }, 1200);
          break;
        }

        case 'stop_all': {
          for (const a of config.accounts) {
            stopBot(a.id);
          }
          addLog(null, 'ADMİN', 'Tüm botlar Admin komutuyla durduruldu!', chalk.red);
          sendCommandAck(cmdId, command, 'success', 'Tüm botlar durduruldu');
          break;
        }

        case 'start_all': {
          let count = 0;
          for (const a of config.accounts) {
            setTimeout(() => startBot(a.id), count * 1500);
            count++;
          }
          addLog(null, 'ADMİN', 'Tüm botlar Admin komutuyla başlatılıyor...', chalk.green);
          sendCommandAck(cmdId, command, 'success', `${count} bot sırayla başlatılıyor`);
          break;
        }

        case 'stop_bot': {
          const target = config.accounts.find(a => a.username === payload.botName || a.id === payload.accountId);
          if (target) {
            stopBot(target.id);
            addLog(target.id, 'ADMİN', `Bot (${target.username}) Admin tarafından durduruldu.`, chalk.yellow);
            sendCommandAck(cmdId, command, 'success', `Bot "${target.username}" durduruldu`);
          } else {
            sendCommandAck(cmdId, command, 'error', `Hedef bot bulunamadı: ${payload.botName || payload.accountId}`);
          }
          break;
        }

        case 'start_bot': {
          const target = config.accounts.find(a => a.username === payload.botName || a.id === payload.accountId);
          if (target) {
            startBot(target.id);
            addLog(target.id, 'ADMİN', `Bot (${target.username}) Admin tarafından başlatılıyor.`, chalk.green);
            sendCommandAck(cmdId, command, 'success', `Bot "${target.username}" başlatıldı`);
          } else {
            sendCommandAck(cmdId, command, 'error', `Hedef bot bulunamadı: ${payload.botName || payload.accountId}`);
          }
          break;
        }

        case 'send_chat': {
          const target = config.accounts.find(a => a.username === payload.botName);
          if (!target) {
            sendCommandAck(cmdId, command, 'error', `Bot "${payload.botName}" bulunamadı`);
            return;
          }
          const s = sessions.get(target.id);
          if (s && s.bot && s.status === 'online') {
            s.bot.chat(payload.message);
            addLog(target.id, 'ADMİN', `Admin sohbet komutu: ${payload.message}`, chalk.cyan);
            sendCommandAck(cmdId, command, 'success', `Mesaj iletildi: "${payload.message}"`);
          } else {
            sendCommandAck(cmdId, command, 'error', `Bot "${payload.botName}" çevrimdışı`);
          }
          break;
        }

        case 'broadcast': {
          if (payload.message) {
            broadcastSSE('desktop-notification', {
              title: '🛡️ Yönetici Bildirimi',
              message: payload.message
            });
            addLog(null, 'DUYURU', `[YÖNETİCİ BİLDİRİMİ] ${payload.message}`, chalk.magentaBright);
            sendCommandAck(cmdId, command, 'success', 'Duyuru kullanıcı ekranına iletildi');
          }
          break;
        }

        case 'request_logs': {
          const authStatus = getPublicKeyAuthStatus();
          const clientId = authStatus.hwid || authStatus.username || 'SCT_CLIENT';
          const logsSlice = recentLogs.slice(-40).map(l => {
            if (typeof l === 'string') return l;
            return `[${l.time || ''}] [${l.tag || 'BİLGİ'}] ${l.message || ''}`;
          });
          sendPost('/api/client/logs', {
            clientId,
            logs: logsSlice
          });
          sendCommandAck(cmdId, command, 'success', 'Log akışı yöneticiye iletildi');
          break;
        }

        default:
          sendCommandAck(cmdId, command, 'error', `Bilinmeyen komut: ${command}`);
          break;
      }
    } catch (cmdErr) {
      sendCommandAck(cmdId, command, 'error', `Hata: ${cmdErr.message}`);
    }
  }

  // Kalp atışı (Heartbeat) döngüsü
  const intervalMs = Math.max(2, (relayCfg.intervalSec || 4)) * 1000;
  setInterval(() => {
    try {
      const authStatus = getPublicKeyAuthStatus();
      const hwid = authStatus.hwid || 'HWID-YOK';
      const payload = {
        hwid,
        username: authStatus.username || 'Kullanıcı',
        appVersion: KEYAUTH_CONFIG.version || '2.2.0',
        buildId: ENGINE_BUILD_ID,
        uptime: Math.floor(process.uptime()),
        bots: collectBotsSummary(),
        clientKey: relayCfg.clientKey || 'SCT_CLIENT_RELAY_KEY_2026'
      };

      sendPost('/api/client/heartbeat', payload, (err, res) => {
        if (!err && res && Array.isArray(res.commands)) {
          for (const cmd of res.commands) {
            handleIncomingCommand(cmd);
          }
        }
      });
    } catch (e) {}
  }, intervalMs);

  console.log(chalk.cyan(`[ADMİN-RELAY] Uzak yönetim köprüsüne bağlanılıyor: ${relayCfg.serverUrl}`));
}

server.listen(PORT, '127.0.0.1', () => {
  try {
    fs.writeFileSync(path.join(__dirname, 'server.pid'), String(process.pid));
  } catch (e) {}
  console.log(chalk.bold.green('===================================================='));
  console.log(chalk.bold.green('            SCT AFK Client Başlatıldı               '));
  console.log(chalk.bold.green('===================================================='));
  if (process.env.SCT_LAUNCHER_MANAGED !== '1') {
    openClientWindow(CLIENT_URL);
  }
  initDiscordRPC();
  startAdminRelayReporter();

  // Otomatik Güncelleme İlk Kontrolü ve Arka Plan Zamanlayıcısı
  setTimeout(() => {
    if (config.updates && config.updates.enabled !== false) {
      checkForUpdates().then((res) => {
        if (res && res.hasUpdate) {
          addLog(null, 'GÜNCELLEME', `Yeni bir güncelleme mevcut: ${res.latestBuildId} (${res.version})`, chalk.yellow);
          if (config.updates.autoApply) {
            applyHotUpdate().catch(e => console.error('Otomatik güncelleme hatası:', e));
          } else {
            broadcastState();
          }
        }
      }).catch(() => {});
    }
  }, 7000);

  setInterval(() => {
    if (config.updates && config.updates.enabled !== false) {
      checkForUpdates().then((res) => {
        if (res && res.hasUpdate) {
          broadcastState();
          if (config.updates.autoApply) {
            applyHotUpdate().catch(e => console.error('Otomatik güncelleme hatası:', e));
          }
        }
      }).catch(() => {});
    }
  }, 30 * 60 * 1000);
});

process.on('exit', () => {
  try {
    const pidFile = path.join(__dirname, 'server.pid');
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  } catch (e) {}
});
