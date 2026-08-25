// state.js — Modelo de datos, estado en memoria, autoguardado e historial automático.
// El operador nunca escribe el historial a mano: cada acción relevante lo genera acá.

const CUARTEL_BASE_NOMBRE = 'BOMBEROS VOLUNTARIOS DE PILAR';
const FRENTES = ['A', 'B', 'C', 'D', 'AB', 'BC', 'CD', 'DA'];
const FRENTES_PRINCIPALES = ['A', 'B', 'C', 'D'];

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function nowStr() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function fullNowISO() {
  return new Date().toISOString();
}

function emptyState() {
  return {
    incidente: null, // {id, nombre, lugar, fechaHoraInicio, comandante, cuartelBase, finalizado, fechaHoraFin}
    personal: {
      totalPresente: 0,          // headcount editable de personal de Pilar presente
      nombresConocidos: []       // nombres ya registrados (de meta permanente + refuerzos vistos en este incidente), para autocompletar
    },
    refuerzos: [],   // {id, cuartel, personal, encargado, moviles:[id...], personalSinMovil, estado}
    moviles: [],     // {id, numero, tipo, personal, estado, ubicacionFrente, cisternaAsociada, movilAsociado, capacidadLitros, origen}
    subdivisiones: [], // {id, frente, index, activa}  id ej "B1"
    lineas: [],      // {id, numero, movilId, frenteId, grupoId, estado}
    grupos: [],      // {id, encargado, personas, lineasIds, estado} estado: 'trabajando'|'descanso'|'cerrado'
    seguridad: [],   // {id, frenteId, oficial, visible}
    historial: [],   // {id, hora, fechaHora, accion, recurso, contexto, ubicacion, categoria}
    instantaneas: [] // {id, etiqueta, hora, resumen}
  };
}

let state = emptyState();
let meta = { cuartel: CUARTEL_BASE_NOMBRE, nombresPilarPermanentes: [] };
let saveTimer = null;
let onSavedCallback = null;
let onChangeCallback = null;

const Store = {
  init(onSaved, onChange) {
    onSavedCallback = onSaved;
    onChangeCallback = onChange;
  },
  getState() { return state; },
  getMeta() { return meta; },

  setState(newState) { state = newState; },
  setMeta(newMeta) { meta = newMeta; },

  // ---- Autoguardado ----
  touch(skipHistory) {
    if (onChangeCallback) onChangeCallback();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await DB.saveActiveIncident(state);
      if (onSavedCallback) onSavedCallback();
    }, 150);
  },

  async persistMetaNow() {
    await DB.setMeta(meta);
  },

  // ---- Historial automático ----
  log(categoria, accion, recurso, contexto, ubicacion) {
    state.historial.push({
      id: uid('ev'),
      hora: nowStr(),
      fechaHora: fullNowISO(),
      categoria, // 'movil'|'linea'|'personal'|'seguridad'|'cisterna'|'refuerzo'|'incidente'|'grupo'
      accion,
      recurso: recurso || '',
      contexto: contexto || '',
      ubicacion: ubicacion || ''
    });
  },

  // ================= INCIDENTE =================
  crearIncidente({ nombre, lugar, fechaHoraInicio, comandante }) {
    state = emptyState();
    state.incidente = {
      id: uid('inc'),
      nombre, lugar, fechaHoraInicio, comandante,
      cuartelBase: meta.cuartel || CUARTEL_BASE_NOMBRE,
      finalizado: false,
      fechaHoraFin: null
    };
    // Sectores y subdivisiones no se crean manualmente pero la lista existe desde el inicio (vacía de instancias).
    this.log('incidente', 'Incidente creado', nombre, comandante ? `Comandante: ${comandante}` : '', lugar);
    this.snapshot('Inicio');
    this.touch();
  },

  finalizarIncidente() {
    state.incidente.finalizado = true;
    state.incidente.fechaHoraFin = fullNowISO();
    this.log('incidente', 'Incidente finalizado', state.incidente.nombre, '', '');
    this.snapshot('Finalización');
    this.touch();
  },

  // ================= PERSONAL =================
  setPersonalPresente(n) {
    const prev = state.personal.totalPresente;
    state.personal.totalPresente = Math.max(0, n);
    this.log('personal', 'Personal presente actualizado', `${prev} → ${state.personal.totalPresente}`, '', '');
    this.touch();
  },

  registrarNombreConocido(nombre) {
    if (!nombre) return;
    if (!state.personal.nombresConocidos.includes(nombre)) {
      state.personal.nombresConocidos.push(nombre);
    }
  },

  guardarNombrePilarPermanente(nombre) {
    if (!nombre) return;
    if (!meta.nombresPilarPermanentes.includes(nombre)) {
      meta.nombresPilarPermanentes.push(nombre);
      this.persistMetaNow();
    }
  },

  // ================= REFUERZOS =================
  agregarRefuerzo({ cuartel, personal, encargado, moviles, personalSinMovil }) {
    const refuerzoId = uid('ref');
    const movilesIds = [];
    (moviles || []).forEach(m => {
      const id = uid('mov');
      state.moviles.push({
        id, numero: m.numero, tipo: m.tipo, personal: m.personal,
        estado: 'disponible', ubicacionFrente: null,
        cisternaAsociada: null, movilAsociado: null,
        capacidadLitros: m.tipo === 'cisterna' ? Number(m.capacidadLitros || 0) : null,
        origen: refuerzoId
      });
      movilesIds.push(id);
    });
    state.refuerzos.push({
      id: refuerzoId, cuartel, personal: Number(personal || 0),
      encargado: encargado || '', moviles: movilesIds,
      personalSinMovil: Number(personalSinMovil || 0), estado: 'activo'
    });
    this.registrarNombreConocido(encargado);
    this.log('refuerzo', 'Refuerzo incorporado', cuartel, `Personal: ${personal}`, '');
    this.touch();
  },

  dependenciasDeRefuerzo(refuerzoId) {
    const ref = state.refuerzos.find(r => r.id === refuerzoId);
    if (!ref) return [];
    const deps = [];
    ref.moviles.forEach(mId => {
      const mov = state.moviles.find(m => m.id === mId);
      if (mov && mov.estado !== 'retirado') {
        deps.push({ tipo: 'movil', id: mov.id, label: `Móvil ${mov.numero}` });
        state.lineas.filter(l => l.movilId === mov.id && l.estado === 'activa').forEach(l => {
          deps.push({ tipo: 'linea', id: l.id, label: `Línea ${l.numero}` });
          if (l.grupoId) {
            const g = state.grupos.find(gr => gr.id === l.grupoId);
            if (g && g.estado === 'trabajando') deps.push({ tipo: 'grupo', id: g.id, label: `${g.encargado} — ${g.personas} personas` });
          }
        });
      }
    });
    return deps;
  },

  retirarRefuerzo(refuerzoId) {
    const ref = state.refuerzos.find(r => r.id === refuerzoId);
    if (!ref) return;
    ref.estado = 'retirado';
    ref.moviles.forEach(mId => {
      const mov = state.moviles.find(m => m.id === mId);
      if (mov) mov.estado = 'retirado';
    });
    this.log('refuerzo', 'Refuerzo retirado del incidente', ref.cuartel, '', '');
    this.touch();
  },

  // ================= MÓVILES =================
  crearMovil({ numero, tipo, personal, capacidadLitros }) {
    const id = uid('mov');
    state.moviles.push({
      id, numero, tipo, personal: Number(personal || 0),
      estado: 'disponible', ubicacionFrente: null,
      cisternaAsociada: null, movilAsociado: null,
      capacidadLitros: tipo === 'cisterna' ? Number(capacidadLitros || 0) : null,
      origen: 'pilar'
    });
    this.log(tipo === 'cisterna' ? 'cisterna' : 'movil', `${tipo === 'cisterna' ? 'Cisterna' : 'Móvil'} incorporado`, `${tipo === 'cisterna' ? 'Cisterna' : 'Ataque'} ${numero}`, '', '');
    this.touch();
    return id;
  },

  // Obtiene o crea la próxima subdivisión de un frente principal (A/B/C/D)
  _proximaSubdivision(frente) {
    const existentes = state.subdivisiones.filter(s => s.frente === frente);
    const index = existentes.length + 1;
    const id = `${frente}${index}`;
    const sub = { id, frente, index, activa: true };
    state.subdivisiones.push(sub);
    return sub;
  },

  _asegurarSeguridad(frenteId) {
    let seg = state.seguridad.find(s => s.frenteId === frenteId);
    if (!seg) {
      seg = { id: uid('seg'), frenteId, oficial: null, visible: true };
      state.seguridad.push(seg);
      this.log('seguridad', 'Seguridad sin asignar (generado)', `Frente ${frenteId}`, '', frenteId);
    } else {
      seg.visible = true;
    }
    return seg;
  },

  asignarMovilAFrente(movilId, frentePrincipal) {
    const mov = state.moviles.find(m => m.id === movilId);
    if (!mov) return;
    let frenteId;
    if (mov.tipo === 'ataque') {
      const sub = this._proximaSubdivision(frentePrincipal);
      frenteId = sub.id;
      this._asegurarSeguridad(frenteId);
    } else {
      frenteId = frentePrincipal; // cisternas pueden ubicarse directamente en el frente/corner sin generar subdivisión de ataque
    }
    mov.estado = 'asignado';
    mov.ubicacionFrente = frenteId;
    this.log(mov.tipo === 'cisterna' ? 'cisterna' : 'movil', `${mov.tipo === 'cisterna' ? 'Cisterna' : 'Móvil'} asignado`, `${mov.tipo === 'cisterna' ? 'Cisterna' : 'Móvil'} ${mov.numero}`, '', frenteId);
    this.touch();
    return frenteId;
  },

  moverMovil(movilId, nuevoFrentePrincipal) {
    const mov = state.moviles.find(m => m.id === movilId);
    if (!mov) return;
    const origen = mov.ubicacionFrente;
    if (mov.tipo === 'ataque') {
      const sub = this._proximaSubdivision(nuevoFrentePrincipal);
      mov.ubicacionFrente = sub.id;
      this._asegurarSeguridad(sub.id);
      this._revisarDesaparicionSeguridad(origen);
    } else {
      mov.ubicacionFrente = nuevoFrentePrincipal;
    }
    this.log(mov.tipo === 'cisterna' ? 'cisterna' : 'movil', `${mov.tipo === 'cisterna' ? 'Cisterna' : 'Móvil'} trasladado`, `${mov.tipo === 'cisterna' ? 'Cisterna' : 'Móvil'} ${mov.numero}`, `De ${origen || 'Disponibles'} a ${mov.ubicacionFrente}`, mov.ubicacionFrente);
    this.touch();
  },

  _revisarDesaparicionSeguridad(frenteId) {
    if (!frenteId) return;
    const quedan = state.moviles.some(m => m.tipo === 'ataque' && m.ubicacionFrente === frenteId && m.estado === 'asignado');
    if (!quedan) {
      const seg = state.seguridad.find(s => s.frenteId === frenteId);
      if (seg && seg.visible) {
        seg.visible = false;
        this.log('seguridad', 'Seguridad retirada (frente sin móviles)', `Frente ${frenteId}`, '', frenteId);
      }
    }
  },

  lineasActivasDeMovil(movilId) {
    return state.lineas.filter(l => l.movilId === movilId && l.estado === 'activa');
  },

  retirarMovilDelTablero(movilId, opcion) {
    // opcion: 'dejar_lineas' | 'retirar_todo' (solo si tiene líneas), o null si no tiene líneas
    const mov = state.moviles.find(m => m.id === movilId);
    if (!mov) return;
    const origen = mov.ubicacionFrente;
    const lineas = this.lineasActivasDeMovil(movilId);
    if (lineas.length > 0 && opcion === 'retirar_todo') {
      lineas.forEach(l => this.retirarLinea(l.id, /*silencioso*/ true));
    }
    mov.estado = 'disponible';
    mov.ubicacionFrente = null;
    if (mov.tipo === 'cisterna' && mov.movilAsociado) {
      // asociación se mantiene lógicamente, solo se mueve
    }
    this._revisarDesaparicionSeguridad(origen);
    this.log(mov.tipo === 'cisterna' ? 'cisterna' : 'movil', `${mov.tipo === 'cisterna' ? 'Cisterna' : 'Móvil'} retirado del tablero`, `${mov.tipo === 'cisterna' ? 'Cisterna' : 'Móvil'} ${mov.numero}`, lineas.length ? `Líneas: ${opcion === 'dejar_lineas' ? 'quedaron desplegadas' : 'retiradas'}` : '', origen || '');
    this.touch();
  },

  retirarMovilDelIncidente(movilId) {
    const mov = state.moviles.find(m => m.id === movilId);
    if (!mov) return;
    const origen = mov.ubicacionFrente;
    this.lineasActivasDeMovil(movilId).forEach(l => this.retirarLinea(l.id, true));
    if (mov.tipo === 'cisterna' && mov.movilAsociado) this.desasociarCisterna(mov.id, true);
    if (mov.tipo === 'ataque' && mov.cisternaAsociada) this.desasociarCisterna(mov.cisternaAsociada, true);
    mov.estado = 'retirado';
    mov.ubicacionFrente = null;
    this._revisarDesaparicionSeguridad(origen);
    this.log(mov.tipo === 'cisterna' ? 'cisterna' : 'movil', `${mov.tipo === 'cisterna' ? 'Cisterna' : 'Móvil'} retirado del incidente`, `${mov.tipo === 'cisterna' ? 'Cisterna' : 'Móvil'} ${mov.numero}`, '', origen || '');
    this.touch();
  },

  // ================= CISTERNAS =================
  asociarCisterna(cisternaId, movilId) {
    const cist = state.moviles.find(m => m.id === cisternaId);
    const mov = state.moviles.find(m => m.id === movilId);
    if (!cist || !mov) return;
    cist.movilAsociado = movilId;
    mov.cisternaAsociada = cisternaId;
    this.log('cisterna', 'Cisterna asociada a móvil', `Cisterna ${cist.numero}`, `Móvil ${mov.numero}`, '');
    this.touch();
  },

  desasociarCisterna(cisternaId, silencioso) {
    const cist = state.moviles.find(m => m.id === cisternaId);
    if (!cist || !cist.movilAsociado) return;
    const mov = state.moviles.find(m => m.id === cist.movilAsociado);
    if (mov) mov.cisternaAsociada = null;
    cist.movilAsociado = null;
    if (!silencioso) this.log('cisterna', 'Asociación de cisterna eliminada', `Cisterna ${cist.numero}`, '', '');
    this.touch();
  },

  aguaDisponibleLitros() {
    return state.moviles
      .filter(m => m.tipo === 'cisterna' && m.estado !== 'retirado')
      .reduce((sum, m) => sum + (Number(m.capacidadLitros) || 0), 0);
  },

  // ================= LÍNEAS =================
  crearLinea(movilId) {
    const mov = state.moviles.find(m => m.id === movilId);
    if (!mov) return null;
    const existentes = state.lineas.filter(l => l.movilId === movilId);
    const numero = `${mov.numero}-${existentes.length + 1}`;
    const id = uid('lin');
    state.lineas.push({ id, numero, movilId, frenteId: mov.ubicacionFrente, grupoId: null, estado: 'activa' });
    this.log('linea', 'Línea creada', `Línea ${numero}`, `Móvil ${mov.numero}`, mov.ubicacionFrente || '');
    this.touch();
    return id;
  },

  moverLinea(lineaId, nuevoFrenteId) {
    const l = state.lineas.find(x => x.id === lineaId);
    if (!l) return;
    const origen = l.frenteId;
    l.frenteId = nuevoFrenteId;
    this.log('linea', 'Línea trasladada', `Línea ${l.numero}`, `De ${origen} a ${nuevoFrenteId}`, nuevoFrenteId);
    this.touch();
  },

  retirarLinea(lineaId, silencioso) {
    const l = state.lineas.find(x => x.id === lineaId);
    if (!l) return;
    l.estado = 'retirada';
    if (l.grupoId) {
      this.enviarGrupoADescanso(l.grupoId, true);
      l.grupoId = null;
    }
    if (!silencioso) this.log('linea', 'Línea retirada', `Línea ${l.numero}`, '', l.frenteId || '');
    this.touch();
  },

  // ================= GRUPOS =================
  crearGrupo({ encargado, personas }) {
    const id = uid('grp');
    state.grupos.push({ id, encargado, personas: Number(personas || 0), lineasIds: [], estado: 'trabajando' });
    this.registrarNombreConocido(encargado);
    this.guardarNombrePilarPermanente(encargado);
    this.log('grupo', 'Grupo creado', `${encargado} — ${personas} personas`, '', '');
    this.touch();
    return id;
  },

  asignarGrupoALinea(grupoId, lineaId) {
    const g = state.grupos.find(x => x.id === grupoId);
    const l = state.lineas.find(x => x.id === lineaId);
    if (!g || !l) return { ok: false, error: 'no_encontrado' };
    if (g.lineasIds.length >= 2 && !g.lineasIds.includes(lineaId)) {
      return { ok: false, error: 'max_lineas' };
    }
    if (l.grupoId && l.grupoId !== grupoId) {
      const anterior = state.grupos.find(x => x.id === l.grupoId);
      if (anterior) anterior.lineasIds = anterior.lineasIds.filter(id => id !== lineaId);
    }
    l.grupoId = grupoId;
    if (!g.lineasIds.includes(lineaId)) g.lineasIds.push(lineaId);
    g.estado = 'trabajando';
    this.log('grupo', 'Grupo asignado a línea', g.encargado, `Línea ${l.numero}`, l.frenteId || '');
    this.touch();
    return { ok: true };
  },

  enviarGrupoADescanso(grupoId, silencioso) {
    const g = state.grupos.find(x => x.id === grupoId);
    if (!g) return;
    g.lineasIds.forEach(lid => {
      const l = state.lineas.find(x => x.id === lid);
      if (l && l.grupoId === grupoId) l.grupoId = null;
    });
    g.lineasIds = [];
    g.estado = 'descanso';
    if (!silencioso) this.log('personal', 'Grupo enviado a descanso', g.encargado, '', '');
    this.touch();
  },

  crearNuevoGrupoDesdeDescanso(grupoAnteriorId, personasNuevas) {
    const anterior = state.grupos.find(x => x.id === grupoAnteriorId);
    if (!anterior) return null;
    anterior.estado = 'cerrado';
    const id = uid('grp');
    state.grupos.push({ id, encargado: anterior.encargado, personas: Number(personasNuevas), lineasIds: [], estado: 'trabajando' });
    this.log('grupo', 'Nuevo grupo creado', `${anterior.encargado} — ${personasNuevas} personas`, 'Reemplaza grupo anterior', '');
    this.touch();
    return id;
  },

  // ================= SEGURIDAD =================
  asignarSeguridad(frenteId, oficial) {
    const seg = this._asegurarSeguridad(frenteId);
    const previo = seg.oficial;
    seg.oficial = oficial;
    this.registrarNombreConocido(oficial);
    this.guardarNombrePilarPermanente(oficial);
    this.log('seguridad', previo ? 'Oficial de Seguridad reemplazado' : 'Oficial de Seguridad asignado', oficial, `Frente ${frenteId}`, frenteId);
    this.touch();
  },

  enviarSeguridadADescanso(frenteId) {
    const seg = state.seguridad.find(s => s.frenteId === frenteId);
    if (!seg || !seg.oficial) return;
    this.log('personal', 'Oficial de Seguridad enviado a descanso', seg.oficial, `Frente ${frenteId}`, frenteId);
    seg.oficial = null;
    this.touch();
  },

  // ================= INSTANTÁNEAS (evolución táctica) =================
  snapshot(etiqueta) {
    const resumen = {
      movilesAsignados: state.moviles.filter(m => m.estado === 'asignado').length,
      lineasActivas: state.lineas.filter(l => l.estado === 'activa').length,
      gruposTrabajando: state.grupos.filter(g => g.estado === 'trabajando').length,
      aguaLitros: this.aguaDisponibleLitros()
    };
    state.instantaneas.push({ id: uid('snap'), etiqueta, hora: nowStr(), resumen });
  },

  // ================= INFORME =================
  generarInforme() {
    const inc = state.incidente;
    const cuartelesPresentes = [inc.cuartelBase, ...state.refuerzos.map(r => r.cuartel)];
    const inicio = new Date(inc.fechaHoraInicio);
    const fin = inc.fechaHoraFin ? new Date(inc.fechaHoraFin) : new Date();
    const duracionMin = Math.max(0, Math.round((fin - inicio) / 60000));
    const sectoresUtilizados = [...new Set(state.subdivisiones.map(s => s.frente))];
    return {
      resumen: {
        nombre: inc.nombre, lugar: inc.lugar,
        fechaHoraInicio: inc.fechaHoraInicio, fechaHoraFin: inc.fechaHoraFin,
        duracionMin, comandante: inc.comandante,
        cuartelesPresentes,
        personalMaximoPresente: state.personal.totalPresente + state.refuerzos.reduce((s, r) => s + r.personal, 0),
        totalMoviles: state.moviles.length,
        totalCisternas: state.moviles.filter(m => m.tipo === 'cisterna').length,
        capacidadTotalAgua: this.aguaDisponibleLitros(),
        sectoresUtilizados
      },
      cronologia: state.historial,
      lineas: state.lineas,
      grupos: state.grupos,
      seguridad: state.seguridad,
      refuerzos: state.refuerzos,
      recursosRetirados: state.moviles.filter(m => m.estado === 'retirado'),
      instantaneas: state.instantaneas,
      subdivisiones: state.subdivisiones
    };
  }
};
