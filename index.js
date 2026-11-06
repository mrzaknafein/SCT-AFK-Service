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

const ENGINE_BUILD_ID = '20261106_native_wpf_gui_v80';
const CONFIG_PATH = path.join(__dirname, 'config.json');
const KEYAUTH_SAVED_PATH = path.join(__dirname, 'keyauth_saved.json');

function getMigrationCandidateDirs() {
  const dirs = [];
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  if (localAppData) {
    dirs.push(path.join(localAppData, 'SCT_AFK_Service'));
  }
  dirs.push(path.join(__dirname, '..', '.sct-afk-engine'));
  dirs.push(path.join(__dirname, '..', 'minecraft-afk-client'));
  return dirs.filter((d) => {
    try {
      return path.resolve(d).toLowerCase() !== path.resolve(__dirname).toLowerCase();
    } catch (e) {
      return false;
    }
  });
}

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
    if (!fs.existsSync(KEYAUTH_SAVED_PATH)) {
      for (const dir of getMigrationCandidateDirs()) {
        const cand = path.join(dir, 'keyauth_saved.json');
        if (fs.existsSync(cand)) {
          try {
            fs.copyFileSync(cand, KEYAUTH_SAVED_PATH);
            break;
          } catch (e) {}
        }
      }
    }
    if (!fs.existsSync(KEYAUTH_SAVED_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(KEYAUTH_SAVED_PATH, 'utf8').replace(/^\uFEFF/, ''));
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
    buildId: ENGINE_BUILD_ID,
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
      parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));
    }
    const hasAccounts = Array.isArray(parsed.accounts) && parsed.accounts.length > 0;
    const hasCustomSrv = Array.isArray(parsed.servers) && parsed.servers.some((s) => s && s.host && s.host !== 'localhost');
    if (!hasAccounts && !hasCustomSrv) {
      for (const dir of getMigrationCandidateDirs()) {
        const candCfg = path.join(dir, 'config.json');
        if (fs.existsSync(candCfg)) {
          try {
            const candParsed = JSON.parse(fs.readFileSync(candCfg, 'utf8').replace(/^\uFEFF/, ''));
            const candHasAcc = Array.isArray(candParsed.accounts) && candParsed.accounts.length > 0;
            const candHasSrv = Array.isArray(candParsed.servers) && candParsed.servers.some((s) => s && s.host && s.host !== 'localhost');
            if (candHasAcc || candHasSrv) {
              parsed = candParsed;
              fs.writeFileSync(CONFIG_PATH, JSON.stringify(parsed, null, 2), 'utf8');
              break;
            }
          } catch (e) {}
        }
      }
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
        ...acc,
        autoEat: typeof acc.autoEat === 'boolean' ? acc.autoEat : true,
        autoTool: typeof acc.autoTool === 'boolean' ? acc.autoTool : true,
        panicDisconnect: Boolean(acc.panicDisconnect),
        panicHealth: typeof acc.panicHealth === 'number' ? acc.panicHealth : 6,
        autoCommandEnabled: Boolean(acc.autoCommandEnabled),
        autoCommandIntervalSec: typeof acc.autoCommandIntervalSec === 'number' ? acc.autoCommandIntervalSec : 180,
        autoCommandText: acc.autoCommandText || '/sell all',
        autoFarmerSell: acc.autoFarmerSell && typeof acc.autoFarmerSell === 'object'
          ? { enabled: Boolean(acc.autoFarmerSell.enabled), intervalSec: Math.max(5, Number(acc.autoFarmerSell.intervalSec) || 120) }
          : { enabled: false, intervalSec: 120 },
        autoMinerChestSell: acc.autoMinerChestSell && typeof acc.autoMinerChestSell === 'object'
          ? { enabled: Boolean(acc.autoMinerChestSell.enabled), intervalSec: Math.max(5, Number(acc.autoMinerChestSell.intervalSec) || 10) }
          : { enabled: false, intervalSec: 10 },
        autoSpawnerRoutine: acc.autoSpawnerRoutine && typeof acc.autoSpawnerRoutine === 'object'
          ? {
              enabled: Boolean(acc.autoSpawnerRoutine.enabled),
              intervalSec: Math.max(10, Number(acc.autoSpawnerRoutine.intervalSec) || 30),
              spawnerCount: typeof acc.autoSpawnerRoutine.spawnerCount === 'number' ? Math.max(0, Math.min(256, Number(acc.autoSpawnerRoutine.spawnerCount))) : 0,
              customCoords: typeof acc.autoSpawnerRoutine.customCoords === 'string' ? acc.autoSpawnerRoutine.customCoords : ''
            }
          : { enabled: false, intervalSec: 30, spawnerCount: 0, customCoords: '' },
        autoJackOLantern: acc.autoJackOLantern && typeof acc.autoJackOLantern === 'object'
          ? {
              enabled: Boolean(acc.autoJackOLantern.enabled),
              intervalSec: Math.max(5, Number(acc.autoJackOLantern.intervalSec) || 20),
              batchSize: Math.max(1, Math.min(64, Number(acc.autoJackOLantern.batchSize) || 32)),
              pumpkinChest: typeof acc.autoJackOLantern.pumpkinChest === 'string' ? acc.autoJackOLantern.pumpkinChest : '',
              torchChest: typeof acc.autoJackOLantern.torchChest === 'string' ? acc.autoJackOLantern.torchChest : '',
              outputChest: typeof acc.autoJackOLantern.outputChest === 'string' ? acc.autoJackOLantern.outputChest : '',
              ironChest: typeof acc.autoJackOLantern.ironChest === 'string' ? acc.autoJackOLantern.ironChest : '',
              stickChest: typeof acc.autoJackOLantern.stickChest === 'string' ? acc.autoJackOLantern.stickChest : '',
              carveSpot: typeof acc.autoJackOLantern.carveSpot === 'string' ? acc.autoJackOLantern.carveSpot : ''
            }
          : { enabled: false, intervalSec: 20, batchSize: 32, pumpkinChest: '', torchChest: '', outputChest: '', ironChest: '', stickChest: '', carveSpot: '' },
        clientBrand: acc.clientBrand || 'vanilla',
        customBrand: acc.customBrand || '',
        clientLocale: acc.clientLocale || 'tr_TR',
        viewDistance: typeof acc.viewDistance === 'number' ? acc.viewDistance : 10,
        mainHand: acc.mainHand || 'right',
        hwid: acc.hwid || generateHwidString(acc.username || acc.id)
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
      theme: 'cyber',
      volume: 35,
      onDamage: true,
      onDisconnect: true,
      onMention: true,
      onCaptcha: true,
      onNotify: true
    };
    updated = true;
  } else {
    if (typeof parsed.soundAlerts.theme !== 'string') {
      parsed.soundAlerts.theme = 'cyber';
      updated = true;
    }
    if (typeof parsed.soundAlerts.volume !== 'number') {
      parsed.soundAlerts.volume = 35;
      updated = true;
    }
    if (typeof parsed.soundAlerts.onNotify === 'undefined') {
      parsed.soundAlerts.onNotify = true;
      updated = true;
    }
  }

  if (!parsed.desktopNotifications) {
    parsed.desktopNotifications = {
      enabled: false,
      onMention: false,
      onDisconnect: false,
      onDeath: false,
      onCaptcha: false,
      onNotify: false
    };
    updated = true;
  }

  if (!parsed.multiBotCooperation) {
    parsed.multiBotCooperation = {
      enabled: true,
      builderSync: true,
      tillSync: true,
      plantSync: true,
      chestSync: true
    };
    updated = true;
  } else {
    if (typeof parsed.multiBotCooperation.enabled === 'undefined') {
      parsed.multiBotCooperation.enabled = true;
      updated = true;
    }
    if (typeof parsed.multiBotCooperation.builderSync === 'undefined') {
      parsed.multiBotCooperation.builderSync = true;
      updated = true;
    }
    if (typeof parsed.multiBotCooperation.tillSync === 'undefined') {
      parsed.multiBotCooperation.tillSync = true;
      updated = true;
    }
    if (typeof parsed.multiBotCooperation.plantSync === 'undefined') {
      parsed.multiBotCooperation.plantSync = true;
      updated = true;
    }
    if (typeof parsed.multiBotCooperation.chestSync === 'undefined') {
      parsed.multiBotCooperation.chestSync = true;
      updated = true;
    }
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

function httpFetchUrl(urlStr, maxRedirects = 5, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Çok fazla yönlendirme sınırı'));
    const parsed = new URL(urlStr);
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(urlStr, {
      headers: {
        'User-Agent': 'SCT-AFK-Engine/1.0',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        ...extraHeaders
      },
      timeout: 12000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = new URL(redirectUrl, urlStr).toString();
        }
        res.resume();
        return resolve(httpFetchUrl(redirectUrl, maxRedirects - 1, extraHeaders));
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

function extractBuildVersionNum(buildId) {
  if (!buildId || typeof buildId !== 'string') return 0;
  const m = buildId.match(/_v(\d+)$/i);
  return m ? parseInt(m[1], 10) || 0 : 0;
}

function isBuildIdNewer(candidate, baseline) {
  if (!candidate) return false;
  if (!baseline) return true;
  if (candidate === baseline) return false;
  const candNum = extractBuildVersionNum(candidate);
  const baseNum = extractBuildVersionNum(baseline);
  if (candNum > 0 && baseNum > 0) return candNum > baseNum;
  return String(candidate) > String(baseline);
}

async function checkForUpdates() {
  const manifestUrl = getUpdateManifestUrl();
  try {
    const rawBuf = await httpFetchUrl(manifestUrl);
    const manifest = JSON.parse(rawBuf.toString('utf8').replace(/^\uFEFF/, '').trim());
    const remoteBuildId = manifest.buildId || manifest.version || '';
    const hasUpdate = Boolean(remoteBuildId && isBuildIdNewer(remoteBuildId, ENGINE_BUILD_ID));

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

function getRawFileUrl(owner, repo, branch, filePath) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

async function applyHotUpdate() {
  if (updateCheckState.isUpdating) {
    throw new Error('Güncelleme işlemi zaten devam ediyor...');
  }
  updateCheckState.isUpdating = true;
  try {
    const manifestUrl = getUpdateManifestUrl();
    const rawBuf = await httpFetchUrl(manifestUrl);
    const manifest = JSON.parse(rawBuf.toString('utf8').replace(/^\uFEFF/, '').trim());
    const owner = (config.updates && config.updates.repoOwner) || 'mrzaknafein';
    const repo = (config.updates && config.updates.repoName) || 'SCT-AFK-Service';
    const branch = (config.updates && config.updates.branch) || 'main';

    let indexJsUrl = (manifest.files && manifest.files['index.js']) || getRawFileUrl(owner, repo, branch, 'index.js');
    const hasManifestLauncher = Boolean(manifest.files && manifest.files['Launcher.cs']);
    let launcherCsUrl = hasManifestLauncher
      ? manifest.files['Launcher.cs']
      : getRawFileUrl(owner, repo, branch, 'Launcher.cs');

    indexJsUrl = indexJsUrl.replace('{OWNER}', owner).replace('{REPO}', repo).replace('{BRANCH}', branch);
    launcherCsUrl = launcherCsUrl.replace('{OWNER}', owner).replace('{REPO}', repo).replace('{BRANCH}', branch);
    // GitHub raw CDN önbelleğini atla
    const cacheBust = `${indexJsUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
    indexJsUrl += cacheBust;
    launcherCsUrl += `${launcherCsUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;

    addLog(null, 'GÜNCELLEME', `Yeni sürüm (${manifest.buildId || manifest.version}) indiriliyor...`, chalk.cyan);

    let newJsBuf = null;
    let newLauncherBuf = null;
    let newJsStr = '';
    let newLauncherStr = '';

    try {
      [newJsBuf, newLauncherBuf] = await Promise.all([
        httpFetchUrl(indexJsUrl),
        httpFetchUrl(launcherCsUrl).catch(() => null)
      ]);
      newJsStr = newJsBuf ? newJsBuf.toString('utf8') : '';
      newLauncherStr = newLauncherBuf ? newLauncherBuf.toString('utf8') : '';
    } catch (cdnErr) {
      addLog(null, 'GÜNCELLEME', `CDN indirme uyarısı: ${cdnErr.message}`, chalk.yellow);
    }

    let dlBuildMatch = newJsStr.match(/const ENGINE_BUILD_ID = '([^']+)';?/);
    let dlBuildId = dlBuildMatch ? dlBuildMatch[1] : '';
    const expectedBuildId = manifest.buildId || '';

    // Eğer CDN önbelleği eski sürüm döndürdüyse veya geçersizse, doğrudan GitHub API üzerinden taze dosyaları çek!
    if (!dlBuildId || (expectedBuildId && dlBuildId !== expectedBuildId)) {
      addLog(null, 'GÜNCELLEME', '⚠️ CDN önbelleği eski sürüm döndürdü. GitHub API üzerinden en güncel dosyalar doğrudan alınıyor...', chalk.yellow);
      try {
        const ghApiJs = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/index.js?ref=${encodeURIComponent(branch)}`;
        const ghApiLauncher = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/Launcher.cs?ref=${encodeURIComponent(branch)}`;
        const apiHeaders = { 'Accept': 'application/vnd.github.v3.raw' };

        [newJsBuf, newLauncherBuf] = await Promise.all([
          httpFetchUrl(ghApiJs, 5, apiHeaders),
          httpFetchUrl(ghApiLauncher, 5, apiHeaders).catch(() => newLauncherBuf)
        ]);
        newJsStr = newJsBuf ? newJsBuf.toString('utf8') : '';
        newLauncherStr = newLauncherBuf ? newLauncherBuf.toString('utf8') : '';
        dlBuildMatch = newJsStr.match(/const ENGINE_BUILD_ID = '([^']+)';?/);
        dlBuildId = dlBuildMatch ? dlBuildMatch[1] : '';
      } catch (ghErr) {
        addLog(null, 'GÜNCELLEME', `GitHub API doğrudan indirme hatası: ${ghErr.message}`, chalk.red);
      }
    }

    if (!newJsStr.includes('ENGINE_BUILD_ID') || !newJsStr.includes('SctAfkEngineIpc') || newJsStr.length < 15000) {
      throw new Error('İndirilen index.js dosyası geçersiz veya Native WPF IPC desteklemiyor!');
    }
    // Sonsuz güncelleme ve sürüm düşürme (downgrade) koruması: indirilen motor daha yeni olmalı
    if (!dlBuildId || (expectedBuildId && dlBuildId !== expectedBuildId) || !isBuildIdNewer(dlBuildId, ENGINE_BUILD_ID)) {
      throw new Error(`İndirilen motor sürümü (${dlBuildId || '?'}) mevcut sürümden (${ENGINE_BUILD_ID}) daha yeni değil. Güncelleme iptal edildi.`);
    }

    const isValidLauncherSource = (str) =>
      Boolean(str && str.length > 5000 && (str.includes('namespace SctAfkService') || str.includes('namespace SctAfkLauncher')));

    if (hasManifestLauncher && !isValidLauncherSource(newLauncherStr)) {
      throw new Error('İndirilen Launcher.cs dosyası geçersiz veya bozuk!');
    }

    const tmpJsPath = path.join(__dirname, 'index.js.tmp');
    const finalJsPath = path.join(__dirname, 'index.js');
    fs.writeFileSync(tmpJsPath, newJsBuf);
    fs.renameSync(tmpJsPath, finalJsPath);

    if (newLauncherBuf && isValidLauncherSource(newLauncherStr)) {
      const tmpLauncherPath = path.join(__dirname, 'Launcher.cs.tmp');
      const finalLauncherPath = path.join(__dirname, 'Launcher.cs');
      fs.writeFileSync(tmpLauncherPath, newLauncherBuf);
      fs.renameSync(tmpLauncherPath, finalLauncherPath);
      try {
        const nowL = new Date();
        fs.utimesSync(finalLauncherPath, nowL, nowL);
      } catch (e) {}
    }

    try {
      const tmpVerPath = path.join(__dirname, 'version.json.tmp');
      const finalVerPath = path.join(__dirname, 'version.json');
      fs.writeFileSync(tmpVerPath, JSON.stringify(manifest, null, 2), 'utf8');
      fs.renameSync(tmpVerPath, finalVerPath);
    } catch (e) {}

    // Zaman damgasını tazele
    const now = new Date();
    try {
      fs.utimesSync(finalJsPath, now, now);
    } catch (e) {}

    rebuildPortableExe();

    addLog(null, 'GÜNCELLEME', 'Güncelleme başarıyla yüklendi! Sistem yeniden başlatılıyor...', chalk.green);
    broadcastSSE('server-restarting', {
      buildId: dlBuildId || manifest.buildId || manifest.version,
      version: manifest.version || ''
    });

    // Tüm botları güvenle kapat
    for (const a of config.accounts) {
      stopBot(a.id);
    }

    setTimeout(() => {
      try {
        for (const sock of ipcClients) {
          try {
            sock.destroy();
          } catch (e) {}
        }
        ipcClients.clear();
      } catch (e) {}

      try {
        ipcServer.close();
      } catch (e) {}

      try {
        const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
          cwd: __dirname,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: {
            ...process.env,
            SCT_HOT_UPDATE_RESTART: '1'
          }
        });
        child.unref();
      } catch (e) {}
      process.exit(0);
    }, 600);

    return { ok: true, buildId: dlBuildId || manifest.buildId || manifest.version };
  } finally {
    updateCheckState.isUpdating = false;
  }
}

let config = loadConfig();
const sessions = new Map();
const recentLogs = [];
const ipcClients = new Set();

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

  const fwDir = path.dirname(cscPath);
  const wpfDir = path.join(fwDir, 'WPF');

  for (const outExe of targetPaths) {
    const tmpExe = `${outExe}.new.exe`;
    const args = [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      `/out:${tmpExe}`,
      `/win32icon:${icoPath}`,
      `/r:${path.join(wpfDir, 'PresentationFramework.dll')}`,
      `/r:${path.join(wpfDir, 'PresentationCore.dll')}`,
      `/r:${path.join(wpfDir, 'WindowsBase.dll')}`,
      `/r:${path.join(fwDir, 'System.Xaml.dll')}`,
      '/r:System.Web.Extensions.dll',
      '/r:System.Core.dll',
      '/r:System.Drawing.dll',
      '/r:System.Windows.Forms.dll',
      `/resource:${path.join(__dirname, 'package.json')},sct.package.json`,
      `/resource:${path.join(__dirname, 'index.js')},sct.index.js`,
      `/resource:${path.join(__dirname, 'public', 'logo.jpg')},sct.logo.jpg`,
      `/resource:${CONFIG_PATH},sct.config.json`,
      `/resource:${launcherCs},sct.Launcher.cs`,
      `/resource:${icoPath},sct.app.ico`,
      launcherCs
    ];
    execFile(cscPath, args, { windowsHide: true }, (err) => {
      if (err || !fs.existsSync(tmpExe)) {
        try { if (fs.existsSync(tmpExe)) fs.unlinkSync(tmpExe); } catch (e) {}
        return;
      }
      try {
        fs.renameSync(tmpExe, outExe);
      } catch (renameErr) {
        try {
          const oldBackup = `${outExe}.old`;
          try { if (fs.existsSync(oldBackup)) fs.unlinkSync(oldBackup); } catch (e) {}
          if (fs.existsSync(outExe)) fs.renameSync(outExe, oldBackup);
          fs.renameSync(tmpExe, outExe);
          try { fs.unlinkSync(oldBackup); } catch (e) {}
        } catch (e2) {
          try { if (fs.existsSync(tmpExe)) fs.unlinkSync(tmpExe); } catch (e3) {}
        }
      }
    });
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
  const line = JSON.stringify({ type: 'event', event: type, data }) + '\n';
  for (const sock of ipcClients) {
    try {
      if (!sock.destroyed && sock.writable) {
        sock.write(line);
      } else {
        ipcClients.delete(sock);
      }
    } catch (e) {
      ipcClients.delete(sock);
    }
  }
}

function triggerSoundAlert(alertType, accountId, message) {
  if (!config.soundAlerts || config.soundAlerts.enabled === false) return;
  if (alertType === 'damage' && config.soundAlerts.onDamage === false) return;
  if (alertType === 'disconnect' && config.soundAlerts.onDisconnect === false) return;
  if (alertType === 'mention' && config.soundAlerts.onMention === false) return;
  if (alertType === 'captcha' && config.soundAlerts.onCaptcha === false) return;
  if (alertType === 'notify' && config.soundAlerts.onNotify === false) return;

  const acc = config.accounts.find((a) => a.id === accountId);
  broadcastSSE('sound', {
    alertType,
    accountId,
    username: acc ? acc.username : 'Sistem',
    message
  });
}

function sendDesktopNotification(typeOrTitle, titleOrBody, bodyOrAccountId = null, maybeAccountId = null) {
  let alertType = 'notify';
  let title = 'SCT AFK Bildirimi';
  let body = '';
  let accountId = null;

  if (maybeAccountId !== null) {
    alertType = typeOrTitle;
    title = titleOrBody;
    body = bodyOrAccountId;
    accountId = maybeAccountId;
  } else if (bodyOrAccountId !== null && typeof bodyOrAccountId === 'string') {
    title = typeOrTitle;
    body = titleOrBody;
    accountId = bodyOrAccountId;
  } else {
    title = typeOrTitle;
    body = titleOrBody;
    accountId = bodyOrAccountId;
  }

  // Başlıktan tür çıkarımı yap
  const tLower = (String(title) + ' ' + String(alertType)).toLowerCase();
  if (tLower.includes('mention') || tLower.includes('adınız geçti') || tLower.includes('özel mesaj') || tLower.includes('whisper')) {
    alertType = 'mention';
  } else if (tLower.includes('atıldı') || tLower.includes('kop') || tLower.includes('disconnect') || tLower.includes('kick')) {
    alertType = 'disconnect';
  } else if (tLower.includes('öldü') || tLower.includes('ölüm') || tLower.includes('death')) {
    alertType = 'death';
  } else if (tLower.includes('captcha')) {
    alertType = 'captcha';
  }

  // KESİN VE SIKI KONTROL (KULLANICI KAPATTIYSA KESİNLİKLE MASAÜSTÜ BİLDİRİMİ ATMA):
  const notifCfg = config.desktopNotifications || {};
  const soundCfg = config.soundAlerts || {};

  // 1. Masaüstü bildirimleri ana anahtarı kapalıysa derhal çık
  if (notifCfg.enabled === false) return;

  // 2. İlgili kategori kapalıysa derhal çık (Ses veya Masaüstü bildirim ayarlarından herhangi biri kapalıysa bildirim atılmaz)
  if (alertType === 'mention' && (notifCfg.onMention === false || soundCfg.onMention === false)) return;
  if (alertType === 'disconnect' && (notifCfg.onDisconnect === false || soundCfg.onDisconnect === false)) return;
  if (alertType === 'death' && (notifCfg.onDeath === false || soundCfg.onDamage === false)) return;
  if (alertType === 'captcha' && (notifCfg.onCaptcha === false || soundCfg.onCaptcha === false)) return;
  if (alertType === 'notify' && (notifCfg.onNotify === false || soundCfg.onNotify === false)) return;

  // 3. Genel ses/uyarı anahtarı kapalıysa ve masaüstü bildirimleri açıkça true yapılmadıysa gönderme
  if (soundCfg.enabled === false && notifCfg.enabled !== true) return;

  if (!body) return;
  const cleanTitle = (title || 'SCT AFK Bildirimi').replace(/§[0-9a-fk-or]/gi, '');
  const cleanBody = String(body).replace(/§[0-9a-fk-or]/gi, '');
  const acc = accountId ? config.accounts.find((a) => a.id === accountId) : null;

  broadcastSSE('desktop-notification', {
    type: alertType,
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
        autoMinerChestSell: acc.autoMinerChestSell || { enabled: false, intervalSec: 10 },
        isMinerChestSelling: false,
        lastMinerChestSellTime: 0,
        autoSpawnerRoutine: acc.autoSpawnerRoutine || { enabled: false, intervalSec: 30, spawnerCount: 0, customCoords: '' },
        isSpawnerRoutineRunning: false,
        lastSpawnerRoutineTime: 0,
        autoJackOLantern: acc.autoJackOLantern || { enabled: false, intervalSec: 20, batchSize: 32, pumpkinChest: '', torchChest: '', outputChest: '', ironChest: '', stickChest: '', carveSpot: '' },
        isJackOLanternRunning: false,
        lastJackOLanternTime: 0,
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
        autoMinerChestSell: acc.autoMinerChestSell || { enabled: false, intervalSec: 10 },
        isMinerChestSelling: Boolean(s.isMinerChestSelling),
        lastMinerChestSellTime: s.lastMinerChestSellTime || 0,
        autoSpawnerRoutine: acc.autoSpawnerRoutine || { enabled: false, intervalSec: 30, spawnerCount: 0, customCoords: '' },
        isSpawnerRoutineRunning: Boolean(s.isSpawnerRoutineRunning || s.isSpawnerLoopActive),
        lastSpawnerRoutineTime: s.lastSpawnerRoutineTime || 0,
        autoJackOLantern: acc.autoJackOLantern || { enabled: false, intervalSec: 20, batchSize: 32, pumpkinChest: '', torchChest: '', outputChest: '', ironChest: '', stickChest: '', carveSpot: '' },
        isJackOLanternRunning: Boolean(s.isJackOLanternRunning),
        lastJackOLanternTime: s.lastJackOLanternTime || 0,
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
const MIN_STATE_BROADCAST_INTERVAL_MS = 250;

function debouncedBroadcastState(delay = 180) {
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
  if (ipcClients.size > 0) {
    broadcastSSE('state', getPublicState());
  }
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
  if (recentLogs.length > 200) recentLogs.shift();

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
      minerChestSellTimer: null,
      isMinerChestSelling: false,
      lastMinerChestSellTime: 0,
      spawnerRoutineTimer: null,
      isSpawnerRoutineRunning: false,
      isSpawnerLoopActive: false,
      spawnerEnclosure: null,
      fullSpawnerChests: null,
      lastSpawnerRoutineTime: 0,
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
  if (session && session.accountId) {
    clearAllClaimsForAccount(session.accountId);
  }
  if (session.spawnerRoutineTimer) {
    clearTimeout(session.spawnerRoutineTimer);
    session.spawnerRoutineTimer = null;
  }
  session.abortSpawnerRoutine = true;
  session.isSpawnerRoutineRunning = false;
  session.isSpawnerLoopActive = false;
  session.spawnerEnclosure = null;
  if (session.jackOLanternTimer) {
    clearTimeout(session.jackOLanternTimer);
    session.jackOLanternTimer = null;
  }
  session.abortJackOLantern = true;
  session.isJackOLanternRunning = false;
  if (session.minerChestSellTimer) {
    clearTimeout(session.minerChestSellTimer);
    session.minerChestSellTimer = null;
  }
  session.isMinerChestSelling = false;
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
    if (
      !session.bot ||
      session.status !== 'online' ||
      !currentAcc ||
      !currentAcc.autoCommandEnabled ||
      session.isJackOLanternRunning ||
      session.isDepositing ||
      Boolean(session.bot.currentWindow)
    ) return;

    const cmds = String(currentAcc.autoCommandText)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    cmds.forEach((cmd, idx) => {
      setTimeout(() => {
        if (
          session.bot &&
          session.status === 'online' &&
          !session.isJackOLanternRunning &&
          !session.isDepositing &&
          !session.bot.currentWindow
        ) {
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
  // Vulcan Inventory / AutoTool koruması: Açık pencere varken veya fener/sandık işlemi sürerken araya girme
  const targetFoodThreshold = (bot.health < 20) ? 19 : 15;
  if (
    acc.autoEat !== false &&
    typeof bot.food === 'number' &&
    bot.food <= targetFoodThreshold &&
    !session.isEating &&
    !session.isDropping &&
    !session.isDepositing &&
    !session.isJackOLanternRunning &&
    !bot.currentWindow
  ) {
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
  const bName = name.toLowerCase().replace(/^minecraft:/, '');
  return (
    bName === 'chest' ||
    bName === 'trapped_chest' ||
    bName === 'barrel' ||
    bName === 'shulker_box' ||
    bName.endsWith('_shulker_box') ||
    bName.includes('chest') ||
    bName.includes('barrel')
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


// ============================================================================
// LEGACY TRANSITION HTTP BRIDGE (PORT 3847 & 3000) & NATIVE LAUNCHER AUTO-MIGRATOR
// ============================================================================
async function autoUpgradeExecutable() {
  const targetPaths = new Set();
  const defaultExe = path.join(__dirname, '..', 'minecraft-afk-client', 'SCT AFK Service.exe');
  if (fs.existsSync(path.dirname(defaultExe))) targetPaths.add(defaultExe);
  const localExe = path.join(__dirname, 'SCT AFK Service.exe');
  targetPaths.add(localExe);
  const exePathTxt = path.join(__dirname, 'exe_path.txt');
  if (fs.existsSync(exePathTxt)) {
    try {
      const rec = fs.readFileSync(exePathTxt, 'utf8').trim();
      if (rec && fs.existsSync(path.dirname(rec))) targetPaths.add(rec);
    } catch (e) {}
  }

  const owner = (config.updates && config.updates.repoOwner) || 'mrzaknafein';
  const repo = (config.updates && config.updates.repoName) || 'SCT-AFK-Service';
  const branch = (config.updates && config.updates.branch) || 'main';

  // 1. Launcher.cs kontrolü ve indirilmesi
  const launcherCs = path.join(__dirname, 'Launcher.cs');
  if (!fs.existsSync(launcherCs)) {
    try {
      const lBuf = await httpFetchUrl(getRawFileUrl(owner, repo, branch, 'Launcher.cs'), 5, {}, 45000);
      if (lBuf && lBuf.length > 5000) {
        fs.writeFileSync(launcherCs, lBuf);
      }
    } catch (e) {}
  }

  // 2. Precompiled SCT AFK Service.exe kontrolü ve indirilmesi
  let downloadedExeBuf = null;
  try {
    const rawExeUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/SCT%20AFK%20Service.exe`;
    downloadedExeBuf = await httpFetchUrl(rawExeUrl, 5, {}, 45000);
  } catch (e) {}

  if (downloadedExeBuf && downloadedExeBuf.length > 500000) {
    for (const outExe of targetPaths) {
      try {
        const tmpExe = `${outExe}.download.exe`;
        fs.writeFileSync(tmpExe, downloadedExeBuf);
        const oldBackup = `${outExe}.old`;
        try { if (fs.existsSync(oldBackup)) fs.unlinkSync(oldBackup); } catch (e) {}
        if (fs.existsSync(outExe)) {
          try { fs.renameSync(outExe, oldBackup); } catch (e) {}
        }
        try {
          fs.renameSync(tmpExe, outExe);
          try { if (fs.existsSync(oldBackup)) fs.unlinkSync(oldBackup); } catch (e) {}
        } catch (e) {
          try { if (fs.existsSync(tmpExe)) fs.unlinkSync(tmpExe); } catch (_) {}
        }
      } catch (e) {}
    }
  } else {
    rebuildPortableExe();
  }

  // 3. Eger Native WPF GUI su an bagli degilse (eski webden guncellendiyse), Native EXE'yi baslat!
  setTimeout(() => {
    try {
      if (ipcClients.size === 0) {
        for (const outExe of targetPaths) {
          if (fs.existsSync(outExe)) {
            const child = spawn(outExe, [], {
              detached: true,
              stdio: 'ignore'
            });
            child.unref();
            break;
          }
        }
      }
    } catch (e) {}
  }, 3500);
}

function handleBridgeRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, 'http://127.0.0.1:3847');

  // KeyAuth status (Legacy Service Worker unblocker)
  if (parsedUrl.pathname === '/api/keyauth/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      engineBuildId: ENGINE_BUILD_ID,
      authenticated: true,
      username: (keyAuthSession && keyAuthSession.username) || 'Kullanıcı',
      plan: (keyAuthSession && keyAuthSession.plan) || 'starter'
    }));
    return;
  }

  if (parsedUrl.pathname === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end('self.addEventListener("install", () => self.skipWaiting()); self.addEventListener("activate", () => self.registration.unregister());');
    return;
  }

  if (parsedUrl.pathname === '/api/updates/check') {
    checkForUpdates().then(state => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(state));
    }).catch(e => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }
  if (parsedUrl.pathname === '/api/updates/apply' && req.method === 'POST') {
    applyHotUpdate().then(result => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    }).catch(e => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  const transitionHtml = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>SCT AFK Service - Native Masaüstü Geçişi</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #F4EBE1;
      color: #1F3D2B;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: #FFFFFF;
      border: 1px solid #E8DCC4;
      border-radius: 20px;
      padding: 40px;
      max-width: 520px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(31,61,43,0.08);
    }
    .badge {
      display: inline-block;
      background: #1F3D2B;
      color: #F4EBE1;
      font-size: 11px;
      font-weight: 750;
      letter-spacing: 0.8px;
      padding: 6px 14px;
      border-radius: 999px;
      margin-bottom: 20px;
      text-transform: uppercase;
    }
    h1 {
      font-size: 22px;
      font-weight: 800;
      margin-bottom: 12px;
      color: #1F3D2B;
    }
    p {
      font-size: 14px;
      line-height: 1.6;
      color: #556B5C;
      margin-bottom: 24px;
    }
    .spinner {
      width: 44px;
      height: 44px;
      margin: 0 auto 20px;
      border: 4px solid #E8DCC4;
      border-top-color: #8B5CF6;
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .btn-close {
      background: #1F3D2B;
      color: #F4EBE1;
      border: none;
      padding: 12px 24px;
      border-radius: 12px;
      font-weight: 700;
      cursor: pointer;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <div class="badge">SCT AFK Service • Native WPF 2.4.2</div>
    <h1>Masaüstü Uygulamasına Geçildi</h1>
    <p>Tarayıcı ve WebView bağımlılıkları tamamen kaldırıldı. Sisteminiz doğrudan yüksek performanslı Windows Native WPF masaüstü uygulaması olarak açılıyor.<br><br>Bu tarayıcı sekmesini kapatabilirsiniz.</p>
    <button class="btn-close" onclick="window.close()">Sekmeyi Kapat</button>
  </div>
  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        for (const reg of regs) reg.unregister();
      });
    }
    setTimeout(() => { try { window.close(); } catch(e){} }, 4000);
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(transitionHtml);
}

// SCT AFK Service yalnizca 3847 (varsayilan legacy port) dinler. Port 3000 Housemate projesine aittir ve ASLA KULLANILMAZ!
const legacyPorts = [Number(config.uiPort) || 3847];
for (const bPort of legacyPorts) {
  try {
    const bServer = http.createServer((req, res) => handleBridgeRequest(req, res));
    bServer.listen(bPort, '127.0.0.1', () => {
      console.log(chalk.gray(`[Bridge] Legacy HTTP ${bPort} listener ready for seamless migration.`));
    });
    bServer.on('error', () => {});
  } catch (e) {}
}


process.on('exit', () => {
  try {
    const pidFile = path.join(__dirname, 'server.pid');
    if (fs.existsSync(pidFile)) {
      const currentOwner = fs.readFileSync(pidFile, 'utf8').trim();
      if (currentOwner === String(process.pid)) {
        fs.unlinkSync(pidFile);
      }
    }
  } catch (e) {}
});
