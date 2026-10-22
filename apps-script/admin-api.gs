// ══════════════════════════════════════════════════════════════
// EUFORIA PORTAL — API ADMINISTRATIVA v1.2
//   Archivo aparte dentro del MISMO proyecto de Apps Script que portal-api.gs
//   (usa su login, token, findUser_, withLock_ y str_).
//   Lee y escribe el Sheet "2027 EUFORIA CUENTAS GENERALES" (fuente nueva).
//   Entran los usuarios con "SI" en la columna F (Admin) de USUARIOS, o los de ADMIN.CODES.
//   Cada cambio queda en la hoja Bitacora.
//   v1.2: estado automático + pagado/debe en Jugadores, CXP vinculadas a conceptos,
//         adminSync() para recalcular todo (también con disparador diario).
//
// Primera vez (desde el editor de Apps Script):
//   1. Ejecutar adminSetup()  → crea las columnas de ID que falten y las llena.
//   2. Ejecutar adminTest()   → revisa en el registro que todo responda.
//   3. Implementar → Administrar implementaciones → editar → Nueva versión.
// ══════════════════════════════════════════════════════════════

const ADMIN = {
  SS_ID: '1UhbbQnquvN-eiOqlxsec-qePM1_8g_6w_o072iNM8Rs',
  CODES: ['E10', 'E2'],
  CATS: ['OPEN', 'FEMENINO', 'U24', 'SUB17', 'MASTER', 'DISCGOLF'],
  TZ: 'America/Bogota',
  LIST_LIMIT: 500,
  DIAS_GRACIA: 0,     // días después de "Vence" antes de contar como mora
};

// Tablas del Sheet. Los nombres de columna se buscan sin tildes ni mayúsculas,
// así que "Registró" o "Registro" funcionan igual.
const ADM_T = {
  pagos: {
    sheet: ['Pagos'], prefix: 'PG', pad: 6, required: 'valor',
    fields: {
      fecha: ['Fecha'], jugador: ['Jugador'], tipo: ['Tipo'], concepto: ['Concepto'], valor: ['Valor'],
      medio: ['Medio'], registro: ['Registró'], notas: ['Notas', 'Nota'], categoria: ['Categoría'],
      idJug: ['ID jug.'], idConc: ['ID concepto'], id: ['ID pago'], creado: ['Registrado'],
    },
  },
  gastos: {
    sheet: ['Gastos'], prefix: 'GS', pad: 6, required: 'valor',
    fields: {
      fecha: ['Fecha'], rubro: ['Rubro'], categoria: ['Categoría'], proveedor: ['Proveedor / beneficiario'],
      valor: ['Valor'], medio: ['Medio'], soporte: ['Soporte (link)', 'Soporte'], clase: ['Tipo (auto)'],
      idConc: ['ID concepto'], idTipo: ['ID tipo gasto'], notas: ['Notas'], idCxp: ['ID CXP'],
      id: ['ID gasto'], registro: ['Registró'], creado: ['Registrado'],
    },
  },
  cxp: {
    sheet: ['CXP'], prefix: 'P', pad: 2, required: 'proveedor',
    fields: {
      id: ['ID'], proveedor: ['Proveedor'], concepto: ['Concepto'], tipo: ['Tipo'], categoria: ['Categoría'],
      fechaLimite: ['Fecha límite'], valorTotal: ['Valor total'], recogido: ['Recogido de jugadores'],
      pagado: ['Pagado'], saldo: ['Saldo por pagar'], estado: ['Estado'], nota: ['Nota'], idConc: ['ID concepto'],
    },
  },
  jugadores: {
    sheet: ['Jugadores'], prefix: 'J', pad: 3, required: 'nombre',
    fields: {
      id: ['ID'], codigo: ['Código portal'], nombre: ['Nombre (Apellido Nombre)', 'Nombre'],
      categoria: ['Categoría'], categoria2: ['Categoría 2'], categoria3: ['Categoría 3'], activo: ['Activo'],
      afiliado: ['Afiliado'], extranjero: ['Extranjero'], lesionado: ['Lesionado'], premios: ['Premios'],
      estado: ['Estado'], estadoAuto: ['Estado (auto)'], pagadoAnio: ['Pagado año'], debeAnio: ['Debe año'],
    },
  },
  conceptos: {
    sheet: ['Conceptos'], prefix: 'C', pad: 3, required: 'concepto',
    fields: {
      id: ['ID'], concepto: ['Concepto'], tipo: ['Tipo'], ambito: ['Ámbito'], anio: ['Año'], vence: ['Vence'],
      OPEN: ['OPEN'], FEMENINO: ['FEMENINO'], U24: ['U24'], SUB17: ['SUB17'], MASTER: ['MASTER'],
      DISCGOLF: ['DISCGOLF'], activo: ['Activo'], nota: ['Nota'],
    },
  },
  tiposGasto: {
    sheet: ['Tipo_Gastos', 'Tipos de gasto'], prefix: 'T', pad: 2, required: 'nombre',
    fields: {
      id: ['ID'], nombre: ['Proveedor / beneficiario'], clase: ['Clase'], categoriaFija: ['Categoría fija'],
      activo: ['Activo'], nota: ['Nota'],
    },
  },
  categorias: {
    sheet: ['Categorias', 'Categorías'], prefix: '', pad: 0, required: 'id', manualId: true,
    fields: {
      id: ['ID'], nombre: ['Nombre / equipo'], rama: ['Rama'], cobra: ['¿Cobra a jugadores?'],
      sufijo: ['Sufijo en tipos de gasto'], historico: ['Cómo aparece en el histórico'], activo: ['Activo'],
      nota: ['Nota'],
    },
  },
};

const ADM_DATE = ['fecha', 'vence', 'fechaLimite', 'creado'];
const ADM_NUM = ['valor', 'valorTotal', 'recogido', 'pagado', 'saldo', 'anio', 'pagadoAnio', 'debeAnio'].concat(ADMIN.CATS);
// referencias que impiden borrar sin force (mejor desactivar)
const ADM_REFS = {
  jugadores: [['pagos', 'idJug']],
  conceptos: [['pagos', 'idConc'], ['gastos', 'idConc']],
  tiposGasto: [['gastos', 'idTipo']],
  cxp: [['gastos', 'idCxp']],
};

const ADMIN_ROUTES = {
  adminPing:      p => ({ ok: true, message: 'Euforia admin v1.2 ✓' }),
  adminCheck:     p => admGuard_(p, u => ({ ok: true, codigo: u.codigo, nombre: u.nombre })),
  adminCatalogos: p => admGuard_(p, u => adminCatalogos_()),
  adminList:      p => admGuard_(p, u => adminList_(p)),
  adminSave:      p => admGuard_(p, u => adminSave_(u, p)),
  adminDelete:    p => admGuard_(p, u => adminDelete_(u, p)),
  adminSaldos:    p => admGuard_(p, u => adminSaldos_(p)),
  adminResumen:   p => admGuard_(p, u => adminResumen_(p)),
  adminSyncAll:   p => admGuard_(p, u => withLock_(() => ({ ok: true, log: adminSync() }))),
};

// ══════════════════════════════════════════════════════════════
// PERMISOS
// ══════════════════════════════════════════════════════════════
function admAuth_(token) {
  const codigo = readToken_(token);
  if (!codigo) return null;
  const u = findUser_(codigo);
  if (!u || !u.activo) return null;
  const esAdmin = u.admin || ADMIN.CODES.some(c => c.toLowerCase() === str_(codigo).toLowerCase());
  return esAdmin ? u : null;
}

function admGuard_(p, fn) {
  const u = admAuth_(p.token);
  if (!u) return { ok: false, auth: false, error: 'Sin permiso de administrador o sesión vencida.' };
  return fn(u);
}

// ══════════════════════════════════════════════════════════════
// LECTURA / ESCRITURA GENÉRICA
// ══════════════════════════════════════════════════════════════
function admKey_(s) {
  return str_(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Una sola apertura del Sheet y una sola lectura por tabla en cada petición
let _ADM_SS = null;
const _ADM_C = {};
function admSS_() { return _ADM_SS || (_ADM_SS = SpreadsheetApp.openById(ADMIN.SS_ID)); }

function admSheet_(names) {
  const ss = admSS_();
  for (const n of names) {
    const sh = ss.getSheetByName(n);
    if (sh) return sh;
  }
  const want = names.map(admKey_);
  const sh = ss.getSheets().find(s => want.indexOf(admKey_(s.getName())) !== -1);
  if (!sh) throw new Error('No encuentro la hoja ' + names[0]);
  return sh;
}

// campo → índice de columna (0-based). Primero coincidencia exacta; luego por prefijo
// (p. ej. "Tipo (auto) NO PEGAR" o "Nota (pegar en L)"), solo para alias de 4+ letras.
function admMap_(spec, header) {
  const keys = header.map(admKey_);
  const map = {}, used = {};
  Object.keys(spec.fields).forEach(f => {
    for (const a of spec.fields[f]) {
      const i = keys.indexOf(admKey_(a));
      if (i !== -1 && !used[i]) { map[f] = i; used[i] = true; return; }
    }
  });
  Object.keys(spec.fields).forEach(f => {
    if (map[f] !== undefined) return;
    for (const a of spec.fields[f]) {
      const k = admKey_(a);
      if (k.length < 4) continue;
      const i = keys.findIndex((h, j) => !used[j] && h && h.indexOf(k) === 0);
      if (i !== -1) { map[f] = i; used[i] = true; return; }
    }
  });
  return map;
}

const admIsDate_ = v => Object.prototype.toString.call(v) === '[object Date]';

function admOut_(v) {
  if (admIsDate_(v)) return Utilities.formatDate(v, ADMIN.TZ, 'yyyy-MM-dd');
  return v;
}

function admNum_(v) {
  if (typeof v === 'number') return v;
  const s = str_(v);
  if (!s || s === '-') return 0;
  const n = Number(s.replace(/[$\s.]/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function admDate_(v) {
  if (!v) return '';
  if (admIsDate_(v)) return v;
  const m = str_(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : str_(v);
}

function admIn_(field, v) {
  if (ADM_DATE.indexOf(field) !== -1) return admDate_(v);
  if (ADM_NUM.indexOf(field) !== -1) return v === '' || v === null || v === undefined ? '' : admNum_(v);
  return v === null || v === undefined ? '' : v;
}

const admSi_ = v => str_(v).toUpperCase() === 'SI';

function admLoad_(key, fresh) {
  if (!fresh && _ADM_C[key]) return _ADM_C[key];
  const spec = ADM_T[key];
  const sh = admSheet_(spec.sheet);
  const values = sh.getDataRange().getValues();
  const header = values[0] || [];
  const map = admMap_(spec, header);
  const rows = [], byId = {};
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const o = { _row: i + 1 };
    Object.keys(map).forEach(f => { o[f] = admOut_(r[map[f]]); });
    if (o.id) byId[str_(o.id)] = o;
    const req = o[spec.required];
    if (req === '' || req === null || req === undefined) continue;   // fila vacía o con solo el ID
    rows.push(o);
  }
  return (_ADM_C[key] = { key, spec, sh, header, map, rows, byId });
}

// Para Pagos y Gastos (miles de filas): solo encabezado + columna de ID
function admLoadLite_(key) {
  const spec = ADM_T[key];
  const sh = admSheet_(spec.sheet);
  const lastRow = sh.getLastRow(), lastCol = Math.max(sh.getLastColumn(), 1);
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = admMap_(spec, header);
  const byId = {};
  if (map.id !== undefined && lastRow > 1) {
    sh.getRange(2, map.id + 1, lastRow - 1, 1).getValues().forEach((r, i) => {
      const id = str_(r[0]);
      if (id) byId[id] = { _row: i + 2, id };
    });
  }
  return { key, spec, sh, header, map, rows: null, byId, lite: true };
}

function admRowObj_(t, rowNum) {
  const vals = t.sh.getRange(rowNum, 1, 1, t.header.length).getValues()[0];
  const o = { _row: rowNum };
  Object.keys(t.map).forEach(f => { o[f] = admOut_(vals[t.map[f]]); });
  return o;
}

// agrega al final del encabezado las columnas que falten
function admEnsure_(t, fields) {
  let width = t.header.length;
  while (width > 0 && !str_(t.header[width - 1])) width--;
  fields.forEach(f => {
    if (t.map[f] !== undefined || !t.spec.fields[f]) return;
    t.sh.getRange(1, width + 1).setValue(t.spec.fields[f][0]);
    t.map[f] = width;
    t.header[width] = t.spec.fields[f][0];
    width++;
  });
}

function admNextId_(t) {
  let max = 0;
  Object.keys(t.byId).forEach(id => {
    if (id.indexOf(t.spec.prefix) !== 0) return;
    const n = Number(id.slice(t.spec.prefix.length));
    if (!isNaN(n) && n > max) max = n;
  });
  return t.spec.prefix + String(max + 1).padStart(t.spec.pad, '0');
}

// Escribe la fila en una sola llamada; conserva las fórmulas de las columnas que no toca
function admWriteRow_(t, rowNum, obj) {
  const fields = Object.keys(obj).filter(f => t.map[f] !== undefined && f.charAt(0) !== '_');
  if (!fields.length) return;
  const cols = fields.map(f => t.map[f]);
  const c0 = Math.min.apply(null, cols), w = Math.max.apply(null, cols) - c0 + 1;
  const rng = t.sh.getRange(rowNum, c0 + 1, 1, w);
  const vals = rng.getValues()[0], forms = rng.getFormulas()[0];
  const out = vals.map((v, i) => forms[i] || v);
  fields.forEach(f => { out[t.map[f] - c0] = admIn_(f, obj[f]); });
  rng.setValues([out]);
  delete _ADM_C[t.key];
}

function admPublic_(o) {
  const c = {};
  Object.keys(o).forEach(k => { if (k.charAt(0) !== '_') c[k] = o[k]; });
  return c;
}

// ══════════════════════════════════════════════════════════════
// BITÁCORA
// ══════════════════════════════════════════════════════════════
function admLog_(u, accion, tabla, id, antes, despues) {
  const ss = admSS_();
  let sh = ss.getSheetByName('Bitacora');
  if (!sh) {
    sh = ss.insertSheet('Bitacora');
    sh.appendRow(['Fecha', 'Admin', 'Acción', 'Tabla', 'ID', 'Antes', 'Después']);
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date(), u.codigo + ' · ' + u.nombre, accion, tabla, id,
                antes ? JSON.stringify(antes) : '', despues ? JSON.stringify(despues) : '']);
}

// ══════════════════════════════════════════════════════════════
// CATÁLOGOS (para los desplegables)
// ══════════════════════════════════════════════════════════════
function admListas_() {
  const v = admSheet_(['Listas']).getDataRange().getValues();
  const out = {};
  (v[0] || []).forEach((h, c) => {
    if (!str_(h)) return;
    out[str_(h)] = v.slice(1).map(r => str_(r[c])).filter(Boolean);
  });
  return out;
}

function adminCatalogos_() {
  return {
    ok: true,
    jugadores: admLoad_('jugadores').rows.map(admPublic_),
    conceptos: admLoad_('conceptos').rows.map(admPublic_),
    tiposGasto: admLoad_('tiposGasto').rows.map(admPublic_),
    categorias: admLoad_('categorias').rows.map(admPublic_),
    listas: admListas_(),
  };
}

// ══════════════════════════════════════════════════════════════
// LISTAR (tablas del panel)
//   tabla, anio, q (texto), idJug, idConc, limit
// ══════════════════════════════════════════════════════════════
function adminList_(p) {
  const tabla = str_(p.tabla);
  if (!ADM_T[tabla]) return { ok: false, error: 'Tabla no válida' };
  let rows = admLoad_(tabla).rows;
  const anio = str_(p.anio);
  if (anio && (tabla === 'pagos' || tabla === 'gastos')) rows = rows.filter(r => str_(r.fecha).slice(0, 4) === anio);
  if (anio && tabla === 'conceptos') rows = rows.filter(r => str_(r.anio) === anio);
  if (p.idJug) rows = rows.filter(r => str_(r.idJug) === str_(p.idJug));
  if (p.idConc) rows = rows.filter(r => str_(r.idConc) === str_(p.idConc));
  const q = admKey_(p.q);
  if (q) rows = rows.filter(r => Object.keys(r).some(k => k.charAt(0) !== '_' && admKey_(r[k]).indexOf(q) !== -1));
  if (tabla === 'pagos' || tabla === 'gastos') rows.sort((a, b) => str_(b.fecha).localeCompare(str_(a.fecha)) || b._row - a._row);
  const total = rows.length;
  const suma = rows.reduce((s, r) => s + admNum_(r.valor || r.valorTotal), 0);
  const limit = Number(p.limit) || ADMIN.LIST_LIMIT;
  return { ok: true, tabla, total, suma, rows: rows.slice(0, limit).map(admPublic_) };
}

// ══════════════════════════════════════════════════════════════
// GUARDAR (crear si no trae id, editar si trae id)
// ══════════════════════════════════════════════════════════════
function admData_(p) {
  if (p.data && typeof p.data === 'object') return Object.assign({}, p.data);
  try { return JSON.parse(p.data || '{}'); } catch (_) { return {}; }
}

function adminSave_(u, p) {
  const tabla = str_(p.tabla);
  if (!ADM_T[tabla]) return { ok: false, error: 'Tabla no válida' };
  const data = admData_(p);
  return withLock_(() => {
    const lite = tabla === 'pagos' || tabla === 'gastos';
    const t = lite ? admLoadLite_(tabla) : admLoad_(tabla, true);
    const id = str_(data.id || p.id);
    const antes = id && t.byId[id] ? (lite ? admRowObj_(t, t.byId[id]._row) : t.byId[id]) : null;
    if (id && !antes && !t.spec.manualId) return { ok: false, error: 'No existe ' + id };

    const prep = admPrepare_(tabla, data, antes, u);
    if (prep.error) return { ok: false, error: prep.error };
    const obj = prep.obj;
    admEnsure_(t, Object.keys(obj));

    let rowNum;
    if (antes) {
      rowNum = antes._row;
    } else {
      if (!t.spec.manualId) obj.id = admNextId_(t);
      const hueco = t.byId[str_(obj.id)];               // fila con solo el ID (plantilla)
      rowNum = hueco ? hueco._row : t.sh.getLastRow() + 1;
    }
    admWriteRow_(t, rowNum, obj);
    if (prep.after) prep.after(obj);
    admLog_(u, antes ? 'editar' : 'crear', tabla, obj.id || id, antes ? admPublic_(antes) : null, obj);
    // CXP: recalcular si cambió un gasto o una cuenta, o un pago de un concepto que financia una cuenta
    if (tabla === 'gastos' || tabla === 'cxp' ||
        (tabla === 'pagos' && admLoad_('cxp').rows.some(c => admIds_(c.idConc).indexOf(str_(obj.idConc)) !== -1))) {
      admSyncCxp_();
    }
    // Jugadores: estado / pagado / debe del jugador tocado (o de todos si cambió una tarifa)
    if (tabla === 'pagos') admSyncJugadores_([obj.idJug, antes && antes.idJug]);
    if (tabla === 'jugadores') admSyncJugadores_([obj.id]);
    if (tabla === 'conceptos') admSyncJugadores_();
    return { ok: true, tabla, id: obj.id || id, data: obj };
  });
}

// Completa lo que se deduce de los catálogos y valida. Devuelve { obj } o { error }.
function admPrepare_(tabla, d, antes, u) {
  const base = antes ? admPublic_(antes) : {};
  const m = Object.assign({}, base, d);
  const ahora = new Date();
  const hoy = Utilities.formatDate(ahora, ADMIN.TZ, 'yyyy-MM-dd');

  if (tabla === 'pagos') {
    const j = admLoad_('jugadores').byId[str_(m.idJug)];
    const c = admLoad_('conceptos').byId[str_(m.idConc)];
    if (!j) return { error: 'Escoge un jugador.' };
    if (!c) return { error: 'Escoge un concepto.' };
    if (!str_(m.medio)) return { error: 'Escoge el medio de pago.' };
    const exo = admKey_(m.medio) === 'exoneracion';
    if (!exo && !(admNum_(m.valor) > 0)) return { error: 'El valor debe ser mayor que 0.' };
    return {
      obj: {
        id: m.id, fecha: m.fecha || hoy, idJug: j.id, jugador: j.nombre, idConc: c.id, concepto: c.concepto,
        tipo: c.tipo, valor: exo ? 0 : admNum_(m.valor), medio: m.medio, notas: m.notas || '',
        categoria: m.categoria || j.categoria || '', registro: u.nombre,
        creado: antes ? (base.creado || hoy) : hoy,
      },
    };
  }

  if (tabla === 'gastos') {
    const c = admLoad_('conceptos').byId[str_(m.idConc)];
    const tg = admLoad_('tiposGasto').byId[str_(m.idTipo)];
    if (!c) return { error: 'Escoge de qué bolsa (concepto) sale el gasto.' };
    if (!tg) return { error: 'Escoge el tipo de gasto.' };
    if (!(admNum_(m.valor) > 0)) return { error: 'El valor debe ser mayor que 0.' };
    const cat = str_(tg.categoriaFija) || str_(m.categoria);
    if (!cat) return { error: 'Escoge la categoría del gasto.' };
    if (m.idCxp && !admLoad_('cxp').byId[str_(m.idCxp)]) return { error: 'La cuenta por pagar ' + m.idCxp + ' no existe.' };
    return {
      obj: {
        id: m.id, fecha: m.fecha || hoy, idConc: c.id, rubro: c.concepto, idTipo: tg.id, proveedor: tg.nombre,
        clase: tg.clase, categoria: cat, valor: admNum_(m.valor), medio: m.medio || '', soporte: m.soporte || '',
        notas: m.notas || '', idCxp: m.idCxp || '', registro: u.nombre, creado: antes ? (base.creado || hoy) : hoy,
      },
    };
  }

  if (tabla === 'cxp') {
    if (!str_(m.proveedor)) return { error: 'Falta el proveedor.' };
    if (!(admNum_(m.valorTotal) > 0)) return { error: 'Falta el valor total.' };
    const malos = admIds_(m.idConc).filter(x => !admLoad_('conceptos').byId[x]);
    if (malos.length) return { error: 'No existe el concepto ' + malos.join(', ') + '.' };
    return {
      obj: {
        id: m.id, proveedor: m.proveedor, concepto: m.concepto || '', tipo: m.tipo || '', categoria: m.categoria || '',
        fechaLimite: m.fechaLimite || '', valorTotal: admNum_(m.valorTotal), nota: m.nota || '', idConc: m.idConc || '',
      },
    };
  }

  if (tabla === 'jugadores') {
    if (!str_(m.nombre)) return { error: 'Falta el nombre (Apellido Nombre).' };
    const t = admLoad_('jugadores');
    const dupNom = t.rows.find(r => admKey_(r.nombre) === admKey_(m.nombre) && r.id !== m.id);
    if (dupNom) return { error: 'Ya existe ' + dupNom.nombre + ' (' + dupNom.id + ').' };
    if (m.codigo) {
      const dupCod = t.rows.find(r => admKey_(r.codigo) === admKey_(m.codigo) && r.id !== m.id);
      if (dupCod) return { error: 'El código ' + m.codigo + ' ya es de ' + dupCod.nombre + '.' };
    }
    const obj = {};
    ['id', 'codigo', 'nombre', 'categoria', 'categoria2', 'categoria3', 'activo', 'afiliado', 'extranjero',
     'lesionado', 'premios', 'estado'].forEach(k => { if (m[k] !== undefined) obj[k] = m[k]; });
    obj.activo = obj.activo || 'SI';
    // si trae código nuevo, también se crea el usuario del portal (sin contraseña: la pone al entrar)
    const after = o => {
      if (!o.codigo || findUser_(o.codigo, true)) return;
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.USERS).appendRow([o.codigo, o.nombre, '', 'SI']);
      clearCache_();
    };
    return { obj, after };
  }

  if (tabla === 'conceptos') {
    if (!str_(m.concepto)) return { error: 'Falta el nombre del concepto.' };
    const t = admLoad_('conceptos');
    const dup = t.rows.find(r => admKey_(r.concepto) === admKey_(m.concepto) && r.id !== m.id);
    if (dup) return { error: 'Ya existe el concepto ' + dup.concepto + ' (' + dup.id + ').' };
    const obj = {};
    ['id', 'concepto', 'tipo', 'ambito', 'anio', 'vence', 'activo', 'nota'].concat(ADMIN.CATS)
      .forEach(k => { if (m[k] !== undefined) obj[k] = m[k]; });
    obj.activo = obj.activo || 'SI';
    return { obj };
  }

  if (tabla === 'tiposGasto') {
    if (!str_(m.nombre)) return { error: 'Falta el nombre del tipo de gasto.' };
    const obj = {};
    ['id', 'nombre', 'clase', 'categoriaFija', 'activo', 'nota'].forEach(k => { if (m[k] !== undefined) obj[k] = m[k]; });
    obj.activo = obj.activo || 'SI';
    return { obj };
  }

  if (tabla === 'categorias') {
    if (!str_(m.id)) return { error: 'Falta el ID de la categoría.' };
    return { obj: m };
  }
  return { error: 'Tabla no válida' };
}

// ══════════════════════════════════════════════════════════════
// BORRAR (con bitácora; si hay registros que lo usan, pide force o desactivar)
// ══════════════════════════════════════════════════════════════
function adminDelete_(u, p) {
  const tabla = str_(p.tabla), id = str_(p.id);
  if (!ADM_T[tabla]) return { ok: false, error: 'Tabla no válida' };
  return withLock_(() => {
    const lite = tabla === 'pagos' || tabla === 'gastos';
    const t = lite ? admLoadLite_(tabla) : admLoad_(tabla, true);
    const row = t.byId[id] ? (lite ? admRowObj_(t, t.byId[id]._row) : t.byId[id]) : null;
    if (!row) return { ok: false, error: 'No existe ' + id };
    const usos = (ADM_REFS[tabla] || []).reduce((n, [tb, f]) =>
      n + admLoad_(tb).rows.filter(r => str_(r[f]) === id).length, 0);
    if (usos && String(p.force) !== 'true') {
      return { ok: false, usos, error: id + ' tiene ' + usos + ' movimientos asociados. Mejor desactívalo (Activo = NO) o confirma el borrado.' };
    }
    t.sh.deleteRow(row._row);
    delete _ADM_C[tabla];
    admLog_(u, 'borrar', tabla, id, admPublic_(row), null);
    if (['pagos', 'gastos', 'cxp'].indexOf(tabla) !== -1) admSyncCxp_();
    if (tabla === 'pagos') admSyncJugadores_([row.idJug]);
    if (tabla === 'conceptos') admSyncJugadores_();
    return { ok: true, tabla, id };
  });
}

// ══════════════════════════════════════════════════════════════
// SALDOS POR JUGADOR
//   anio (por defecto el año más alto con conceptos activos), idJug (detalle de uno), todos=true (incluye inactivos)
//   Cobro = tarifa del concepto en cada categoría del jugador (Ámbito CLUB se cobra una sola vez).
//   Exoneración en un concepto = saldo 0. Vencido = fecha "Vence" ya pasó.
// ══════════════════════════════════════════════════════════════
function admIndices_() {
  const jug = admLoad_('jugadores'), conc = admLoad_('conceptos');
  const jByName = {}, cByName = {};
  jug.rows.forEach(j => { jByName[admKey_(j.nombre)] = j.id; });
  conc.rows.forEach(c => { cByName[admKey_(c.concepto)] = c.id; });
  return { jug, conc, jByName, cByName };
}

// "Vence" + días de gracia, al final del día
function admVence_(vence) {
  const d = new Date(str_(vence).slice(0, 10) + 'T23:59:59');
  d.setDate(d.getDate() + (ADMIN.DIAS_GRACIA || 0));
  return d;
}

// columna Estado de Jugadores = cambio manual. Vacía → manda el automático.
function admEstadoManual_(v) {
  const k = admKey_(v);
  if (!k) return '';
  if (k.indexOf('mora') === 0) return 'MORA';
  if (k.indexOf('habilit') === 0 || k.indexOf('aldia') === 0) return 'AL DÍA';
  return '';
}

function adminSaldos_(p) {
  const ix = admIndices_();
  const anios = ix.conc.rows.filter(c => admSi_(c.activo)).map(c => Number(c.anio) || 0);
  const anio = Number(p.anio) || Math.max.apply(null, anios.concat([new Date().getFullYear()]));
  const delAnio = ix.conc.rows.filter(c => Number(c.anio) === anio);
  const ahora = new Date();

  const pag = {}, exo = {};
  admLoad_('pagos').rows.forEach(r => {
    const j = str_(r.idJug) || ix.jByName[admKey_(r.jugador)];
    const c = str_(r.idConc) || ix.cByName[admKey_(r.concepto)];
    if (!j || !c) return;
    const k = j + '|' + c;
    pag[k] = (pag[k] || 0) + admNum_(r.valor);
    if (admKey_(r.medio) === 'exoneracion') exo[k] = true;
  });

  let jugadores = ix.jug.rows.filter(j => String(p.todos) === 'true' || admSi_(j.activo));
  if (p.idJug) jugadores = jugadores.filter(j => j.id === str_(p.idJug));

  const out = jugadores.map(j => {
    const cats = [j.categoria, j.categoria2, j.categoria3].map(c => str_(c).toUpperCase())
      .filter(c => ADMIN.CATS.indexOf(c) !== -1);
    const items = [];
    delAnio.forEach(c => {
      const tarifas = cats.map(k => admNum_(c[k]));
      const tarifa = str_(c.ambito).toUpperCase() === 'CLUB'
        ? Math.max.apply(null, tarifas.concat([0]))
        : tarifas.reduce((s, v) => s + v, 0);
      const k = j.id + '|' + c.id;
      const pagado = pag[k] || 0;
      if (!tarifa && !pagado && !exo[k]) return;
      const exonerado = !!exo[k];
      const saldo = exonerado ? 0 : Math.max(0, tarifa - pagado);
      const vencido = !!c.vence && admVence_(c.vence) <= ahora;
      items.push({ idConc: c.id, concepto: c.concepto, tipo: c.tipo, vence: c.vence, tarifa, pagado, exonerado,
                   saldo, vencido, aFavor: Math.max(0, pagado - tarifa) });
    });
    const sum = f => items.reduce((s, i) => s + f(i), 0);
    const r = {
      idJug: j.id, codigo: j.codigo, nombre: j.nombre, categorias: cats, activo: j.activo,
      cobroAnio: sum(i => i.tarifa), cobroALaFecha: sum(i => (i.vencido ? i.tarifa : 0)),
      pagado: sum(i => i.pagado), saldoAnio: sum(i => i.saldo), saldoVencido: sum(i => (i.vencido ? i.saldo : 0)),
      aFavor: sum(i => i.aFavor),
    };
    r.estadoAuto = !admSi_(j.activo) ? 'INACTIVO' : (r.saldoVencido > 0 ? 'MORA' : 'AL DÍA');
    r.estadoManual = admEstadoManual_(j.estado);
    r.estado = r.estadoManual || r.estadoAuto;
    if (p.idJug) r.items = items;
    return r;
  });
  out.sort((a, b) => b.saldoVencido - a.saldoVencido || a.nombre.localeCompare(b.nombre, 'es'));
  return {
    ok: true, anio, jugadores: out,
    totales: {
      saldoVencido: out.reduce((s, r) => s + r.saldoVencido, 0),
      saldoAnio: out.reduce((s, r) => s + r.saldoAnio, 0),
      enMora: out.filter(r => r.estado === 'MORA').length,
    },
  };
}

// ══════════════════════════════════════════════════════════════
// RESUMEN: caja, ingresos y gastos por mes / concepto / tipo, CXP
// ══════════════════════════════════════════════════════════════
function adminResumen_(p) {
  const anio = str_(p.anio) || String(new Date().getFullYear());
  const pagos = admLoad_('pagos').rows, gastos = admLoad_('gastos').rows;
  const ix = admIndices_();
  const mesIng = Array(12).fill(0), mesGas = Array(12).fill(0);
  const porConc = {}, porTipo = {}, porCat = {};
  let ing = 0, gas = 0, cajaIng = 0, cajaGas = 0;
  const conc = id => (porConc[id] = porConc[id] || { idConc: id, concepto: (ix.conc.byId[id] || {}).concepto || id, ingresos: 0, gastos: 0 });

  pagos.forEach(r => {
    const v = admNum_(r.valor);
    cajaIng += v;
    if (str_(r.fecha).slice(0, 4) !== anio) return;
    ing += v;
    mesIng[Number(str_(r.fecha).slice(5, 7)) - 1] += v;
    conc(str_(r.idConc) || ix.cByName[admKey_(r.concepto)] || r.concepto).ingresos += v;
    const c = str_(r.categoria) || 'SIN CATEGORÍA';
    (porCat[c] = porCat[c] || { categoria: c, ingresos: 0, gastos: 0 }).ingresos += v;
  });
  gastos.forEach(r => {
    const v = admNum_(r.valor);
    cajaGas += v;
    if (str_(r.fecha).slice(0, 4) !== anio) return;
    gas += v;
    mesGas[Number(str_(r.fecha).slice(5, 7)) - 1] += v;
    conc(str_(r.idConc) || ix.cByName[admKey_(r.rubro)] || r.rubro).gastos += v;
    const tp = str_(r.proveedor) || 'SIN TIPO';
    (porTipo[tp] = porTipo[tp] || { tipo: tp, clase: r.clase, gastos: 0 }).gastos += v;
    const c = str_(r.categoria) || 'SIN CATEGORÍA';
    (porCat[c] = porCat[c] || { categoria: c, ingresos: 0, gastos: 0 }).gastos += v;
  });

  const conceptos = Object.values(porConc).map(c => Object.assign(c, { resultado: c.ingresos - c.gastos }))
    .sort((a, b) => b.ingresos + b.gastos - a.ingresos - a.gastos);
  return {
    ok: true, anio: Number(anio),
    totales: { ingresos: ing, gastos: gas, resultado: ing - gas, cajaAcumulada: cajaIng - cajaGas },
    meses: mesIng.map((v, i) => ({ mes: i + 1, ingresos: v, gastos: mesGas[i] })),
    conceptos, tipos: Object.values(porTipo).sort((a, b) => b.gastos - a.gastos),
    categorias: Object.values(porCat), cxp: admCxpEstado_(pagos, gastos),
  };
}

// recogido = pagos del concepto que la financia; pagado = gastos marcados con su ID CXP
function admCxpEstado_(pagos, gastos) {
  const hoy = Utilities.formatDate(new Date(), ADMIN.TZ, 'yyyy-MM-dd');
  return admLoad_('cxp').rows.map(c => {
    const total = admNum_(c.valorTotal);
    const pagado = gastos.filter(g => str_(g.idCxp) === str_(c.id)).reduce((s, g) => s + admNum_(g.valor), 0);
    const ids = admIds_(c.idConc);
    const recogido = ids.length
      ? pagos.filter(r => ids.indexOf(str_(r.idConc)) !== -1).reduce((s, r) => s + admNum_(r.valor), 0) : 0;
    const saldo = total - pagado;
    const estado = saldo <= 0 ? 'PAGADA' : (c.fechaLimite && str_(c.fechaLimite) < hoy ? 'VENCIDA' : 'PENDIENTE');
    return Object.assign(admPublic_(c), { valorTotal: total, pagado, recogido, saldo, estado,
                                          faltaRecoger: ids.length ? Math.max(0, total - recogido) : null });
  });
}

// "C005, C006" → ['C005','C006']
const admIds_ = v => str_(v).split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);

// deja en la hoja CXP los valores calculados (Recogido, Pagado, Saldo, Estado)
function admSyncCxp_() {
  const t = admLoad_('cxp', true);
  const estado = admCxpEstado_(admLoad_('pagos', true).rows, admLoad_('gastos', true).rows);
  estado.forEach(c => {
    const row = t.byId[str_(c.id)];
    if (!row) return;
    admWriteRow_(t, row._row, { recogido: c.recogido, pagado: c.pagado, saldo: c.saldo, estado: c.estado });
  });
}

// Escribe en Jugadores: Estado (auto), Pagado año y Debe año del año vigente.
// ids = lista de ID de jugador; sin ids recalcula a todos.
function admSyncJugadores_(ids) {
  ids = (ids || []).map(str_).filter(Boolean);
  const todos = !ids.length;
  const s = adminSaldos_({ todos: 'true' });
  const porId = {};
  s.jugadores.forEach(r => { porId[r.idJug] = r; });
  const t = admLoad_('jugadores', true);
  admEnsure_(t, ['estadoAuto', 'pagadoAnio', 'debeAnio']);
  const val = r => (r ? [r.estadoAuto, r.pagado, r.saldoAnio] : ['', '', '']);
  if (!todos) {
    ids.forEach(id => { const row = t.byId[id]; if (row) admWriteRow_(t, row._row, admObj_(val(porId[id]))); });
    return;
  }
  const n = t.sh.getLastRow() - 1;
  if (n < 1) return;
  const idsCol = t.sh.getRange(2, t.map.id + 1, n, 1).getValues();
  ['estadoAuto', 'pagadoAnio', 'debeAnio'].forEach((f, k) => {
    const col = idsCol.map(r => [porId[str_(r[0])] ? val(porId[str_(r[0])])[k] : '']);
    t.sh.getRange(2, t.map[f] + 1, n, 1).setValues(col);
  });
  delete _ADM_C.jugadores;
  return s.anio;
}
const admObj_ = v => ({ estadoAuto: v[0], pagadoAnio: v[1], debeAnio: v[2] });

// CXP sin "ID concepto": se vincula sola si el proveedor o la descripción coincide con UN concepto activo
function admVincularCxp_() {
  const t = admLoad_('cxp', true);
  admEnsure_(t, ['idConc']);
  const activos = admLoad_('conceptos', true).rows.filter(c => admSi_(c.activo));
  const hechos = [];
  t.rows.forEach(c => {
    if (admIds_(c.idConc).length) return;
    const claves = [c.concepto, c.proveedor].map(admKey_).filter(k => k.length >= 4);
    for (const k of claves) {
      const m = activos.filter(x => admKey_(x.concepto).indexOf(k) !== -1);
      if (m.length === 1) { admWriteRow_(t, c._row, { idConc: m[0].id }); hechos.push(c.id + ' → ' + m[0].id + ' ' + m[0].concepto); return; }
    }
  });
  return hechos;
}

// Recalcula todo: vínculos y saldos de CXP + estado/pagado/debe de cada jugador.
// Correr a mano o dejarlo con el disparador diario (adminInstalarDisparador).
function adminSync() {
  const v = admVincularCxp_();
  admSyncCxp_();
  const anio = admSyncJugadores_();
  const log = ['CXP vinculadas: ' + (v.length ? v.join(' | ') : 'ninguna nueva'), 'Jugadores recalculados (año ' + anio + ')'];
  console.log(log.join('\n'));
  return log;
}

function adminInstalarDisparador() {
  ScriptApp.getProjectTriggers().filter(tr => tr.getHandlerFunction() === 'adminSync').forEach(tr => ScriptApp.deleteTrigger(tr));
  ScriptApp.newTrigger('adminSync').timeBased().everyDays(1).atHour(5).create();
  console.log('Disparador diario de adminSync creado (5 a. m.)');
}

// ══════════════════════════════════════════════════════════════
// SETUP Y PRUEBA (se corren a mano desde el editor)
// ══════════════════════════════════════════════════════════════
function adminSetup() {
  const ix = admIndices_();
  const tgByName = {};
  admLoad_('tiposGasto').rows.forEach(r => { tgByName[admKey_(r.nombre)] = r.id; });
  const log = [];

  // Pagos y Gastos: columnas de ID, ID por fila y, si faltan, ID de jugador / concepto / tipo por nombre
  [['pagos', ['idJug', 'idConc', 'id', 'creado']], ['gastos', ['idConc', 'idTipo', 'notas', 'idCxp', 'id', 'registro', 'creado']]]
    .forEach(([tabla, cols]) => {
      const t = admLoad_(tabla, true);
      admEnsure_(t, cols);
      const n = t.sh.getLastRow() - 1;
      if (n < 1) return;
      const leer = f => t.sh.getRange(2, t.map[f] + 1, n, 1).getValues();
      const col = {};
      ['id', 'idJug', 'idConc', 'idTipo', 'jugador', 'concepto', 'rubro', 'proveedor', 'valor']
        .forEach(f => { if (t.map[f] !== undefined) col[f] = leer(f); });
      let seq = 0, llenos = { id: 0, idJug: 0, idConc: 0, idTipo: 0 }, sinMatch = 0;
      Object.keys(t.byId).forEach(id => {
        const k = Number(id.slice(t.spec.prefix.length));
        if (id.indexOf(t.spec.prefix) === 0 && k > seq) seq = k;
      });
      for (let i = 0; i < n; i++) {
        if (col.valor[i][0] === '' || col.valor[i][0] === null) continue;
        if (!str_(col.id[i][0])) { col.id[i][0] = t.spec.prefix + String(++seq).padStart(t.spec.pad, '0'); llenos.id++; }
        if (tabla === 'pagos') {
          if (!str_(col.idJug[i][0])) { const v = ix.jByName[admKey_(col.jugador[i][0])]; if (v) { col.idJug[i][0] = v; llenos.idJug++; } else sinMatch++; }
          if (!str_(col.idConc[i][0])) { const v = ix.cByName[admKey_(col.concepto[i][0])]; if (v) { col.idConc[i][0] = v; llenos.idConc++; } }
        } else {
          if (!str_(col.idConc[i][0])) { const v = ix.cByName[admKey_(col.rubro[i][0])]; if (v) { col.idConc[i][0] = v; llenos.idConc++; } }
          if (!str_(col.idTipo[i][0])) { const v = tgByName[admKey_(col.proveedor[i][0])]; if (v) { col.idTipo[i][0] = v; llenos.idTipo++; } }
        }
      }
      ['id', 'idJug', 'idConc', 'idTipo'].forEach(f => {
        if (col[f]) t.sh.getRange(2, t.map[f] + 1, n, 1).setValues(col[f]);
      });
      log.push(tabla + ': ' + JSON.stringify(llenos) + (tabla === 'pagos' ? ' · filas sin jugador en el catálogo (grupos, etc.): ' + sinMatch : ''));
    });

  // CXP vinculadas a conceptos + saldos, y estado/pagado/debe de jugadores
  adminSync().forEach(l => log.push(l));

  // Bitácora
  admLog_({ codigo: 'SETUP', nombre: 'adminSetup' }, 'setup', '-', '-', null, { log });
  console.log(log.join('\n'));
  return log;
}

function adminTest() {
  const token = makeToken_(ADMIN.CODES[0]);
  const call = (action, extra) => {
    const r = route_(Object.assign({ action, token }, extra || {}));
    return JSON.parse(r.getContent());
  };
  const cat = call('adminCatalogos');
  console.log('catálogos', cat.ok, 'jugadores', (cat.jugadores || []).length, 'conceptos', (cat.conceptos || []).length,
              'tipos', (cat.tiposGasto || []).length, 'listas', Object.keys(cat.listas || {}).join(', '));
  const pg = call('adminList', { tabla: 'pagos', anio: '2026', limit: 3 });
  console.log('pagos 2026', pg.total, 'suma', pg.suma, JSON.stringify(pg.rows));
  const res = call('adminResumen', { anio: '2026' });
  console.log('resumen 2026', JSON.stringify(res.totales), 'cxp', JSON.stringify((res.cxp || []).map(c => [c.id, c.saldo, c.estado])));
  const sal = call('adminSaldos', { anio: '2027' });
  console.log('saldos 2027', JSON.stringify(sal.totales), 'jugadores', (sal.jugadores || []).length);
  const no = route_({ action: 'adminCatalogos', token: makeToken_('E26') });
  console.log('no admin (E26) →', no.getContent().slice(0, 80));
}
