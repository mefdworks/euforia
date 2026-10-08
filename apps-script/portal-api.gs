// ══════════════════════════════════════════════════════════════
// EUFORIA PORTAL — Apps Script API v5.1 (getPortal devuelve statsName, col E de USUARIOS)
// Cambios frente a v4:
//   · Caché de hojas (CacheService) → menos lecturas, menos timeouts
//   · getPortal: jugador + presupuesto en UNA sola ejecución, con token
//   · Token firmado (HMAC) al hacer login/register; ya no basta el nombre
//   · Contraseñas por POST (fuera de la URL) y con sal; las viejas migran solas
//   · Bloqueo tras 5 intentos fallidos (10 min)
//   · LockService en escrituras; siempre responde JSON
// Compatible con el index.html v4 mientras ALLOW_LEGACY_GETPLAYER = true.
// ══════════════════════════════════════════════════════════════

const CFG = {
  CACHE_TTL: 300,               // segundos que vive la copia de cada hoja
  TOKEN_HOURS: 168,             // duración de la sesión (7 días)
  MAX_FAILS: 5,                 // intentos fallidos antes de bloquear
  LOCKOUT_SEC: 600,             // duración del bloqueo
  ALLOW_LEGACY_GETPLAYER: true, // pasar a false cuando index.html v5 esté publicado
};

const SH = { USERS: 'USUARIOS', SEG: 'SEGUIMIENTO', PRES: 'PRESUPUESTO', BIEN: 'BIENESTAR' };

const ROUTES = {
  ping:            p => ({ ok: true, message: 'Euforia API v5.1 ✓' }),
  isFirstTime:     p => isFirstTime(p.codigo),
  register:        p => register(p.codigo, p.password),
  login:           p => login(p.codigo, p.password),
  changePassword:  p => changePassword(p.codigo, p.oldPass, p.newPass),
  getPortal:       p => getPortal(p.token),
  getPlayer:       p => CFG.ALLOW_LEGACY_GETPLAYER
                          ? getPlayer(p.nombre)
                          : { ok: false, auth: false, error: 'Actualiza la página e ingresa de nuevo.' },
  getPresupuesto:  p => getPresupuesto(),
  getJugadores:    p => getJugadores(),
  submitBienestar: p => submitBienestar(p),
};

function doGet(e) {
  return route_((e && e.parameter) || {});
}

// POST con body JSON enviado como text/plain (sin preflight CORS)
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (_) {}
  return route_(Object.assign({}, e.parameter || {}, body));
}

function route_(p) {
  const action = String(p.action || 'ping').trim();
  const fn = ROUTES[action];
  let result;
  try {
    result = fn ? fn(p) : { ok: false, error: 'Acción no reconocida' };
  } catch (err) {
    console.error(action, err);
    result = { ok: false, error: err.message || String(err) };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ══════════════════════════════════════════════════════════════
// LECTURA CON CACHÉ
// onEdit limpia la caché cuando alguien edita el Sheet a mano.
// Las escrituras leen fresco (fresh=true) para no apuntar a una fila vieja.
// ══════════════════════════════════════════════════════════════
function rows_(name, fresh) {
  const cache = CacheService.getScriptCache();
  const key = 'rows_' + name;
  if (!fresh) {
    const hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Hoja ' + name + ' no encontrada');
  const data = sheet.getDataRange().getValues()
    .map(r => r.map(v => v instanceof Date ? v.toISOString() : v));
  try { cache.put(key, JSON.stringify(data), CFG.CACHE_TTL); } catch (_) { /* >100 KB: sin caché */ }
  return data;
}

function clearCache_() {
  CacheService.getScriptCache().removeAll(Object.values(SH).map(n => 'rows_' + n));
}

function onEdit(e) {
  clearCache_();
}

const str_ = v => (v === null || v === undefined ? '' : v).toString().trim();

function findUser_(codigo, fresh) {
  const cod = str_(codigo).toLowerCase();
  const data = rows_(SH.USERS, fresh);
  for (let i = 1; i < data.length; i++) {
    if (str_(data[i][0]).toLowerCase() === cod) {
      return {
        row: i + 1,
        codigo: str_(data[i][0]),
        nombre: str_(data[i][1]),
        pass: str_(data[i][2]),
        activo: str_(data[i][3]).toUpperCase() === 'SI',
        statsName: str_(data[i][4]),   // col E "Nombre stats" (base de estadísticas)
      };
    }
  }
  return null;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'Servidor ocupado, intenta de nuevo.' };
  try { return fn(); } finally { lock.releaseLock(); }
}

// ══════════════════════════════════════════════════════════════
// CONTRASEÑAS
// Formato nuevo: s1$<sal>$<sha256(sal+pass)>
// Formato v4 (sin sal) se acepta y se reescribe en el siguiente login.
// ══════════════════════════════════════════════════════════════
function sha256_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function makeHash_(pass) {
  const salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  return 's1$' + salt + '$' + sha256_(salt + pass);
}

function checkHash_(pass, stored) {
  if (stored.indexOf('s1$') === 0) {
    const parts = stored.split('$');
    return sha256_(parts[1] + pass) === parts[2];
  }
  return sha256_(pass) === stored;
}

function setPass_(codigo, pass) {
  const u = findUser_(codigo, true);
  if (!u) return null;
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.USERS)
    .getRange(u.row, 3).setValue(makeHash_(pass));
  clearCache_();
  return u;
}

// ── Bloqueo por intentos fallidos ──
function failKey_(codigo) { return 'fail_' + str_(codigo).toLowerCase(); }
function isLocked_(codigo) {
  return Number(CacheService.getScriptCache().get(failKey_(codigo)) || 0) >= CFG.MAX_FAILS;
}
function addFail_(codigo) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(failKey_(codigo)) || 0) + 1;
  cache.put(failKey_(codigo), String(n), CFG.LOCKOUT_SEC);
}
function resetFails_(codigo) { CacheService.getScriptCache().remove(failKey_(codigo)); }

// ══════════════════════════════════════════════════════════════
// TOKEN DE SESIÓN (HMAC-SHA256, sin estado)
// El secreto se crea solo en Propiedades del script. Borrar TOKEN_SECRET
// cierra la sesión de todos.
// ══════════════════════════════════════════════════════════════
function secret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('TOKEN_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('TOKEN_SECRET', s);
  }
  return s;
}

function sign_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret_()));
}

function makeToken_(codigo) {
  const payload = Utilities.base64EncodeWebSafe(
    JSON.stringify({ c: codigo, exp: Date.now() + CFG.TOKEN_HOURS * 3600 * 1000 }),
    Utilities.Charset.UTF_8
  );
  return payload + '.' + sign_(payload);
}

function readToken_(token) {
  const parts = str_(token).split('.');
  if (parts.length !== 2 || sign_(parts[0]) !== parts[1]) return null;
  try {
    const d = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    return d.exp > Date.now() ? d.c : null;
  } catch (_) {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════
function isFirstTime(codigo) {
  if (!codigo) return { ok: false, error: 'Código requerido' };
  const u = findUser_(codigo);
  if (!u) return { ok: false, error: 'Código no encontrado. Verifica con tu capitán.' };
  if (!u.activo) return { ok: false, error: 'Usuario inactivo. Contacta al capitán.' };
  return { ok: true, firstTime: u.pass === '', nombre: u.nombre };
}

function register(codigo, password) {
  if (!codigo || !password) return { ok: false, error: 'Datos incompletos' };
  if (str_(password).length < 6) return { ok: false, error: 'Mínimo 6 caracteres' };
  return withLock_(() => {
    const u = findUser_(codigo, true);
    if (!u) return { ok: false, error: 'Código no encontrado.' };
    if (!u.activo) return { ok: false, error: 'Usuario inactivo.' };
    if (u.pass !== '') return { ok: false, error: 'Este código ya tiene contraseña.' };
    setPass_(codigo, password);
    return { ok: true, codigo: u.codigo, nombre: u.nombre, token: makeToken_(u.codigo) };
  });
}

function login(codigo, password) {
  if (!codigo || !password) return { ok: false, error: 'Datos incompletos' };
  if (isLocked_(codigo)) return { ok: false, error: 'Demasiados intentos. Espera 10 minutos.' };
  const u = findUser_(codigo);
  if (!u) return { ok: false, error: 'Código no encontrado.' };
  if (!u.activo) return { ok: false, error: 'Usuario inactivo.' };
  if (!u.pass || !checkHash_(password, u.pass)) {
    addFail_(codigo);
    return { ok: false, error: 'Contraseña incorrecta.' };
  }
  resetFails_(codigo);
  if (u.pass.indexOf('s1$') !== 0) withLock_(() => setPass_(codigo, password)); // migra hash v4
  return { ok: true, codigo: u.codigo, nombre: u.nombre, token: makeToken_(u.codigo) };
}

function changePassword(codigo, oldPass, newPass) {
  if (!codigo || !oldPass || !newPass) return { ok: false, error: 'Datos incompletos' };
  if (str_(newPass).length < 6) return { ok: false, error: 'Mínimo 6 caracteres' };
  if (isLocked_(codigo)) return { ok: false, error: 'Demasiados intentos. Espera 10 minutos.' };
  return withLock_(() => {
    const u = findUser_(codigo, true);
    if (!u) return { ok: false, error: 'Código no encontrado.' };
    if (!checkHash_(oldPass, u.pass)) {
      addFail_(codigo);
      return { ok: false, error: 'Contraseña actual incorrecta.' };
    }
    resetFails_(codigo);
    setPass_(codigo, newPass);
    return { ok: true };
  });
}

// ══════════════════════════════════════════════════════════════
// PORTAL — jugador + presupuesto en una sola llamada
// ══════════════════════════════════════════════════════════════
function getPortal(token) {
  const codigo = readToken_(token);
  if (!codigo) return { ok: false, auth: false, error: 'Tu sesión venció, ingresa de nuevo.' };
  const u = findUser_(codigo);
  if (!u || !u.activo) return { ok: false, auth: false, error: 'Usuario inactivo.' };
  return { ok: true, nombre: u.nombre, statsName: u.statsName, player: getPlayer(u.nombre), presupuesto: getPresupuesto() };
}

// ── Ítems del PRESUPUESTO (fila 1 = título, fila 2 = headers, col A cat, B ítem, C costo) ──
function presItems_() {
  const data = rows_(SH.PRES);
  const items = [];
  for (let i = 2; i < data.length; i++) {
    const cat = str_(data[i][0]);
    const nombre = str_(data[i][1]);
    if (!nombre || cat.toUpperCase() === 'TOTAL' || nombre.toUpperCase() === 'TOTAL') continue;
    items.push({ cat, nombre, costo: parseFloat(data[i][2]) || 0 });
  }
  return items;
}

// ══════════════════════════════════════════════════════════════
// DATOS DEL JUGADOR — dinámico desde PRESUPUESTO
// Estados por celda:
//   Vacío    → N/A (no aplica, no se muestra)
//   0        → Debe pagar ❌
//   Número   → Pagado ✅ (suma al total)
//   "GIFT"   → Exonerado 🎁 (no suma al total, pero está al día)
// ══════════════════════════════════════════════════════════════
function getPlayer(nombre) {
  if (!nombre) return { ok: false, error: 'Nombre requerido' };

  const segData = rows_(SH.SEG);
  const headers = (segData[1] || []).map(h => str_(h).toLowerCase());
  const target = str_(nombre).toLowerCase();
  const playerRow = segData.slice(2).find(r => str_(r[1]).toLowerCase() === target);
  if (!playerRow) return { ok: false, error: 'Jugador no encontrado: ' + nombre };

  const sancionIdx = headers.indexOf('sanciones');
  const sancionVal = sancionIdx !== -1 ? playerRow[sancionIdx] : '';
  const sanciones = str_(sancionVal) === '' ? null : (parseFloat(sancionVal) || 0);

  const pagos = {};
  let total = 0;
  presItems_().forEach(({ cat, nombre: item }) => {
    const colIdx = headers.indexOf(item.toLowerCase());
    if (colIdx === -1) return;
    const raw = str_(playerRow[colIdx]);
    if (raw === '') return;                       // N/A
    const isGift = raw.toUpperCase() === 'GIFT';
    const valor = isGift ? 'GIFT' : (parseFloat(raw) || 0);
    if (!isGift && valor > 0) total += valor;
    (pagos[cat] = pagos[cat] || []).push({ item, valor });
  });

  return { ok: true, nombre: str_(playerRow[1]), estado: str_(playerRow[2]), total, sanciones, pagos };
}

function getPresupuesto() {
  const items = presItems_();
  return { ok: true, items, totalCosto: items.reduce((s, i) => s + i.costo, 0) };
}

// ══════════════════════════════════════════════════════════════
// BIENESTAR
// ══════════════════════════════════════════════════════════════
function getJugadores() {
  const data = rows_(SH.USERS);
  const jugadores = [];
  for (let i = 1; i < data.length; i++) {
    const nombre = str_(data[i][1]);
    if (nombre && str_(data[i][3]).toUpperCase() === 'SI') jugadores.push(nombre);
  }
  jugadores.sort((a, b) => a.localeCompare(b, 'es'));
  return { ok: true, jugadores };
}

function submitBienestar(p) {
  if (!p.nombre || !p.fecha) return { ok: false, error: 'Faltan parámetros: nombre o fecha' };

  const headers = [
    'Timestamp', 'Fecha', 'Jugador', 'Tipo de sesión', 'Horas de sueño',
    'Calidad de sueño', 'Fatiga', 'Daño muscular general', 'Nivel de estrés',
    'Estado de ánimo', 'RPE sesión', 'Índice de bienestar', 'Comentarios'
  ];

  // Índice = Fatiga + Daño muscular + Estrés + Ánimo (4–20, más alto = mejor)
  const indice = Number(p.fatiga) + Number(p.dano_muscular) + Number(p.estres) + Number(p.animo);

  return withLock_(() => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SH.BIEN);
    if (!sheet) {
      sheet = ss.insertSheet(SH.BIEN);
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([
      new Date(), p.fecha, p.nombre, p.tipo_sesion || '', p.horas_sueno || '',
      p.calidad_sueno || '', p.fatiga || '', p.dano_muscular || '', p.estres || '',
      p.animo || '', p.rpe || '', indice, p.comentarios || ''
    ]);
    return { ok: true, indice };
  });
}
