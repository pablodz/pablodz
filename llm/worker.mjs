import { phases, InputError, textValue, enumValue, normalizeEntry, normalizeProfile, normalizeReflection, normalizeUpdate } from './shared.mjs';

const base = '/llm/api';
const cookieName = 'llm_session';

function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra },
  });
}

async function digest(value) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function sameSecret(provided, expected) {
  if (!expected || typeof provided !== 'string' || provided.length > 300) return false;
  const left = await digest(provided);
  const right = await digest(expected);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function statement(env, sql, ...values) {
  return env.DB.prepare(sql).bind(...values);
}

function revision(env) {
  return statement(env, 'UPDATE room_state SET revision = revision + 1, updated_at = ? WHERE id = 1', new Date().toISOString());
}

async function bodyOf(request) {
  if (!request.headers.get('Content-Type')?.includes('application/json')) throw new InputError('json_required', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('invalid_json');
  const chunks = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      throw new InputError('body_too_large', 413);
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let result;
  try { result = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new InputError('invalid_json'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new InputError('invalid_json');
  return result;
}

async function currentUser(request, env) {
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)llm_session=([A-Za-z0-9_-]+)/)?.[1];
  if (!token || token.length !== 64) return null;
  return statement(env, 'SELECT p.* FROM sessions s JOIN participants p ON p.id = s.participant_id WHERE s.token_hash = ? AND s.expires_at > ?', await digest(token), Date.now()).first();
}

function hostOnly(user) {
  if (user.role !== 'host') throw new InputError('host_required', 403);
}

async function join(request, env, isHost) {
  const data = await bodyOf(request);
  const expected = isHost ? env.HOST_KEY : env.ROOM_CODE;
  if (!expected) throw new InputError('room_not_configured', 503);
  if (!await sameSecret(data.code, expected)) throw new InputError('invalid_code', 401);
  const name = textValue(data.name ?? (isHost ? 'Facilitación' : ''), 90, true);
  const area = textValue(data.area ?? (isHost ? 'Organización' : ''), 100);
  const id = crypto.randomUUID();
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
  const now = new Date().toISOString();
  await env.DB.batch([
    statement(env, 'INSERT INTO participants(id, name, area, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, name, area, isHost ? 'host' : 'participant', now, now),
    statement(env, 'INSERT INTO sessions(token_hash, participant_id, expires_at) VALUES (?, ?, ?)', await digest(token), id, Date.now() + 7 * 86400000),
    revision(env),
  ]);
  return json({ id, name, area, role: isHost ? 'host' : 'participant', profile: {} }, 201, {
    'Set-Cookie': `${cookieName}=${token}; Path=/llm; HttpOnly; SameSite=Lax; Max-Age=604800${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`,
  });
}

async function roomState(env) {
  return statement(env, 'SELECT * FROM room_state WHERE id = 1').first();
}

async function requireOpen(env) {
  const room = await roomState(env);
  if (!room.submissions_open) throw new InputError('submissions_closed', 409);
}

async function reflectionsFor(env, id) {
  const { results } = await statement(env, 'SELECT * FROM reflections WHERE participant_id = ?', id).all();
  return results.map(row => ({ scenarioId: row.scenario_id, beforeChoice: row.before_choice, afterChoice: row.after_choice, assumption: row.assumption, contextNeeded: row.context_needed, experiment: row.experiment }));
}

async function entriesFor(env, user) {
  const { results } = await statement(env, `SELECT e.*, p.name, p.area,
    (SELECT count(*) FROM votes v WHERE v.entry_id = e.id) AS support,
    EXISTS(SELECT 1 FROM votes v WHERE v.entry_id = e.id AND v.participant_id = ?) AS supported
    FROM entries e JOIN participants p ON p.id = e.author_id ORDER BY e.created_at DESC LIMIT 300`, user.id).all();
  return results.map(({ author_id, ...entry }) => ({ ...entry, name: entry.anonymous ? 'Sin nombre en el muro' : entry.name, area: entry.anonymous ? '' : entry.area, own: author_id === user.id }));
}

async function state(request, env, user) {
  const room = await roomState(env);
  const etag = `"${room.revision}-${user.id}"`;
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-store' } });
  const [entries, updates, totals, reflections, poll, profile, votes] = await Promise.all([
    entriesFor(env, user),
    statement(env, 'SELECT * FROM updates ORDER BY created_at DESC LIMIT 60').all(),
    statement(env, `SELECT
      (SELECT count(*) FROM participants WHERE role = 'participant') AS participants,
      (SELECT count(*) FROM entries WHERE kind = 'case') AS cases,
      (SELECT count(*) FROM entries WHERE kind = 'question') AS questions,
      (SELECT count(DISTINCT participant_id) FROM reflections WHERE before_choice != '') AS reflections,
      (SELECT count(*) FROM participants WHERE role = 'participant' AND json_extract(profile, '$.pilot') != '') AS pilots`).first(),
    reflectionsFor(env, user.id),
    statement(env, `SELECT scenario_id AS scenarioId, before_choice AS beforeChoice, after_choice AS afterChoice, count(*) AS count FROM reflections GROUP BY scenario_id, before_choice, after_choice`).all(),
    statement(env, 'SELECT profile FROM participants WHERE id = ?', user.id).first(),
    statement(env, 'SELECT count(*) AS total FROM votes WHERE participant_id = ?', user.id).first(),
  ]);
  return json({ room, phases, entries, updates: updates.results, totals, reflections, poll: poll.results, profile: JSON.parse(profile.profile), votesUsed: votes.total, serverTime: Date.now() }, 200, { ETag: etag });
}

async function saveEntry(request, env, user) {
  await requireOpen(env);
  const data = await bodyOf(request);
  const entry = normalizeEntry(data);
  const id = data.id ? textValue(data.id, 36) : crypto.randomUUID();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new InputError('invalid_id');
  const existing = await statement(env, 'SELECT author_id FROM entries WHERE id = ?', id).first();
  if (existing && existing.author_id !== user.id) throw new InputError('not_owner', 403);
  const count = await statement(env, 'SELECT count(*) AS total FROM entries WHERE author_id = ?', user.id).first();
  if (!existing && count.total >= 30) throw new InputError('entry_limit', 409);
  const now = new Date().toISOString();
  await env.DB.batch([
    statement(env, `INSERT INTO entries(id, author_id, kind, title, context, outcome, assumption, verification, blocker, anonymous, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, kind = excluded.kind, context = excluded.context, outcome = excluded.outcome,
      assumption = excluded.assumption, verification = excluded.verification, blocker = excluded.blocker, anonymous = excluded.anonymous, updated_at = excluded.updated_at`,
      id, user.id, entry.kind, entry.title, entry.context, entry.outcome, entry.assumption, entry.verification, entry.blocker, entry.anonymous ? 1 : 0, now, now),
    revision(env),
  ]);
  return json({ id }, existing ? 200 : 201);
}

async function vote(request, env, user, id) {
  await requireOpen(env);
  const data = await bodyOf(request);
  if (typeof data.supported !== 'boolean') throw new InputError('invalid_option');
  if (!await statement(env, 'SELECT id FROM entries WHERE id = ?', id).first()) throw new InputError('not_found', 404);
  if (data.supported) {
    await env.DB.batch([
      statement(env, `INSERT OR IGNORE INTO votes(entry_id, participant_id, created_at)
        SELECT ?, ?, ? WHERE (SELECT count(*) FROM votes WHERE participant_id = ?) < 3`, id, user.id, new Date().toISOString(), user.id),
      revision(env),
    ]);
    if (!await statement(env, 'SELECT entry_id FROM votes WHERE entry_id = ? AND participant_id = ?', id, user.id).first()) throw new InputError('vote_limit', 409);
  } else {
    await env.DB.batch([statement(env, 'DELETE FROM votes WHERE entry_id = ? AND participant_id = ?', id, user.id), revision(env)]);
  }
  return json({ supported: data.supported });
}

async function profile(request, env, user) {
  const data = normalizeProfile(await bodyOf(request));
  await env.DB.batch([statement(env, 'UPDATE participants SET profile = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), new Date().toISOString(), user.id), revision(env)]);
  return json(data);
}

async function reflect(request, env, user) {
  const input = await bodyOf(request);
  const existing = (await reflectionsFor(env, user.id)).find(item => item.scenarioId === input.scenarioId) ?? {};
  const data = normalizeReflection({ ...existing, ...input });
  if (existing.beforeChoice) data.beforeChoice = existing.beforeChoice;
  await env.DB.batch([
    statement(env, `INSERT INTO reflections(participant_id, scenario_id, before_choice, after_choice, assumption, context_needed, experiment, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(participant_id, scenario_id) DO UPDATE SET
      before_choice = excluded.before_choice, after_choice = excluded.after_choice, assumption = excluded.assumption,
      context_needed = excluded.context_needed, experiment = excluded.experiment, updated_at = excluded.updated_at`,
      user.id, data.scenarioId, data.beforeChoice, data.afterChoice, data.assumption, data.contextNeeded, data.experiment, new Date().toISOString()),
    revision(env),
  ]);
  return json(data);
}

async function hostRoom(request, env, user) {
  hostOnly(user);
  const data = await bodyOf(request);
  const old = await roomState(env);
  const phase = data.phase ?? old.phase;
  if (!Number.isInteger(phase) || phase < 0 || phase >= phases.length) throw new InputError('invalid_phase');
  const minutes = data.minutes ?? null;
  if (minutes !== null && (!Number.isFinite(minutes) || minutes < 1 || minutes > 180)) throw new InputError('invalid_minutes');
  const endsAt = data.stopTimer ? null : minutes === null ? old.ends_at : Date.now() + minutes * 60000;
  const spotlightId = data.spotlightId === undefined ? old.spotlight_id : data.spotlightId;
  if (spotlightId && !await statement(env, 'SELECT id FROM entries WHERE id = ?', spotlightId).first()) throw new InputError('not_found', 404);
  const prompt = data.prompt === undefined ? old.prompt : textValue(data.prompt, 1000);
  const submissionsOpen = data.submissionsOpen === undefined ? old.submissions_open : data.submissionsOpen === true ? 1 : 0;
  await env.DB.batch([
    statement(env, 'UPDATE room_state SET phase = ?, ends_at = ?, spotlight_id = ?, prompt = ?, submissions_open = ? WHERE id = 1', phase, endsAt, spotlightId, prompt, submissionsOpen),
    revision(env),
  ]);
  return json({ ok: true });
}

async function report(env) {
  const [people, reflections, contributions] = await Promise.all([
    statement(env, `SELECT id, name, area, profile, created_at, updated_at FROM participants WHERE role = 'participant' ORDER BY name`).all(),
    statement(env, 'SELECT * FROM reflections').all(),
    statement(env, 'SELECT id, author_id, kind, title FROM entries ORDER BY created_at').all(),
  ]);
  return { participants: people.results.map(person => ({ ...person, profile: JSON.parse(person.profile), reflections: reflections.results.filter(item => item.participant_id === person.id), contributions: contributions.results.filter(item => item.author_id === person.id) })) };
}

async function publish(request, env, user) {
  hostOnly(user);
  const data = normalizeUpdate(await bodyOf(request));
  if (data.entryId && !await statement(env, 'SELECT id FROM entries WHERE id = ?', data.entryId).first()) throw new InputError('not_found', 404);
  const id = crypto.randomUUID();
  await env.DB.batch([
    statement(env, 'INSERT INTO updates(id, title, body, entry_id, source, proof_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, data.title, data.body, data.entryId, 'host', data.proofUrl, new Date().toISOString()),
    revision(env),
  ]);
  return json({ id }, 201);
}

async function handle(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${base}/`)) return env.ASSETS.fetch(request);
  const path = url.pathname.slice(base.length);
  if (request.method === 'GET' && path === '/health') return json({ status: 'ok', storage: 'D1', version: '1' });
  if (request.method !== 'GET') {
    const origin = request.headers.get('Origin');
    if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new InputError('invalid_origin', 403);
  }
  if (request.method === 'POST' && path === '/join') return join(request, env, false);
  if (request.method === 'POST' && path === '/host/login') return join(request, env, true);
  const user = await currentUser(request, env);
  if (request.method === 'GET' && path === '/session') return json({ user: user ? { id: user.id, name: user.name, area: user.area, role: user.role, profile: JSON.parse(user.profile) } : null });
  if (!user) throw new InputError('login_required', 401);
  if (request.method === 'POST' && path === '/logout') {
    const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)llm_session=([A-Za-z0-9_-]+)/)?.[1];
    await statement(env, 'DELETE FROM sessions WHERE token_hash = ?', await digest(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': `${cookieName}=; Path=/llm; HttpOnly; SameSite=Lax; Max-Age=0` });
  }
  if (request.method === 'GET' && path === '/state') return state(request, env, user);
  if (request.method === 'POST' && path === '/entries') return saveEntry(request, env, user);
  const entryMatch = path.match(/^\/entries\/([0-9a-f-]{36})$/i);
  if (request.method === 'DELETE' && entryMatch) {
    const entry = await statement(env, 'SELECT author_id FROM entries WHERE id = ?', entryMatch[1]).first();
    if (!entry) throw new InputError('not_found', 404);
    if (entry.author_id !== user.id && user.role !== 'host') throw new InputError('not_owner', 403);
    await env.DB.batch([statement(env, 'DELETE FROM entries WHERE id = ?', entryMatch[1]), revision(env)]);
    return json({ ok: true });
  }
  const statusMatch = path.match(/^\/entries\/([0-9a-f-]{36})\/status$/i);
  if (request.method === 'PUT' && statusMatch) {
    hostOnly(user);
    const data = await bodyOf(request);
    const status = enumValue(data.status, ['proposed', 'testing', 'blocked', 'ready']);
    await env.DB.batch([statement(env, 'UPDATE entries SET status = ?, updated_at = ? WHERE id = ?', status, new Date().toISOString(), statusMatch[1]), revision(env)]);
    return json({ ok: true });
  }
  const voteMatch = path.match(/^\/votes\/([0-9a-f-]{36})$/i);
  if (request.method === 'PUT' && voteMatch) return vote(request, env, user, voteMatch[1]);
  if (request.method === 'PUT' && path === '/profile') return profile(request, env, user);
  if (request.method === 'PUT' && path === '/reflection') return reflect(request, env, user);
  if (request.method === 'PUT' && path === '/host/room') return hostRoom(request, env, user);
  if (request.method === 'GET' && path === '/host/report') { hostOnly(user); return json(await report(env)); }
  if (request.method === 'GET' && path === '/host/invite') {
    hostOnly(user);
    return json({ url: new URL('/llm/', request.url).href + '#join=' + encodeURIComponent(env.ROOM_CODE) });
  }
  if (request.method === 'POST' && path === '/host/updates') return publish(request, env, user);
  if (request.method === 'GET' && path === '/host/export') {
    hostOnly(user);
    const [people, entries, room, updates] = await Promise.all([report(env), entriesFor(env, user), roomState(env), statement(env, 'SELECT * FROM updates ORDER BY created_at').all()]);
    return json({ exportedAt: new Date().toISOString(), ...people, entries, room, updates: updates.results });
  }
  throw new InputError('not_found', 404);
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); } catch (error) {
      if (error instanceof InputError) return json({ error: error.message }, error.status);
      console.error(JSON.stringify({ event: 'request_failed', path: new URL(request.url).pathname, message: String(error?.message ?? error) }));
      return json({ error: 'server_error' }, 500);
    }
  },
};
