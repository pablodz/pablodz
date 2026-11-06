import { phases, blockers, scenarios } from '../../llm/shared.mjs';

const get = id => document.getElementById(id);
const root = get('workshop');
const hostEntry = root.dataset.host === 'true';
const apiRoot = '/llm/api';
let user = null;
let snapshot = null;
let etag = null;
let polling = false;
let pendingRefresh = false;
let profileLoaded = false;
let hostLoaded = false;
let serverOffset = 0;
let activeView = 'board';
let selectedScenario = scenarios[0].id;
let toastTimeout;
const reflectionDrafts = new Map();
const errors = {
  invalid_code: 'El código no coincide. Revísalo con el organizador.',
  login_required: 'Tu sesión terminó. Entra de nuevo para continuar.',
  host_required: 'Esta acción está disponible para los organizadores.',
  invalid_length: 'Revisa los campos obligatorios y la longitud de tus respuestas.',
  invalid_text: 'Revisa el contenido del formulario.',
  invalid_option: 'Revisa las opciones seleccionadas.',
  invalid_url: 'Usa un enlace completo que empiece por https:// o http://.',
  invalid_minutes: 'Revisa la cantidad de minutos.',
  vote_limit: 'Ya usaste tus 3 apoyos. Puedes retirar uno para apoyar otro aporte.',
  entry_limit: 'Llegaste al máximo de aportes por persona. Puedes editar los que ya compartiste.',
  not_owner: 'Puedes editar tus propios aportes.',
  not_found: 'Ese aporte ya no está disponible. Actualiza el tablero.',
  submissions_closed: 'El facilitador pausó los nuevos aportes. Tus cambios siguen en el formulario.',
  room_not_configured: 'La sala todavía necesita configuración. Avísale al organizador.',
  server_error: 'No pudimos guardar el cambio. Inténtalo de nuevo; tu texto sigue aquí.',
  invalid_origin: 'Abre la página directamente desde el enlace del taller.',
  body_too_large: 'El aporte es demasiado largo. Resume el contexto y vuelve a intentarlo.',
};
const statusLabels = { proposed: 'Por explorar', testing: 'En prueba', blocked: 'Con un bloqueo', ready: 'Resultado para revisar' };
const creditLabels = { enough: 'Le alcanza para experimentar', sometimes: 'Algunas veces llega al límite', blocked: 'Una prueba quedó bloqueada', unknown: 'Capacidad por confirmar' };
const accessLabels = { yes: 'Sí, declarado por la persona', no: 'No', unknown: 'Por verificar' };
const intentLabels = { feature: 'Funcionalidades', fix: 'Arreglos pequeños', diagnosis: 'Diagnóstico y cliente', automation: 'Automatizaciones', exploration: 'Explorar' };

function node(tag, className = '', text = '') {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text) result.textContent = text;
  return result;
}

function notify(text, error = false) {
  const toast = get('toast');
  toast.textContent = text;
  toast.dataset.error = String(error);
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.hidden = true; }, error ? 7000 : 4300);
}

function explain(error) {
  return errors[error.message] ?? 'No pudimos conectar. Tu texto sigue en el formulario; vuelve a intentarlo.';
}

async function api(path, method = 'GET', data, headers = {}) {
  const response = await fetch(apiRoot + path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  if (response.status === 304) return { unchanged: true };
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/join' && path !== '/host/login') showWelcome();
    throw new Error(result.error ?? 'server_error');
  }
  return { data: result, etag: response.headers.get('ETag') };
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function bindForm(id, action) {
  get(id).addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try { await action(formValues(form), form); } catch (error) {
      if (id === 'join-form') get('join-error').textContent = explain(error);
      else notify(explain(error), true);
    } finally { button.disabled = false; }
  });
}

function bindAction(id, action) {
  get(id).addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await action(); } catch (error) { notify(explain(error), true); }
    finally { button.disabled = false; }
  });
}

function showWelcome() {
  user = null;
  snapshot = null;
  etag = null;
  profileLoaded = false;
  hostLoaded = false;
  reflectionDrafts.clear();
  get('welcome').hidden = false;
  get('session').hidden = true;
  get('logout').hidden = true;
  get('composer').hidden = true;
  get('profile-form').reset();
  get('reflection-form').reset();
  for (const id of ['cases', 'questions', 'people', 'updates']) get(id).replaceChildren();
  get('sync-state').textContent = 'Taller de agentes de IA';
}

function showSession(nextUser) {
  user = nextUser;
  get('welcome').hidden = true;
  get('session').hidden = false;
  get('logout').hidden = false;
  get('host-tab').hidden = user.role !== 'host';
  get('greeting').textContent = user.name + (user.area ? ' · ' + user.area : '');
  navigate(hostEntry && user.role === 'host' ? 'host' : 'board');
  history.replaceState(null, '', location.pathname + location.search);
}

async function refresh(force = false) {
  if (!user) return;
  if (polling) { if (force) pendingRefresh = true; return; }
  polling = true;
  try {
    const result = await api('/state', 'GET', undefined, !force && etag ? { 'If-None-Match': etag } : {});
    get('sync-state').textContent = '● Sincronizado';
    get('sync-state').dataset.error = 'false';
    if (!result.unchanged) {
      etag = result.etag;
      snapshot = result.data;
      serverOffset = snapshot.serverTime - Date.now();
      renderState();
    }
  } catch (error) {
    get('sync-state').textContent = 'Reconectando…';
    get('sync-state').dataset.error = 'true';
    if (force) throw error;
  } finally {
    polling = false;
    if (pendingRefresh) { pendingRefresh = false; refresh(true).catch(() => {}); }
  }
}

function navigate(view) {
  if (view === 'host' && user?.role !== 'host') return;
  activeView = view;
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== view;
  get('composer').hidden = true;
  if (view === 'host' && snapshot) loadPeople().catch(error => notify(explain(error), true));
}

function renderState() {
  const { room, totals } = snapshot;
  const phase = phases[room.phase];
  get('phase-label').textContent = 'BLOQUE ' + (room.phase + 1) + ' DE ' + phases.length;
  get('phase-title').textContent = phase.title;
  get('phase-prompt').textContent = room.prompt || phase.prompt;
  for (const item of document.querySelectorAll('[data-phase]')) {
    if (Number(item.dataset.phase) === room.phase) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  }
  get('participant-count').textContent = String(totals.participants);
  get('pilot-count').textContent = String(totals.pilots);
  get('case-count').textContent = String(totals.cases);
  get('question-count').textContent = String(totals.questions);
  get('votes-left').textContent = room.submissions_open ? 'Te quedan ' + Math.max(0, 3 - snapshot.votesUsed) + ' de 3 apoyos. Puedes cambiarlos.' : 'Los nuevos aportes y apoyos están en pausa.';
  get('votes-left').classList.toggle('closed-notice', !room.submissions_open);
  get('add-case').disabled = !room.submissions_open;
  get('add-question').disabled = !room.submissions_open;
  renderCards();
  renderSpotlight();
  renderUpdates();
  if (!profileLoaded) {
    fillForm(get('profile-form'), snapshot.profile);
    renderScenario();
    profileLoaded = true;
  }
  get('after-choice').disabled = room.phase < 3;
  renderPoll();
  if (user.role === 'host') {
    get('toggle-submissions').textContent = room.submissions_open ? 'Pausar nuevos aportes' : 'Abrir nuevos aportes';
    if (!hostLoaded) {
      get('phase-select').value = String(room.phase);
      get('phase-minutes').value = String(phase.minutes);
      hostLoaded = true;
    }
    if (activeView === 'host') loadPeople().catch(() => {});
  }
  updateTimer();
}

function updateTimer() {
  if (!snapshot) return;
  const end = snapshot.room.ends_at;
  if (!end) {
    get('timer').textContent = '—:—';
    get('timer-label').textContent = 'El facilitador inicia el bloque';
    return;
  }
  const seconds = Math.max(0, Math.ceil((end - Date.now() - serverOffset) / 1000));
  get('timer').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  get('timer-label').textContent = seconds ? 'Tiempo de este bloque' : 'Bloque completado';
}

function emptyState(title, description) {
  const block = node('div', 'empty-state');
  block.append(node('h3', '', title), node('p', '', description));
  return block;
}

function renderCards() {
  if (!snapshot) return;
  const query = get('search').value.trim().toLocaleLowerCase();
  const sort = get('sort').value;
  const expanded = new Set([...document.querySelectorAll('.entry-details[open]')].map(item => item.dataset.entry));
  for (const kind of ['case', 'question']) {
    const container = get(kind === 'case' ? 'cases' : 'questions');
    const entries = snapshot.entries.filter(entry => entry.kind === kind && (kind === 'question' || ((!query || [entry.title, entry.context, entry.name, entry.area, entry.outcome].join(' ').toLocaleLowerCase().includes(query)) && (sort !== 'mine' || entry.own))));
    entries.sort((a, b) => kind === 'case' && sort === 'recent' ? b.created_at.localeCompare(a.created_at) : b.support - a.support || b.created_at.localeCompare(a.created_at));
    container.replaceChildren();
    if (!entries.length) {
      container.append(emptyState(kind === 'case' ? 'El próximo caso puede ser el tuyo.' : '¿Qué te gustaría entender?', kind === 'case' ? 'Trae una tarea del cliente, del negocio o de tu trabajo. También puedes compartir algo que intentaste y no funcionó.' : 'Deja tu pregunta para que podamos explorarla durante la sesión.'));
    }
    for (const entry of entries) container.append(entryCard(entry, expanded.has(entry.id)));
  }
}

function entryCard(entry, expanded) {
  const card = node('article', 'entry-card' + (snapshot.room.spotlight_id === entry.id ? ' in-spotlight' : ''));
  card.dataset.entryId = entry.id;
  const meta = node('div', 'entry-meta');
  meta.append(node('span', '', entry.name + (entry.area ? ' · ' + entry.area : '')), node('span', 'entry-tag', statusLabels[entry.status] ?? 'Por explorar'));
  card.append(meta, node('h3', '', entry.title));
  if (entry.context) card.append(node('p', 'entry-content', entry.context));
  const details = node('details', 'entry-details');
  details.dataset.entry = entry.id;
  details.open = expanded;
  details.append(node('summary', '', 'Contexto, resultado y bloqueo'));
  const fields = [['Resultado que quiero delegar', entry.outcome], ['Lo que estoy dando por hecho', entry.assumption], ['Cómo lo comprobaría', entry.verification], ['Lo que me frena', blockers[entry.blocker]]];
  for (const [label, value] of fields) {
    if (!value) continue;
    const detail = node('div', 'entry-detail');
    detail.append(node('strong', '', label), node('p', 'entry-content', value));
    details.append(detail);
  }
  card.append(details);
  const footer = node('div', 'entry-footer');
  const support = node('button', 'support-button', (entry.supported ? '✓ ' : '+ ') + 'También me sirve · ' + entry.support);
  support.type = 'button';
  support.setAttribute('aria-pressed', String(Boolean(entry.supported)));
  support.disabled = !snapshot.room.submissions_open;
  support.addEventListener('click', async () => {
    support.disabled = true;
    try { await api('/votes/' + entry.id, 'PUT', { supported: !entry.supported }); await refresh(true); }
    catch (error) { notify(explain(error), true); support.disabled = false; }
  });
  footer.append(support);
  const controls = node('div', 'entry-controls');
  if (entry.own) {
    const edit = node('button', 'text-button', 'Editar');
    edit.type = 'button';
    edit.addEventListener('click', () => openComposer(entry.kind, entry));
    controls.append(edit);
  }
  if (user.role === 'host') {
    const spotlight = node('button', 'text-button', snapshot.room.spotlight_id === entry.id ? 'Destacado' : 'Explorar');
    spotlight.type = 'button';
    spotlight.addEventListener('click', async () => {
      try { await api('/host/room', 'PUT', { spotlightId: entry.id }); await refresh(true); notify('Caso destacado para el grupo.'); }
      catch (error) { notify(explain(error), true); }
    });
    const status = node('select', 'status-select');
    status.setAttribute('aria-label', 'Estado de ' + entry.title);
    for (const [value, label] of Object.entries(statusLabels)) { const option = node('option', '', label); option.value = value; status.append(option); }
    status.value = entry.status;
    status.addEventListener('change', async () => {
      try { await api('/entries/' + entry.id + '/status', 'PUT', { status: status.value }); await refresh(true); }
      catch (error) { notify(explain(error), true); }
    });
    controls.append(spotlight, status);
  }
  footer.append(controls);
  card.append(footer);
  return card;
}

function openComposer(kind, entry) {
  navigate(kind === 'case' ? 'board' : 'questions');
  const form = get('entry-form');
  form.reset();
  form.elements.namedItem('id').value = '';
  form.elements.namedItem('kind').value = kind;
  if (entry) fillForm(form, { ...entry, anonymous: Boolean(entry.anonymous) });
  for (const block of document.querySelectorAll('[data-case-only]')) block.hidden = kind !== 'case';
  get('composer-title').textContent = entry ? 'Dale más contexto a tu aporte' : kind === 'case' ? 'Comparte tu caso' : 'Comparte tu pregunta';
  get('composer').hidden = false;
  form.elements.namedItem('title').focus();
  get('composer').scrollIntoView({ block: 'start', behavior: 'auto' });
}

function renderSpotlight() {
  const container = get('spotlight');
  const entry = snapshot.entries.find(item => item.id === snapshot.room.spotlight_id);
  container.replaceChildren();
  if (!entry) {
    container.append(node('h3', '', 'Tu contexto puede abrir el próximo caso.'), node('p', 'muted small', 'El facilitador destacará aquí un aporte para trabajarlo entre todos.'));
    return;
  }
  container.append(node('h3', '', entry.title), node('p', 'entry-content', entry.outcome || entry.context), node('p', 'small muted', entry.name));
  const button = node('button', 'text-button', 'Ver el contexto completo');
  button.addEventListener('click', () => {
    get('search').value = '';
    get('sort').value = 'recent';
    navigate(entry.kind === 'case' ? 'board' : 'questions');
    renderCards();
    const card = document.querySelector('[data-entry-id="' + entry.id + '"]');
    if (card) { card.querySelector('details').open = true; card.scrollIntoView({ block: 'center' }); }
  });
  container.append(button);
}

function renderUpdates() {
  const container = get('updates');
  container.replaceChildren();
  if (!snapshot.updates.length) container.append(node('p', 'small muted', 'Los hallazgos y resultados aparecerán aquí.'));
  for (const update of snapshot.updates.slice(0, 12)) {
    const article = node('article', 'update-item');
    const time = node('time', '', new Date(update.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }));
    time.dateTime = update.created_at;
    article.append(time, node('h4', '', update.title), node('p', '', update.body));
    if (update.proof_url) {
      const link = node('a', '', 'Ver evidencia ↗');
      link.href = update.proof_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      article.append(link);
    }
    container.append(article);
  }
}

function fillForm(form, values) {
  for (const [name, value] of Object.entries(values)) {
    const fields = [...form.querySelectorAll('[name="' + name + '"]')];
    for (const field of fields) {
      if (field.type === 'checkbox') field.checked = Array.isArray(value) ? value.includes(field.value) : Boolean(value);
      else if (field.type === 'radio') field.checked = field.value === value;
      else field.value = value ?? '';
    }
  }
}

function renderScenario() {
  const scenario = scenarios.find(item => item.id === selectedScenario);
  const saved = snapshot?.reflections.find(item => item.scenarioId === selectedScenario) ?? {};
  const draft = reflectionDrafts.get(selectedScenario) ?? saved;
  const form = get('reflection-form');
  form.reset();
  get('scenario-audience').textContent = scenario.audience;
  get('scenario-question').textContent = scenario.question;
  get('scenario-evidence').textContent = 'Una forma de comprobarlo: ' + scenario.evidence;
  get('scenario-context').replaceChildren(...scenario.context.map(text => node('li', '', text)));
  const container = get('before-choices');
  container.replaceChildren();
  const after = get('after-choice');
  after.replaceChildren();
  const empty = node('option', '', 'Lo revisaré después del experimento'); empty.value = ''; after.append(empty);
  for (const [value, label] of Object.entries(scenario.choices)) {
    const option = node('label', 'choice-option');
    const radio = node('input'); radio.type = 'radio'; radio.name = 'beforeChoice'; radio.value = value; radio.required = true; radio.disabled = Boolean(saved.beforeChoice);
    option.append(radio, node('span', '', label));
    container.append(option);
    const afterOption = node('option', '', label); afterOption.value = value; after.append(afterOption);
  }
  fillForm(form, { ...draft, scenarioId: selectedScenario, beforeChoice: saved.beforeChoice || draft.beforeChoice || '' });
  get('before-lock').hidden = !saved.beforeChoice;
  after.disabled = !snapshot || snapshot.room.phase < 3;
  for (const button of get('scenario-picker').children) button.setAttribute('aria-pressed', String(button.dataset.scenario === selectedScenario));
  renderPoll();
}

function renderPoll() {
  if (!snapshot) return;
  const scenario = scenarios.find(item => item.id === selectedScenario);
  const votes = snapshot.poll.filter(item => item.scenarioId === selectedScenario);
  const total = votes.reduce((sum, row) => sum + (row.beforeChoice ? row.count : 0), 0);
  const container = get('poll-results');
  container.replaceChildren();
  for (const [choice, label] of Object.entries(scenario.choices)) {
    const before = votes.reduce((sum, row) => sum + (row.beforeChoice === choice ? row.count : 0), 0);
    const after = votes.reduce((sum, row) => sum + (row.afterChoice === choice ? row.count : 0), 0);
    const row = node('div', 'poll-row');
    const heading = node('div', 'poll-row-label'); heading.append(node('span', '', label), node('strong', '', String(before)));
    const track = node('div', 'poll-track'); const bar = node('div', 'poll-bar'); bar.style.width = String(total ? before / total * 100 : 0) + '%'; track.append(bar);
    row.append(heading, track, node('p', 'poll-after', 'Después del experimento: ' + after)); container.append(row);
  }
}

async function loadPeople() {
  if (user?.role !== 'host') return;
  const { data } = await api('/host/report');
  const container = get('people');
  const expanded = new Set([...container.querySelectorAll('details[open]')].map(item => item.dataset.person));
  container.replaceChildren();
  if (!data.participants.length) container.append(node('p', 'muted small', 'Las personas aparecerán cuando entren al taller.'));
  for (const person of data.participants) {
    const profile = person.profile;
    const details = node('details', 'person-card'); details.dataset.person = person.id; details.open = expanded.has(person.id);
    details.append(node('summary', '', person.name + (person.area ? ' · ' + person.area : '')));
    details.append(node('p', 'person-meta', 'MR: ' + (accessLabels[profile.mrAccess] ?? 'Por verificar') + ' · Créditos: ' + (creditLabels[profile.credits] ?? 'Sin respuesta')));
    const list = node('dl');
    const rows = [['Herramientas', profile.tools], ['Lectura de repos', accessLabels[profile.readAccess]], ['Interés', profile.intentions?.map(item => intentLabels[item]).join(', ')], ['Límite encontrado', profile.limitType], ['Prueba bloqueada', profile.blockedTask], ['Cómo medirá', profile.measure], ['Frecuencia', profile.frequency], ['Minutos por ejecución', profile.minutes ? String(profile.minutes) : ''], ['Revisar resultado', profile.reviewDate]];
    for (const [label, value] of rows) if (value) list.append(node('dt', '', label), node('dd', '', value));
    details.append(list);
    if (profile.pilot) details.append(node('p', 'person-pilot', 'Experimento: ' + profile.pilot));
    container.append(details);
  }
}

for (const scenario of scenarios) {
  const button = node('button', '', scenario.title);
  button.type = 'button'; button.dataset.scenario = scenario.id;
  button.setAttribute('aria-pressed', String(scenario.id === selectedScenario));
  button.addEventListener('click', () => {
    if (snapshot) reflectionDrafts.set(selectedScenario, formValues(get('reflection-form')));
    selectedScenario = scenario.id;
    renderScenario();
  });
  get('scenario-picker').append(button);
}

get('view-tabs').addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (button) navigate(button.dataset.view); });
get('search').addEventListener('input', renderCards);
get('sort').addEventListener('change', renderCards);
get('add-case').addEventListener('click', () => openComposer('case'));
get('add-question').addEventListener('click', () => openComposer('question'));
get('close-composer').addEventListener('click', () => { get('composer').hidden = true; });
get('phase-select').addEventListener('change', () => { get('phase-minutes').value = String(phases[Number(get('phase-select').value)].minutes); });

bindForm('join-form', async data => {
  get('join-error').textContent = '';
  const result = await api(hostEntry ? '/host/login' : '/join', 'POST', data);
  showSession(result.data);
  await refresh(true);
});

bindForm('entry-form', async (data, form) => {
  if (!data.id) { data.id = crypto.randomUUID(); form.elements.namedItem('id').value = data.id; }
  data.anonymous = form.elements.namedItem('anonymous').checked;
  await api('/entries', 'POST', data);
  form.reset(); get('composer').hidden = true;
  await refresh(true);
  notify('Tu aporte ya está en el muro.');
});

bindForm('reflection-form', async data => {
  const saved = snapshot.reflections.find(item => item.scenarioId === selectedScenario);
  data.beforeChoice = saved?.beforeChoice || data.beforeChoice;
  if (!data.beforeChoice) { notify('Elige una hipótesis inicial.', true); return; }
  await api('/reflection', 'PUT', data);
  reflectionDrafts.delete(selectedScenario);
  await refresh(true); renderScenario();
  notify('Reflexión guardada. Puedes volver después del experimento.');
});

bindForm('profile-form', async (data, form) => {
  data.intentions = new FormData(form).getAll('intentions');
  data.minutes = Number(data.minutes || 0);
  await api('/profile', 'PUT', data);
  await refresh(true);
  notify('Tu próximo paso quedó guardado para darle seguimiento.');
});

bindForm('phase-form', async data => {
  await api('/host/room', 'PUT', { phase: Number(data.phase), minutes: Number(data.minutes), prompt: data.prompt });
  await refresh(true); notify('El bloque cambió para todo el grupo.');
});

bindForm('update-form', async (data, form) => {
  data.entryId = snapshot.room.spotlight_id || null;
  await api('/host/updates', 'POST', data);
  form.reset(); await refresh(true); notify('Hallazgo compartido con el grupo.');
});

bindAction('stop-timer', async () => { await api('/host/room', 'PUT', { stopTimer: true }); await refresh(true); });
bindAction('toggle-submissions', async () => { await api('/host/room', 'PUT', { submissionsOpen: !snapshot.room.submissions_open }); await refresh(true); });
bindAction('refresh-people', loadPeople);
bindAction('invite', async () => {
  const { data } = await api('/host/invite');
  const input = get('invite-link'); input.value = data.url; input.hidden = false; input.select();
  try { await navigator.clipboard.writeText(data.url); notify('Enlace copiado. Compártelo en el Meet.'); }
  catch { notify('Selecciona y copia el enlace que aparece en el panel.'); }
});
bindAction('export', async () => {
  const { data } = await api('/host/export');
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = node('a'); link.href = url; link.download = 'taller-vozy-' + new Date().toISOString().slice(0, 10) + '.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
bindAction('logout', async () => { await api('/logout', 'POST', {}); showWelcome(); get('join-form').reset(); });

const invitation = new URLSearchParams(location.hash.slice(1)).get(hostEntry ? 'host' : 'join');
if (invitation) get('join-form').elements.namedItem('code').value = invitation;

async function start() {
  try {
    const { data } = await api('/session');
    if (data.user) { showSession(data.user); await refresh(true); }
  } catch (error) { get('join-error').textContent = explain(error); }
}

setInterval(() => { if (user && !document.hidden) refresh(); }, 6500);
setInterval(updateTimer, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && user) refresh(true).catch(() => {}); });
window.addEventListener('online', () => { if (user) refresh(true).catch(() => {}); });
start();
