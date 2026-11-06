import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from './worker.mjs';

function environment(t) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(readFileSync(new URL('./migrations/0001_workshop.sql', import.meta.url), 'utf8'));
  t.after(() => database.close());
  const wrap = (sql, values = []) => ({
    bind: (...next) => wrap(sql, next),
    first: async () => database.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: database.prepare(sql).all(...values) }),
    run: async () => ({ meta: database.prepare(sql).run(...values) }),
  });
  return {
    ROOM_CODE: 'test-room', HOST_KEY: 'test-host',
    ASSETS: { fetch: async () => new Response('asset') },
    DB: {
      prepare: sql => wrap(sql),
      batch: async statements => {
        database.exec('BEGIN');
        try { const results = []; for (const item of statements) results.push(await item.run()); database.exec('COMMIT'); return results; }
        catch (error) { database.exec('ROLLBACK'); throw error; }
      },
    },
  };
}

async function request(env, path, method = 'GET', body, cookie, headers = {}) {
  return worker.fetch(new Request('https://workshop.test/llm/api' + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
}

async function login(env, name, host = false) {
  const response = await request(env, host ? '/host/login' : '/join', 'POST', { name, area: 'FDE', code: host ? 'test-host' : 'test-room', role: 'host' });
  assert.equal(response.status, 201);
  return { user: await response.json(), cookie: response.headers.get('Set-Cookie').split(';')[0] };
}

test('participants across devices share cases while private needs stay private', async t => {
  const env = environment(t);
  const people = [];
  for (let index = 0; index < 26; index++) people.push(await login(env, 'Persona ' + index));
  const host = await login(env, 'Organizador', true);
  assert.equal(people[0].user.role, 'participant');
  let response = await request(env, '/entries', 'POST', { title: 'Seguimiento del cliente', context: 'Contexto del negocio', outcome: 'Alertas con evidencia' }, people[0].cookie);
  assert.equal(response.status, 201);
  await request(env, '/profile', 'PUT', { blockedTask: 'Dato privado de créditos', mrAccess: 'no', pilot: 'Mi prueba' }, people[0].cookie);
  response = await request(env, '/state', 'GET', undefined, people[25].cookie);
  const state = await response.json();
  assert.equal(state.totals.participants, 26);
  assert.equal(state.entries[0].title, 'Seguimiento del cliente');
  assert.equal(JSON.stringify(state).includes('Dato privado de créditos'), false);
  assert.equal((await request(env, '/host/report', 'GET', undefined, people[0].cookie)).status, 403);
  const report = await (await request(env, '/host/report', 'GET', undefined, host.cookie)).json();
  assert.equal(report.participants.find(person => person.name === 'Persona 0').profile.blockedTask, 'Dato privado de créditos');
  assert.equal(report.participants.find(person => person.name === 'Persona 0').contributions.length, 1);
});

test('support is idempotent and the three-vote limit holds', async t => {
  const env = environment(t);
  const author = await login(env, 'Autor');
  const voter = await login(env, 'Votante');
  const ids = [];
  for (let index = 0; index < 4; index++) ids.push((await (await request(env, '/entries', 'POST', { title: 'Caso ' + index }, author.cookie)).json()).id);
  for (const id of ids.slice(0, 3)) assert.equal((await request(env, '/votes/' + id, 'PUT', { supported: true }, voter.cookie)).status, 200);
  assert.equal((await request(env, '/votes/' + ids[0], 'PUT', { supported: true }, voter.cookie)).status, 200);
  assert.equal((await request(env, '/votes/' + ids[3], 'PUT', { supported: true }, voter.cookie)).status, 409);
  await request(env, '/votes/' + ids[0], 'PUT', { supported: false }, voter.cookie);
  assert.equal((await request(env, '/votes/' + ids[3], 'PUT', { supported: true }, voter.cookie)).status, 200);
  const state = await (await request(env, '/state', 'GET', undefined, voter.cookie)).json();
  assert.equal(state.votesUsed, 3);
});

test('reflections support different jobs and preserve the initial hypothesis', async t => {
  const env = environment(t);
  const person = await login(env, 'Cliente');
  let response = await request(env, '/reflection', 'PUT', { scenarioId: 'client-followup', beforeChoice: 'manual', assumption: 'Necesito leer todo personalmente' }, person.cookie);
  assert.equal(response.status, 200);
  response = await request(env, '/reflection', 'PUT', { scenarioId: 'client-followup', beforeChoice: 'delegated', afterChoice: 'delegated', experiment: 'Probar tres conversaciones' }, person.cookie);
  assert.equal((await response.json()).beforeChoice, 'manual');
  assert.equal((await request(env, '/reflection', 'PUT', { scenarioId: 'local-testing', beforeChoice: 'hybrid' }, person.cookie)).status, 200);
  const state = await (await request(env, '/state', 'GET', undefined, person.cookie)).json();
  assert.equal(state.reflections.length, 2);
  assert.equal(state.totals.reflections, 1);
  assert.equal((await request(env, '/reflection', 'PUT', { scenarioId: 'client-followup', beforeChoice: 'cloud' }, person.cookie)).status, 400);
});

test('only hosts control the shared phase and new submissions', async t => {
  const env = environment(t);
  const person = await login(env, 'Participante');
  const host = await login(env, 'Host', true);
  const initial = await request(env, '/state', 'GET', undefined, person.cookie);
  const etag = initial.headers.get('ETag');
  assert.equal((await request(env, '/state', 'GET', undefined, person.cookie, { 'If-None-Match': etag })).status, 304);
  assert.equal((await request(env, '/host/room', 'PUT', { phase: 3 }, person.cookie)).status, 403);
  assert.equal((await request(env, '/host/room', 'PUT', { phase: 3, minutes: 12, submissionsOpen: false }, host.cookie)).status, 200);
  const state = await (await request(env, '/state', 'GET', undefined, person.cookie, { 'If-None-Match': etag })).json();
  assert.equal(state.room.phase, 3);
  assert.ok(state.room.ends_at > Date.now());
  assert.equal((await request(env, '/entries', 'POST', { title: 'En pausa' }, person.cookie)).status, 409);
  assert.equal((await request(env, '/profile', 'PUT', { pilot: 'Sigo preparando mi experimento' }, person.cookie)).status, 200);
});

test('ownership, hidden names, origin checks and logout protect participation', async t => {
  const env = environment(t);
  const author = await login(env, 'Nombre privado');
  const other = await login(env, 'Otra persona');
  const id = crypto.randomUUID();
  assert.equal((await request(env, '/entries', 'POST', { id, title: "Cliente O'Connor <script>alert(1)</script>", anonymous: true }, author.cookie)).status, 201);
  assert.equal((await request(env, '/entries', 'POST', { id, title: 'Cambio ajeno' }, other.cookie)).status, 403);
  assert.equal((await request(env, '/entries/' + id, 'DELETE', undefined, other.cookie)).status, 403);
  const state = await (await request(env, '/state', 'GET', undefined, other.cookie)).json();
  assert.equal(state.entries[0].name, 'Sin nombre en el muro');
  assert.equal(state.entries[0].author_id, undefined);
  assert.equal((await request(env, '/entries', 'POST', { title: 'Cross site' }, author.cookie, { Origin: 'https://other.test' })).status, 403);
  assert.equal((await request(env, '/entries', 'POST', { title: 'x'.repeat(17000) }, author.cookie)).status, 413);
  assert.equal((await request(env, '/logout', 'POST', {}, author.cookie)).status, 200);
  assert.equal((await request(env, '/state', 'GET', undefined, author.cookie)).status, 401);
});

test('host discoveries sync with evidence links and the export stays restricted', async t => {
  const env = environment(t);
  const person = await login(env, 'Participante');
  const host = await login(env, 'Host', true);
  assert.equal((await request(env, '/host/updates', 'POST', { title: 'Hallazgo', body: 'Evidencia observada', proofUrl: 'javascript:alert(1)' }, host.cookie)).status, 400);
  assert.equal((await request(env, '/host/updates', 'POST', { title: 'Hallazgo', body: 'Evidencia observada', proofUrl: 'https://example.com/evidence' }, host.cookie)).status, 201);
  const state = await (await request(env, '/state', 'GET', undefined, person.cookie)).json();
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].proof_url, 'https://example.com/evidence');
  assert.equal((await request(env, '/host/export', 'GET', undefined, person.cookie)).status, 403);
  assert.equal((await request(env, '/host/invite', 'GET', undefined, person.cookie)).status, 403);
  assert.equal((await request(env, '/host/export', 'GET', undefined, host.cookie)).status, 200);
});
