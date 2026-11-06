import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeUpdate, scenarios, phases } from './shared.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const taskDirectory = mkdtempSync('/var/tmp/llm-workshop-agent-');
const logPath = join(taskDirectory, 'agent.log');
const command = process.argv[2];
const remote = process.argv.includes('--remote');
const location = remote ? '--remote' : '--local';

function log(event, detail = {}) {
  appendFileSync(logPath, JSON.stringify({ timestamp: new Date().toISOString(), event, ...detail }) + '\n');
}

function quote(value) {
  if (value === null) return 'NULL';
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function execute(sql) {
  const path = join(taskDirectory, 'query.sql');
  writeFileSync(path, sql, { mode: 0o600 });
  log('query_started', { location });
  const result = spawnSync('wrangler', ['d1', 'execute', 'DB', '--config', join(directory, 'wrangler.jsonc'), location, '--file', path, '--json'], { cwd: join(directory, '..'), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  rmSync(path, { force: true });
  if (result.status !== 0) {
    log('query_failed', { status: result.status, error: result.stderr || result.error?.message || 'Unknown error' });
    throw new Error('D1 operation failed. Check the private diagnostic log.');
  }
  const parsed = JSON.parse(result.stdout);
  if (parsed.some(item => item.success === false)) throw new Error('D1 returned an unsuccessful operation.');
  log('query_completed', { resultSets: parsed.length });
  return parsed.map(item => item.results ?? []);
}

try {
  log('started', { command, remote });
  if (command === 'context') {
    const [room, entries, reflections, updates] = execute([
      'SELECT phase, ends_at, spotlight_id, prompt, submissions_open FROM room_state WHERE id = 1;',
      "SELECT e.id, e.kind, e.title, e.context, e.outcome, e.assumption, e.verification, e.blocker, e.status, CASE WHEN e.anonymous = 1 THEN 'Anonymous' ELSE p.name END AS author, (SELECT count(*) FROM votes v WHERE v.entry_id = e.id) AS support FROM entries e JOIN participants p ON e.author_id = p.id ORDER BY support DESC, e.created_at DESC LIMIT 300;",
      'SELECT scenario_id, before_choice, after_choice, assumption, context_needed, experiment FROM reflections;',
      'SELECT title, body, proof_url, created_at FROM updates ORDER BY created_at DESC LIMIT 12;',
    ].join('\n'));
    process.stdout.write(JSON.stringify({ room: room[0], phases, scenarios, entries, reflections, updates }, null, 2) + '\n');
  } else if (command === 'publish') {
    const data = normalizeUpdate(JSON.parse(readFileSync(0, 'utf8')));
    const id = randomUUID();
    const now = new Date().toISOString();
    execute('INSERT INTO updates(id, title, body, entry_id, source, proof_url, created_at) VALUES (' + [id, data.title, data.body, data.entryId, 'agent', data.proofUrl, now].map(quote).join(', ') + ');\nUPDATE room_state SET revision = revision + 1, updated_at = ' + quote(now) + ' WHERE id = 1;');
    process.stdout.write(JSON.stringify({ id, published: true, remote }) + '\n');
  } else {
    throw new Error('Usage: node llm/agent.mjs context|publish [--remote]. Publish reads one JSON object from stdin.');
  }
  log('completed');
} catch (error) {
  log('failed', { error: error.message });
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
} finally {
  process.stderr.write('Diagnostic log: ' + logPath + '\n');
}
