// app.js — Interfaz: arranque/recuperación, navegación, modales, render de vistas y acciones.

let currentView = 'tablero';
let historyFilter = 'todos';
let historySearch = '';

// ---------------- Utilidades UI ----------------
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function qs(sel, root) { return (root || document).querySelector(sel); }
function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function toast(msg) {
  const t = qs('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

let modalStack = [];
function openModal(innerHtml, opts) {
  opts = opts || {};
  const backdrop = el(`<div class="modal-backdrop"><div class="modal">${innerHtml}</div></div>`);
  document.getElementById('modalRoot').appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop && opts.dismissable !== false) closeModal(); });
  modalStack.push(backdrop);
  if (opts.onMount) opts.onMount(backdrop);
  return backdrop;
}
function closeModal() {
  const b = modalStack.pop();
  if (b) b.remove();
}
function closeAllModals() {
  while (modalStack.length) closeModal();
}

function confirmDialog({ title, body, warnBody, confirmLabel, danger, onConfirm }) {
  const html = `
    <h2>${esc(title)}</h2>
    ${body ? `<div class="sub">${body}</div>` : ''}
    ${warnBody ? `<div class="warn-box">${warnBody}</div>` : ''}
    <div class="btn-row">
      <button class="btn" data-x="cancel">Cancelar</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-x="ok">${esc(confirmLabel || 'Confirmar')}</button>
    </div>`;
  const m = openModal(html);
  qs('[data-x="cancel"]', m).onclick = closeModal;
  qs('[data-x="ok"]', m).onclick = () => { closeModal(); onConfirm(); };
}

// ---------------- Arranque ----------------
async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  Store.init(showSaved, onStateChanged);

  const storedMeta = await DB.getMeta();
  Store.setMeta(storedMeta || { cuartel: CUARTEL_BASE_NOMBRE, nombresPilarPermanentes: [] });

  const active = await DB.getActiveIncident();
  if (active && active.incidente && !active.incidente.finalizado) {
    renderGateRecovery(active);
  } else {
    renderGateCrear();
  }
}

function renderGateRecovery(active) {
  const card = qs('#gateCard');
  card.innerHTML = `
    <div class="gate-mark">PUESTO DE COMANDO</div>
    <h1>Incidente activo encontrado</h1>
    <p>${esc(active.incidente.nombre)} — ${esc(active.incidente.lugar || '')}</p>
    <div class="btn-row" style="margin-top:24px;">
      <button class="btn btn-ghost" id="btnNuevo">Crear nuevo incidente</button>
      <button class="btn btn-primary" id="btnContinuar">Continuar incidente</button>
    </div>
  `;
  qs('#btnContinuar').onclick = () => {
    Store.setState(active);
    startApp();
  };
  qs('#btnNuevo').onclick = () => {
    confirmDialog({
      title: '¿Crear un nuevo incidente?',
      warnBody: 'El incidente activo actual quedará guardado, pero dejará de mostrarse como incidente en curso hasta que lo retomes manualmente desde el archivo.',
      confirmLabel: 'Crear nuevo',
      danger: true,
      onConfirm: renderGateCrear
    });
  };
}

function renderGateCrear() {
  const card = qs('#gateCard');
  const meta = Store.getMeta();
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  card.innerHTML = `
    <div class="gate-mark">${esc(meta.cuartel || CUARTEL_BASE_NOMBRE)}</div>
    <h1>Nuevo incidente</h1>
    <p>Cargá solo los datos esenciales. El resto se completa durante el operativo.</p>
    <label>Nombre / identificación</label>
    <input type="text" id="fNombre" placeholder="Ej. Incendio Ruta 8 km 52">
    <label>Dirección / lugar</label>
    <input type="text" id="fLugar" placeholder="Ej. Ruta 8 km 52, Pilar">
    <label>Fecha y hora de inicio</label>
    <input type="datetime-local" id="fFecha" value="${nowLocal}">
    <label>Comandante del incidente</label>
    <input type="text" id="fComandante" placeholder="Nombre del comandante">
    <div class="btn-row">
      <button class="btn btn-primary btn-block" id="btnCrear">Crear incidente</button>
    </div>
  `;
  qs('#btnCrear').onclick = () => {
    const nombre = qs('#fNombre').value.trim();
    if (!nombre) { toast('Ingresá un nombre para el incidente'); return; }
    Store.crearIncidente({
      nombre,
      lugar: qs('#fLugar').value.trim(),
      fechaHoraInicio: qs('#fFecha').value || new Date().toISOString(),
      comandante: qs('#fComandante').value.trim()
    });
    startApp();
  };
}

function startApp() {
  qs('#gate').style.display = 'none';
  qs('#appShell').classList.add('visible');
  qsa('.nav-btn').forEach(b => b.onclick = () => switchView(b.dataset.view));
  qs('#fabAdd').onclick = onFabClick;
  switchView('tablero');
  renderTopbar();
  renderAll();
}

function onStateChanged() {
  renderTopbar();
  if (currentView === 'tablero') renderTablero();
  else if (currentView === 'recursos') renderRecursos();
  else if (currentView === 'historial') renderHistorial();
}
function showSaved() {
  const ind = qs('#saveIndicator');
  ind.classList.add('show');
  clearTimeout(showSaved._t);
  showSaved._t = setTimeout(() => ind.classList.remove('show'), 1400);
}

function renderTopbar() {
  const s = Store.getState();
  qs('#topIncidentName').textContent = s.incidente ? s.incidente.nombre : '—';
  qs('#topCuartel').textContent = s.incidente ? s.incidente.cuartelBase : '—';
  qs('#waterChip').textContent = `💧 ${Store.aguaDisponibleLitros().toLocaleString('es-AR')} L`;
}

function switchView(view) {
  currentView = view;
  qsa('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  qsa('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  qs('#fabAdd').style.display = (view === 'tablero' || view === 'recursos') ? 'flex' : 'none';
  renderAll();
}

function renderAll() {
  renderTablero();
  renderRecursos();
  renderHistorial();
  renderInforme();
  renderTopbar();
}

// ================= TABLERO =================
function tagsParaFrente(frenteId) {
  const s = Store.getState();
  let html = '';
  const moviles = s.moviles.filter(m => m.estado === 'asignado' && m.ubicacionFrente === frenteId);
  const seg = s.seguridad.find(x => x.frenteId === frenteId && x.visible);
  if (seg) {
    html += seg.oficial
      ? `<button class="tag tag-seguridad-ok" data-open-seguridad="${seg.frenteId}">🛡️ ${esc(seg.oficial)}</button>`
      : `<button class="tag tag-seguridad-warn" data-open-seguridad="${seg.frenteId}">⚠️ SEGURIDAD SIN ASIGNAR</button>`;
  }
  moviles.forEach(m => {
    const label = m.tipo === 'ataque' ? `MÓVIL ${m.numero}` : `CISTERNA ${m.numero}`;
    html += `<button class="tag ${m.tipo === 'ataque' ? 'tag-ataque' : 'tag-cisterna'}" data-open-movil="${m.id}">${esc(label)}</button>`;
    Store.lineasActivasDeMovil(m.id).forEach(l => {
      const g = l.grupoId ? s.grupos.find(x => x.id === l.grupoId) : null;
      html += `<button class="tag tag-linea" data-open-linea="${l.id}">LÍNEA ${esc(l.numero)}${g ? ' · ' + esc(g.encargado) : ''}</button>`;
    });
  });
  return html;
}

function renderTablero() {
  const s = Store.getState();
  if (!s.incidente) return;
  const view = qs('#view-tablero');
  const disponibles = s.moviles.filter(m => m.estado === 'disponible');
  const descanso = s.grupos.filter(g => g.estado === 'descanso');

  view.innerHTML = `
    <div class="board-wrap">
      <div class="board-grid">
        <div class="corner corner-AB"><span class="frente-label">AB</span><div class="frente-tags">${tagsParaFrente('AB')}</div></div>
        <div class="edge edge-B"><span class="frente-label">B</span><div class="frente-tags">${tagsForMainFront(s, 'B')}</div></div>
        <div class="corner corner-BC"><span class="frente-label">BC</span><div class="frente-tags">${tagsParaFrente('BC')}</div></div>
        <div class="edge edge-D"><span class="frente-label">D</span><div class="frente-tags">${tagsForMainFront(s, 'D')}</div></div>
        <div class="interior"></div>
        <div class="edge edge-C"><span class="frente-label">C</span><div class="frente-tags">${tagsForMainFront(s, 'C')}</div></div>
        <div class="corner corner-DA"><span class="frente-label">DA</span><div class="frente-tags">${tagsParaFrente('DA')}</div></div>
        <div class="edge edge-A"><span class="frente-label">A</span><div class="frente-tags">${tagsForMainFront(s, 'A')}</div></div>
        <div class="corner corner-CD"><span class="frente-label">CD</span><div class="frente-tags">${tagsParaFrente('CD')}</div></div>
      </div>
      <div class="comando-label">▲ COMANDO (lado A)</div>

      <div class="section-title" style="align-self:flex-start; width:100%; max-width:640px;">Disponibles</div>
      <div class="card" style="width:100%; max-width:640px;">
        ${disponibles.length ? `<div class="disponibles-row">${disponibles.map(m => `
          <button class="tag ${m.tipo === 'ataque' ? 'tag-ataque' : 'tag-cisterna'}" data-open-movil="${m.id}">${m.tipo === 'ataque' ? 'MÓVIL' : 'CISTERNA'} ${esc(m.numero)}</button>
        `).join('')}</div>` : `<div class="empty-hint">No hay recursos disponibles sin asignar</div>`}
      </div>

      <div class="rest-strip">
        <div class="section-title">Área de descanso</div>
        <div class="disponibles-row">
          ${descanso.length ? descanso.map(g => `<button class="tag tag-grupo" data-open-grupo="${g.id}">${esc(g.encargado)}</button>`).join('') : '<span class="empty-hint" style="border:none;padding:0;">Sin grupos en descanso</span>'}
        </div>
      </div>
    </div>
  `;
  wireTablero(view);
}

function tagsForMainFront(s, frente) {
  // subdivisiones activas de ese frente principal + cisternas ubicadas directamente en el frente
  let html = '';
  const subs = s.subdivisiones.filter(sub => sub.frente === frente);
  subs.forEach(sub => { html += tagsParaFrente(sub.id); });
  html += tagsParaFrenteCisternasDirectas(s, frente);
  return html;
}
function tagsParaFrenteCisternasDirectas(s, frente) {
  return s.moviles.filter(m => m.tipo === 'cisterna' && m.estado === 'asignado' && m.ubicacionFrente === frente)
    .map(m => `<button class="tag tag-cisterna" data-open-movil="${m.id}">CISTERNA ${esc(m.numero)}</button>`).join('');
}

function wireTablero(view) {
  qsa('[data-open-movil]', view).forEach(b => b.onclick = () => openMovilModal(b.dataset.openMovil));
  qsa('[data-open-linea]', view).forEach(b => b.onclick = () => openLineaModal(b.dataset.openLinea));
  qsa('[data-open-seguridad]', view).forEach(b => b.onclick = () => openSeguridadModal(b.dataset.openSeguridad));
  qsa('[data-open-grupo]', view).forEach(b => b.onclick = () => openGrupoDescansoModal(b.dataset.openGrupo));
}

function frenteSelectorHtml(idPrefix, excluir) {
  return FRENTES_PRINCIPALES.map(f => `<button class="btn" data-frente="${f}" id="${idPrefix}-${f}">${f}</button>`).join('');
}

// ---- Modal: Móvil ----
function openMovilModal(movilId) {
  const s = Store.getState();
  const mov = s.moviles.find(m => m.id === movilId);
  if (!mov) return;
  const lineas = Store.lineasActivasDeMovil(mov.id);
  const cist = mov.tipo === 'ataque' && mov.cisternaAsociada ? s.moviles.find(m => m.id === mov.cisternaAsociada) : null;
  const movAsoc = mov.tipo === 'cisterna' && mov.movilAsociado ? s.moviles.find(m => m.id === mov.movilAsociado) : null;

  const html = `
    <h2>${mov.tipo === 'ataque' ? 'MÓVIL' : 'CISTERNA'} ${esc(mov.numero)}</h2>
    <div class="sub">${mov.tipo === 'ataque' ? 'Ataque' : 'Cisterna'} · Personal: ${esc(mov.personal)} · Estado: ${estadoLabel(mov.estado)}</div>
    ${mov.tipo === 'cisterna' ? `<div class="modal-row"><span class="k">Capacidad</span><span>${Number(mov.capacidadLitros || 0).toLocaleString('es-AR')} L</span></div>` : ''}
    ${mov.ubicacionFrente ? `<div class="modal-row"><span class="k">Ubicación</span><span>${esc(mov.ubicacionFrente)}</span></div>` : ''}
    ${cist ? `<div class="modal-row"><span class="k">Cisterna asociada</span><span>Cisterna ${esc(cist.numero)}</span></div>` : ''}
    ${movAsoc ? `<div class="modal-row"><span class="k">Asociada a</span><span>Móvil ${esc(movAsoc.numero)}</span></div>` : ''}
    ${lineas.length ? `<div class="modal-row"><span class="k">Líneas</span><span>${lineas.map(l => l.numero).join(', ')}</span></div>` : ''}
    <div id="movilBody"></div>
    <div class="btn-row" style="flex-wrap:wrap;">
      <button class="btn" id="mvMover">Mover</button>
      ${mov.tipo === 'ataque' ? `<button class="btn" id="mvLinea">Crear línea</button>` : ''}
      ${mov.tipo === 'cisterna' && !mov.movilAsociado ? `<button class="btn" id="mvAsociar">Asociar a móvil</button>` : ''}
      ${mov.tipo === 'cisterna' && mov.movilAsociado ? `<button class="btn" id="mvDesasociar">Desasociar</button>` : ''}
    </div>
    <div class="btn-row">
      ${mov.estado === 'asignado' ? `<button class="btn btn-danger" id="mvRetirarTablero">Retirar del tablero</button>` : ''}
      <button class="btn btn-danger" id="mvRetirarIncidente">Retirar del incidente</button>
    </div>
  `;
  const m = openModal(html);

  qs('#mvMover', m).onclick = () => {
    qs('#movilBody', m).innerHTML = `<div class="section-title">Elegí el frente destino</div><div class="disponibles-row">${frenteSelectorHtml('destMov')}</div>`;
    FRENTES_PRINCIPALES.forEach(f => {
      qs(`#destMov-${f}`, m).onclick = () => {
        if (mov.tipo === 'cisterna' && mov.movilAsociado) {
          const asociado = s.moviles.find(x => x.id === mov.movilAsociado);
          closeModal();
          confirmDialog({
            title: `Cisterna ${mov.numero} asociada`,
            warnBody: `⚠️ La Cisterna ${esc(mov.numero)} está asociada al Móvil ${esc(asociado ? asociado.numero : '')}.<br>¿Mover igualmente?`,
            confirmLabel: 'Mover',
            onConfirm: () => { doMoverMovil(mov, f); }
          });
        } else {
          doMoverMovil(mov, f);
          closeModal();
        }
      };
    });
  };

  if (mov.tipo === 'ataque') {
    qs('#mvLinea', m).onclick = () => {
      if (mov.estado !== 'asignado') { toast('Asigná el móvil a un frente antes de crear una línea'); return; }
      Store.crearLinea(mov.id);
      closeModal();
      toast('Línea creada');
    };
  }

  if (mov.tipo === 'cisterna' && !mov.movilAsociado) {
    qs('#mvAsociar', m).onclick = () => {
      const ataques = s.moviles.filter(x => x.tipo === 'ataque' && x.estado !== 'retirado' && !x.cisternaAsociada);
      qs('#movilBody', m).innerHTML = ataques.length
        ? `<div class="section-title">Asociar a móvil de ataque</div><div class="disponibles-row">${ataques.map(a => `<button class="btn" data-a="${a.id}">Móvil ${esc(a.numero)}</button>`).join('')}</div>`
        : `<div class="empty-hint">No hay móviles de ataque disponibles para asociar</div>`;
      ataques.forEach(a => {
        qs(`[data-a="${a.id}"]`, m).onclick = () => { Store.asociarCisterna(mov.id, a.id); closeModal(); toast('Cisterna asociada'); };
      });
    };
  }
  if (mov.tipo === 'cisterna' && mov.movilAsociado) {
    qs('#mvDesasociar', m).onclick = () => { Store.desasociarCisterna(mov.id); closeModal(); toast('Asociación eliminada'); };
  }

  if (mov.estado === 'asignado') {
    qs('#mvRetirarTablero', m).onclick = () => {
      const lns = Store.lineasActivasDeMovil(mov.id);
      if (lns.length === 0) {
        closeModal();
        Store.retirarMovilDelTablero(mov.id, null);
        toast('Retirado del tablero');
      } else {
        closeModal();
        openModal(`
          <h2>${esc(mov.tipo === 'ataque' ? 'Móvil' : 'Cisterna')} ${esc(mov.numero)} tiene ${lns.length} línea(s) desplegada(s)</h2>
          <div class="sub">¿Qué desea hacer?</div>
          <div class="btn-row" style="flex-direction:column;">
            <button class="btn btn-block" id="optDejar">Dejar las líneas desplegadas</button>
            <button class="btn btn-danger btn-block" id="optTodo">Retirar todo</button>
            <button class="btn btn-ghost btn-block" id="optCancelar">Cancelar</button>
          </div>
        `, {
          onMount: (mm) => {
            qs('#optDejar', mm).onclick = () => { closeModal(); Store.retirarMovilDelTablero(mov.id, 'dejar_lineas'); toast('Móvil retirado; líneas quedaron desplegadas'); };
            qs('#optTodo', mm).onclick = () => { closeModal(); Store.retirarMovilDelTablero(mov.id, 'retirar_todo'); toast('Móvil y líneas retirados'); };
            qs('#optCancelar', mm).onclick = closeModal;
          }
        });
      }
    };
  }

  qs('#mvRetirarIncidente', m).onclick = () => {
    closeModal();
    confirmDialog({
      title: `¿Retirar ${mov.tipo === 'ataque' ? 'Móvil' : 'Cisterna'} ${mov.numero} del incidente?`,
      warnBody: 'Esta acción retira el recurso definitivamente. Quedará registrado en el historial.',
      confirmLabel: 'Retirar del incidente',
      danger: true,
      onConfirm: () => { Store.retirarMovilDelIncidente(mov.id); toast('Retirado del incidente'); }
    });
  };
}

function doMoverMovil(mov, frente) {
  if (mov.estado === 'disponible') Store.asignarMovilAFrente(mov.id, frente);
  else Store.moverMovil(mov.id, frente);
}

function estadoLabel(e) {
  return { disponible: 'Disponible', asignado: 'Asignado', retirado: 'Retirado del incidente' }[e] || e;
}

// ---- Modal: Línea ----
function openLineaModal(lineaId) {
  const s = Store.getState();
  const l = s.lineas.find(x => x.id === lineaId);
  if (!l) return;
  const mov = s.moviles.find(m => m.id === l.movilId);
  const grupo = l.grupoId ? s.grupos.find(g => g.id === l.grupoId) : null;
  const html = `
    <h2>LÍNEA ${esc(l.numero)}</h2>
    <div class="modal-row"><span class="k">Móvil de origen</span><span>${mov ? esc(mov.numero) : '—'}</span></div>
    <div class="modal-row"><span class="k">Frente</span><span>${esc(l.frenteId || '—')}</span></div>
    <div class="modal-row"><span class="k">Grupo asignado</span><span>${grupo ? `${esc(grupo.encargado)} — ${grupo.personas}` : 'Sin asignar'}</span></div>
    <div id="lineaBody"></div>
    <div class="btn-row" style="flex-wrap:wrap;">
      <button class="btn" id="lnMover">Mover</button>
      <button class="btn" id="lnGrupo">${grupo ? 'Reemplazar grupo' : 'Asignar grupo'}</button>
    </div>
    <div class="btn-row"><button class="btn btn-danger btn-block" id="lnRetirar">Retirar línea</button></div>
  `;
  const m = openModal(html);
  qs('#lnMover', m).onclick = () => {
    qs('#lineaBody', m).innerHTML = `<div class="section-title">Elegí el frente destino</div><div class="disponibles-row">${frenteSelectorHtml('destLin')}</div>`;
    FRENTES_PRINCIPALES.forEach(f => {
      qs(`#destLin-${f}`, m).onclick = () => { Store.moverLinea(l.id, f); closeModal(); toast('Línea trasladada'); };
    });
  };
  qs('#lnGrupo', m).onclick = () => {
    const disponibles = s.grupos.filter(g => g.estado === 'trabajando' && g.lineasIds.length < 2 || g.id === l.grupoId);
    qs('#lineaBody', m).innerHTML = disponibles.length
      ? `<div class="section-title">Elegí un grupo</div><div class="disponibles-row">${disponibles.map(g => `<button class="btn" data-g="${g.id}">${esc(g.encargado)} (${g.personas})</button>`).join('')}</div>`
      : `<div class="empty-hint">No hay grupos disponibles. Creá uno desde Recursos.</div>`;
    disponibles.forEach(g => {
      qs(`[data-g="${g.id}"]`, m).onclick = () => {
        const r = Store.asignarGrupoALinea(g.id, l.id);
        if (!r.ok) { toast('Ese grupo ya tiene 2 líneas asignadas'); return; }
        closeModal(); toast('Grupo asignado');
      };
    });
  };
  qs('#lnRetirar', m).onclick = () => {
    closeModal();
    if (grupo) {
      confirmDialog({
        title: `La Línea ${l.numero} tiene asignado a ${grupo.encargado}`,
        warnBody: `Al retirar la línea, ${esc(grupo.encargado)} será enviado a descanso.`,
        confirmLabel: 'Retirar línea',
        danger: true,
        onConfirm: () => { Store.retirarLinea(l.id); toast('Línea retirada'); }
      });
    } else {
      confirmDialog({
        title: `¿Retirar la Línea ${l.numero}?`,
        confirmLabel: 'Retirar línea',
        danger: true,
        onConfirm: () => { Store.retirarLinea(l.id); toast('Línea retirada'); }
      });
    }
  };
}

// ---- Modal: Seguridad ----
function openSeguridadModal(frenteId) {
  const s = Store.getState();
  const seg = s.seguridad.find(x => x.frenteId === frenteId);
  const html = `
    <h2>SEGURIDAD — ${esc(frenteId)}</h2>
    <div class="sub">${seg && seg.oficial ? `Oficial: ${esc(seg.oficial)}` : 'Sin oficial asignado'}</div>
    <label>Nombre del oficial de seguridad</label>
    <input type="text" id="segNombre" list="nombresConocidos" value="${seg && seg.oficial ? esc(seg.oficial) : ''}" placeholder="Nombre y apellido">
    ${nombresDatalist()}
    <div class="btn-row">
      <button class="btn btn-primary btn-block" id="segGuardar">${seg && seg.oficial ? 'Reemplazar' : 'Asignar'}</button>
    </div>
    ${seg && seg.oficial ? `<div class="btn-row"><button class="btn btn-ghost btn-block" id="segDescanso">Enviar a descanso</button></div>` : ''}
  `;
  const m = openModal(html);
  qs('#segGuardar', m).onclick = () => {
    const nombre = qs('#segNombre', m).value.trim();
    if (!nombre) { toast('Ingresá un nombre'); return; }
    const previo = seg && seg.oficial;
    if (previo) {
      closeModal();
      confirmDialog({
        title: `${esc(previo)} será reemplazado como Oficial de Seguridad`,
        warnBody: 'Se recomienda enviarlo a descanso.',
        confirmLabel: 'Confirmar reemplazo',
        onConfirm: () => { Store.asignarSeguridad(frenteId, nombre); toast('Oficial reemplazado'); }
      });
    } else {
      Store.asignarSeguridad(frenteId, nombre);
      closeModal();
      toast('Oficial asignado');
    }
  };
  if (seg && seg.oficial) {
    qs('#segDescanso', m).onclick = () => { Store.enviarSeguridadADescanso(frenteId); closeModal(); toast('Enviado a descanso'); };
  }
}

// ---- Modal: Grupo en descanso ----
function openGrupoDescansoModal(grupoId) {
  const s = Store.getState();
  const g = s.grupos.find(x => x.id === grupoId);
  if (!g) return;
  const html = `
    <h2>${esc(g.encargado)}</h2>
    <div class="sub">${g.personas} personas · Estado: Descanso</div>
    <div class="btn-row"><button class="btn btn-primary btn-block" id="grNuevo">Crear nuevo grupo</button></div>
  `;
  const m = openModal(html);
  qs('#grNuevo', m).onclick = () => {
    openModal(`
      <h2>Nuevo grupo</h2>
      <label>Encargado</label>
      <input type="text" id="ngEncargado" value="${esc(g.encargado)}" disabled>
      <label>Personas</label>
      <input type="number" id="ngPersonas" min="1" value="${g.personas}">
      <div class="btn-row"><button class="btn btn-primary btn-block" id="ngCrear">Crear grupo</button></div>
    `, {
      onMount: (mm) => {
        qs('#ngCrear', mm).onclick = () => {
          const n = Number(qs('#ngPersonas', mm).value || 0);
          if (n <= 0) { toast('Ingresá una cantidad válida'); return; }
          Store.crearNuevoGrupoDesdeDescanso(g.id, n);
          closeAllModals();
          toast('Grupo creado');
        };
      }
    });
  };
}

function nombresDatalist() {
  const s = Store.getState();
  const meta = Store.getMeta();
  const nombres = [...new Set([...(meta.nombresPilarPermanentes || []), ...(s.personal.nombresConocidos || [])])];
  return `<datalist id="nombresConocidos">${nombres.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
}

// ================= RECURSOS =================
function renderRecursos() {
  const s = Store.getState();
  if (!s.incidente) return;
  const view = qs('#view-recursos');
  const refuerzosActivos = s.refuerzos.filter(r => r.estado === 'activo');
  const ataques = s.moviles.filter(m => m.tipo === 'ataque' && m.estado !== 'retirado');
  const cisternas = s.moviles.filter(m => m.tipo === 'cisterna' && m.estado !== 'retirado');
  const grupos = s.grupos.filter(g => g.estado !== 'cerrado');

  view.innerHTML = `
    <div class="section-title">Personal</div>
    <div class="card">
      <div class="modal-row"><span class="k">Personal de ${esc(s.incidente.cuartelBase)} presente</span><span>${s.personal.totalPresente}</span></div>
      <div class="btn-row"><button class="btn btn-block" id="editarPersonal">Editar cantidad</button></div>
    </div>

    <div class="section-title">Refuerzos</div>
    ${refuerzosActivos.length ? refuerzosActivos.map(r => `
      <div class="res-item">
        <div>
          <div class="main">${esc(r.cuartel)}</div>
          <div class="sub">Personal: ${r.personal}${r.encargado ? ' · Encargado: ' + esc(r.encargado) : ''}</div>
        </div>
        <button class="btn btn-ghost" data-ref-retirar="${r.id}">Retirar</button>
      </div>
    `).join('') : `<div class="empty-hint">Sin refuerzos incorporados</div>`}

    <div class="section-title">Móviles de ataque</div>
    ${ataques.length ? ataques.map(m => resourceRow(m)).join('') : `<div class="empty-hint">Sin móviles de ataque</div>`}

    <div class="section-title">Cisternas</div>
    ${cisternas.length ? cisternas.map(m => resourceRow(m)).join('') : `<div class="empty-hint">Sin cisternas</div>`}

    <div class="section-title">Grupos</div>
    ${grupos.length ? grupos.map(g => `
      <div class="res-item">
        <div>
          <div class="main">${esc(g.encargado)}</div>
          <div class="sub">${g.personas} personas · Líneas: ${g.lineasIds.length ? g.lineasIds.map(id => (s.lineas.find(l => l.id === id) || {}).numero).join(', ') : '—'}</div>
        </div>
        <span class="state-pill state-${g.estado === 'trabajando' ? 'asignado' : 'descanso'}">${g.estado === 'trabajando' ? 'Trabajando' : 'Descanso'}</span>
      </div>
    `).join('') : `<div class="empty-hint">Sin grupos creados</div>`}
  `;

  qs('#editarPersonal', view).onclick = openEditarPersonalModal;
  qsa('[data-ref-retirar]', view).forEach(b => b.onclick = () => openRetirarRefuerzoModal(b.dataset.refRetirar));
  qsa('[data-open-movil]', view).forEach(b => b.onclick = () => openMovilModal(b.dataset.openMovil));
}

function resourceRow(m) {
  const label = m.tipo === 'ataque' ? `MÓVIL ${m.numero}` : `CISTERNA ${m.numero}`;
  const extra = m.tipo === 'cisterna' ? ` · ${Number(m.capacidadLitros || 0).toLocaleString('es-AR')} L` : '';
  return `
    <div class="res-item" data-open-movil="${m.id}" style="cursor:pointer;">
      <div>
        <div class="main">${esc(label)}</div>
        <div class="sub">Personal: ${m.personal}${extra}${m.ubicacionFrente ? ' · ' + esc(m.ubicacionFrente) : ''}</div>
      </div>
      <span class="state-pill state-${m.estado}">${estadoLabel(m.estado)}</span>
    </div>
  `;
}

function openEditarPersonalModal() {
  const s = Store.getState();
  const html = `
    <h2>Personal presente</h2>
    <label>Cantidad de personal de ${esc(s.incidente.cuartelBase)} presente</label>
    <input type="number" id="pCant" min="0" value="${s.personal.totalPresente}">
    <div class="btn-row"><button class="btn btn-primary btn-block" id="pGuardar">Guardar</button></div>
  `;
  const m = openModal(html);
  qs('#pGuardar', m).onclick = () => {
    Store.setPersonalPresente(Number(qs('#pCant', m).value || 0));
    closeModal();
  };
}

function openRetirarRefuerzoModal(refuerzoId) {
  const deps = Store.dependenciasDeRefuerzo(refuerzoId);
  const s = Store.getState();
  const ref = s.refuerzos.find(r => r.id === refuerzoId);
  if (deps.length > 0) {
    openModal(`
      <h2>${esc(ref.cuartel)} tiene recursos asignados</h2>
      <div class="warn-box">
        Debe resolver estas asignaciones antes de retirar el refuerzo:<br><br>
        ${deps.map(d => `• ${esc(d.label)}`).join('<br>')}
      </div>
      <div class="btn-row"><button class="btn btn-block" id="okDeps">Entendido</button></div>
    `, { onMount: (mm) => { qs('#okDeps', mm).onclick = closeModal; } });
    return;
  }
  confirmDialog({
    title: `¿Retirar el refuerzo de ${ref.cuartel}?`,
    warnBody: 'El personal y los móviles de este refuerzo se registrarán como retirados del incidente.',
    confirmLabel: 'Retirar refuerzo',
    danger: true,
    onConfirm: () => { Store.retirarRefuerzo(refuerzoId); toast('Refuerzo retirado'); }
  });
}

// ---- FAB: agregar recurso ----
function onFabClick() {
  const html = `
    <h2>Agregar</h2>
    <div class="btn-row" style="flex-direction:column;">
      <button class="btn btn-block" id="addMovilAtaque">🚒 Móvil de ataque</button>
      <button class="btn btn-block" id="addCisterna">💧 Cisterna</button>
      <button class="btn btn-block" id="addGrupo">👥 Grupo</button>
      <button class="btn btn-block" id="addRefuerzo">🏢 Refuerzo</button>
    </div>
  `;
  const m = openModal(html);
  qs('#addMovilAtaque', m).onclick = () => { closeModal(); openNuevoMovilModal('ataque'); };
  qs('#addCisterna', m).onclick = () => { closeModal(); openNuevoMovilModal('cisterna'); };
  qs('#addGrupo', m).onclick = () => { closeModal(); openNuevoGrupoModal(); };
  qs('#addRefuerzo', m).onclick = () => { closeModal(); openNuevoRefuerzoModal(); };
}

function openNuevoMovilModal(tipo) {
  const html = `
    <h2>Nuevo ${tipo === 'ataque' ? 'móvil de ataque' : 'cisterna'}</h2>
    <label>Número / identificador</label>
    <input type="text" id="mNumero" placeholder="Ej. 17">
    <label>Personal</label>
    <input type="number" id="mPersonal" min="0" value="0">
    ${tipo === 'cisterna' ? `<label>Capacidad (litros)</label><input type="number" id="mCapacidad" min="0" value="0">` : ''}
    <div class="btn-row"><button class="btn btn-primary btn-block" id="mCrear">Agregar</button></div>
  `;
  const m = openModal(html);
  qs('#mCrear', m).onclick = () => {
    const numero = qs('#mNumero', m).value.trim();
    if (!numero) { toast('Ingresá un número de identificación'); return; }
    Store.crearMovil({
      numero, tipo,
      personal: qs('#mPersonal', m).value,
      capacidadLitros: tipo === 'cisterna' ? qs('#mCapacidad', m).value : undefined
    });
    closeModal();
    toast('Recurso agregado a Disponibles');
  };
}

function openNuevoGrupoModal() {
  const html = `
    <h2>Nuevo grupo</h2>
    <label>Encargado</label>
    <input type="text" id="gEncargado" list="nombresConocidos" placeholder="Nombre y apellido">
    ${nombresDatalist()}
    <label>Cantidad de personas</label>
    <input type="number" id="gPersonas" min="1" value="1">
    <div class="btn-row"><button class="btn btn-primary btn-block" id="gCrear">Crear grupo</button></div>
  `;
  const m = openModal(html);
  qs('#gCrear', m).onclick = () => {
    const encargado = qs('#gEncargado', m).value.trim();
    if (!encargado) { toast('Ingresá el nombre del encargado'); return; }
    Store.crearGrupo({ encargado, personas: qs('#gPersonas', m).value });
    closeModal();
    toast('Grupo creado');
  };
}

function openNuevoRefuerzoModal() {
  let movilesTmp = [];
  const html = `
    <h2>Nuevo refuerzo</h2>
    <label>Cuartel</label>
    <input type="text" id="rCuartel" placeholder="Ej. BOMBEROS VOLUNTARIOS DE DERQUI">
    <label>Personal total</label>
    <input type="number" id="rPersonal" min="0" value="0">
    <label>Encargado / responsable (opcional)</label>
    <input type="text" id="rEncargado" placeholder="Nombre y apellido">
    <label>Personal sin móvil</label>
    <input type="number" id="rSinMovil" min="0" value="0">
    <div class="section-title">Móviles del refuerzo</div>
    <div id="refMovilesList" class="disponibles-row"></div>
    <div class="btn-row"><button class="btn" id="rAddMovil">+ Agregar móvil</button></div>
    <div class="btn-row"><button class="btn btn-primary btn-block" id="rCrear">Incorporar refuerzo</button></div>
  `;
  const m = openModal(html);
  function renderTmp() {
    qs('#refMovilesList', m).innerHTML = movilesTmp.map((mv, i) =>
      `<span class="tag ${mv.tipo === 'ataque' ? 'tag-ataque' : 'tag-cisterna'}">${mv.tipo === 'ataque' ? 'Ataque' : 'Cisterna'} ${esc(mv.numero)} — ${mv.personal}p</span>`
    ).join('') || '<span class="empty-hint" style="border:none;padding:0;">Ninguno agregado</span>';
  }
  renderTmp();
  qs('#rAddMovil', m).onclick = () => {
    openModal(`
      <h2>Móvil del refuerzo</h2>
      <label>Tipo</label>
      <select id="rmTipo"><option value="ataque">Ataque</option><option value="cisterna">Cisterna</option></select>
      <label>Número</label>
      <input type="text" id="rmNumero">
      <label>Personal</label>
      <input type="number" id="rmPersonal" min="0" value="0">
      <label id="rmCapLabel" style="display:none;">Capacidad (litros)</label>
      <input type="number" id="rmCapacidad" min="0" value="0" style="display:none;">
      <div class="btn-row"><button class="btn btn-primary btn-block" id="rmAgregar">Agregar</button></div>
    `, {
      onMount: (mm) => {
        qs('#rmTipo', mm).onchange = (e) => {
          const isC = e.target.value === 'cisterna';
          qs('#rmCapLabel', mm).style.display = isC ? 'block' : 'none';
          qs('#rmCapacidad', mm).style.display = isC ? 'block' : 'none';
        };
        qs('#rmAgregar', mm).onclick = () => {
          const numero = qs('#rmNumero', mm).value.trim();
          if (!numero) { toast('Ingresá un número'); return; }
          movilesTmp.push({
            tipo: qs('#rmTipo', mm).value, numero,
            personal: qs('#rmPersonal', mm).value,
            capacidadLitros: qs('#rmCapacidad', mm).value
          });
          closeModal();
          renderTmp();
        };
      }
    });
  };
  qs('#rCrear', m).onclick = () => {
    const cuartel = qs('#rCuartel', m).value.trim();
    if (!cuartel) { toast('Ingresá el nombre del cuartel'); return; }
    Store.agregarRefuerzo({
      cuartel, personal: qs('#rPersonal', m).value,
      encargado: qs('#rEncargado', m).value.trim(),
      moviles: movilesTmp,
      personalSinMovil: qs('#rSinMovil', m).value
    });
    closeModal();
    toast('Refuerzo incorporado');
  };
}

// ================= HISTORIAL =================
const HIST_FILTROS = [
  { id: 'todos', label: 'Todos' },
  { id: 'movil', label: 'Móviles' },
  { id: 'linea', label: 'Líneas' },
  { id: 'personal', label: 'Personal' },
  { id: 'seguridad', label: 'Seguridad' },
  { id: 'cisterna', label: 'Cisternas' }
];
function renderHistorial() {
  const s = Store.getState();
  if (!s.incidente) return;
  const view = qs('#view-historial');
  const eventos = [...s.historial].reverse().filter(ev => {
    if (historyFilter !== 'todos' && ev.categoria !== historyFilter) return false;
    if (historySearch && !(`${ev.accion} ${ev.recurso} ${ev.contexto}`.toLowerCase().includes(historySearch.toLowerCase()))) return false;
    return true;
  });
  view.innerHTML = `
    <input type="text" class="search-box" id="histSearch" placeholder="Buscar en el historial…" value="${esc(historySearch)}">
    <div class="hist-filters">${HIST_FILTROS.map(f => `<button class="chip ${historyFilter === f.id ? 'active' : ''}" data-f="${f.id}">${f.label}</button>`).join('')}</div>
    <div class="card">
      ${eventos.length ? eventos.map(ev => `
        <div class="hist-item">
          <div class="hora">${esc(ev.hora)}</div>
          <div>
            <div class="accion">${esc(ev.accion)}${ev.recurso ? ' — ' + esc(ev.recurso) : ''}</div>
            ${ev.contexto ? `<div class="detalle">${esc(ev.contexto)}</div>` : ''}
          </div>
        </div>
      `).join('') : `<div class="empty-hint">Sin eventos para este filtro</div>`}
    </div>
  `;
  qsa('[data-f]', view).forEach(b => b.onclick = () => { historyFilter = b.dataset.f; renderHistorial(); });
  qs('#histSearch', view).oninput = (e) => { historySearch = e.target.value; renderHistorial(); };
}

// ================= INFORME =================
function renderInforme() {
  const s = Store.getState();
  if (!s.incidente) return;
  const view = qs('#view-informe');
  const inf = Store.generarInforme();
  const r = inf.resumen;
  const finalizado = s.incidente.finalizado;

  view.innerHTML = `
    <div class="report-block">
      <h3>Resumen</h3>
      <div class="card">
        <div class="modal-row"><span class="k">Incidente</span><span>${esc(r.nombre)}</span></div>
        <div class="modal-row"><span class="k">Lugar</span><span>${esc(r.lugar || '—')}</span></div>
        <div class="modal-row"><span class="k">Comandante</span><span>${esc(r.comandante || '—')}</span></div>
        <div class="modal-row"><span class="k">Inicio</span><span>${formatFecha(r.fechaHoraInicio)}</span></div>
        <div class="modal-row"><span class="k">Final</span><span>${r.fechaHoraFin ? formatFecha(r.fechaHoraFin) : 'En curso'}</span></div>
        <div class="modal-row"><span class="k">Duración</span><span>${r.duracionMin} min</span></div>
        <div class="modal-row"><span class="k">Cuarteles presentes</span><span>${r.cuartelesPresentes.map(esc).join(', ')}</span></div>
        <div class="modal-row"><span class="k">Sectores utilizados</span><span>${r.sectoresUtilizados.length ? r.sectoresUtilizados.join(', ') : '—'}</span></div>
      </div>
      <div class="report-grid">
        <div class="report-stat"><div class="n">${r.personalMaximoPresente}</div><div class="l">Personal presente</div></div>
        <div class="report-stat"><div class="n">${r.totalMoviles}</div><div class="l">Móviles totales</div></div>
        <div class="report-stat"><div class="n">${r.totalCisternas}</div><div class="l">Cisternas</div></div>
        <div class="report-stat"><div class="n">${r.capacidadTotalAgua.toLocaleString('es-AR')} L</div><div class="l">Agua disponible</div></div>
      </div>
    </div>

    <div class="report-block">
      <h3>Situación final</h3>
      <div class="card">
        <div class="modal-row"><span class="k">Líneas activas</span><span>${s.lineas.filter(l => l.estado === 'activa').length}</span></div>
        <div class="modal-row"><span class="k">Grupos trabajando</span><span>${s.grupos.filter(g => g.estado === 'trabajando').length}</span></div>
        <div class="modal-row"><span class="k">Grupos en descanso</span><span>${s.grupos.filter(g => g.estado === 'descanso').length}</span></div>
        <div class="modal-row"><span class="k">Recursos retirados</span><span>${inf.recursosRetirados.length}</span></div>
      </div>
    </div>

    ${inf.refuerzos.length ? `
    <div class="report-block">
      <h3>Refuerzos</h3>
      ${inf.refuerzos.map(rf => `<div class="res-item"><div><div class="main">${esc(rf.cuartel)}</div><div class="sub">Personal: ${rf.personal}</div></div><span class="state-pill state-${rf.estado === 'activo' ? 'asignado' : 'retirado'}">${rf.estado}</span></div>`).join('')}
    </div>` : ''}

    ${inf.instantaneas.length ? `
    <div class="report-block">
      <h3>Evolución táctica</h3>
      ${inf.instantaneas.map(sn => `<div class="hist-item"><div class="hora">${esc(sn.hora)}</div><div><div class="accion">${esc(sn.etiqueta)}</div><div class="detalle">Móviles: ${sn.resumen.movilesAsignados} · Líneas: ${sn.resumen.lineasActivas} · Grupos: ${sn.resumen.gruposTrabajando} · Agua: ${sn.resumen.aguaLitros.toLocaleString('es-AR')} L</div></div></div>`).join('')}
    </div>` : ''}

    <div class="report-block">
      <h3>Cronología</h3>
      <div class="card">
        ${s.historial.length ? s.historial.map(ev => `
          <div class="hist-item"><div class="hora">${esc(ev.hora)}</div><div><div class="accion">${esc(ev.accion)}${ev.recurso ? ' — ' + esc(ev.recurso) : ''}</div>${ev.contexto ? `<div class="detalle">${esc(ev.contexto)}</div>` : ''}</div></div>
        `).join('') : `<div class="empty-hint">Sin eventos registrados</div>`}
      </div>
    </div>

    ${!finalizado ? `
    <div class="report-block">
      <button class="btn btn-danger btn-block" id="btnFinalizar">🔴 FINALIZAR INCIDENTE</button>
    </div>` : `<div class="info-box">Este incidente fue finalizado el ${formatFecha(r.fechaHoraFin)}. No admite modificaciones.</div>`}
  `;

  if (!finalizado) {
    qs('#btnFinalizar', view).onclick = () => {
      confirmDialog({
        title: '¿Está seguro de que desea finalizar este incidente?',
        confirmLabel: 'Continuar',
        danger: true,
        onConfirm: () => {
          confirmDialog({
            title: 'CONFIRMACIÓN FINAL',
            warnBody: 'El incidente quedará bloqueado y pasará al historial. Esta acción no podrá modificarse posteriormente.',
            confirmLabel: 'Finalizar incidente',
            danger: true,
            onConfirm: async () => {
              Store.finalizarIncidente();
              await DB.archiveIncident(Store.getState());
              await DB.clearActiveIncident();
              toast('Incidente finalizado');
              renderAll();
              lockAfterFinalize();
            }
          });
        }
      });
    };
  }
}

function lockAfterFinalize() {
  qs('#fabAdd').style.display = 'none';
}

function formatFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---------------- Init ----------------
document.addEventListener('DOMContentLoaded', boot);
