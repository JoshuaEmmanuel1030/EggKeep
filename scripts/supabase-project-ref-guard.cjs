#!/usr/bin/env node
/**
 * supabase-project-ref-guard.js
 *
 * Standing gate: before any migration, supabase/ touch, or edge-function deploy,
 * confirm the active Supabase project ref is the live one (lgtixzpjbkzapecirbfj),
 * not the stale ref that may still be in config.toml (kpszurxnzhivrvzmcded).
 *
 * Run from the EggKeep/ directory (or pass --root <path>).
 *
 * Exit 0 = clear. Exit 1 = blocked with a message explaining what's wrong.
 *
 * Authoritative ref: the value the team has confirmed is the live project.
 * In-tree sources checked (in priority order, most trustworthy first):
 *   1. supabase/.temp/linked-project.json  (structured, CLI-written)
 *   2. supabase/.temp/project-ref          (CLI-written single line)
 *   3. .env  VITE_SUPABASE_PROJECT_ID      (app runtime ref)
 *   4. supabase/config.toml  project_id    (CLI config — known to hold stale value)
 *
 * If source (1) or (2) is present, it is treated as the CLI's current truth and
 * must match the authoritative ref. If neither is present, the guard falls back
 * to .env and then config.toml.
 */

const fs = require('node:fs');
const path = require('node:path');

const LIVE_PROJECT_REF = 'lgtixzpjbkzapecirbfj';
const STALE_PROJECT_REF = 'kpszurxnzhivrvzmcded';

// ---- CLI arg parsing (tiny, no deps) ----
let root = process.cwd();
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root' && args[i + 1]) {
    root = path.resolve(args[i + 1]);
    i++;
  }
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

// ---- Source collectors ----

function readLinkedProjectJson(rootDir) {
  const raw = readFileSafe(path.join(rootDir, 'supabase', '.temp', 'linked-project.json'));
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return obj.ref || null;
  } catch {
    return null;
  }
}

function readProjectRefFile(rootDir) {
  const raw = readFileSafe(path.join(rootDir, 'supabase', '.temp', 'project-ref'));
  if (!raw) return null;
  return raw.trim() || null;
}

function readEnvProjectId(rootDir) {
  // .env may have VITE_SUPABASE_PROJECT_ID=value
  const raw = readFileSafe(path.join(rootDir, '.env'));
  if (!raw) return null;
  const m = raw.match(/^VITE_SUPABASE_PROJECT_ID\s*=\s*([^\s#]+)/m);
  return m ? m[1].trim() : null;
}

function readConfigTomlProjectId(rootDir) {
  // config.toml: project_id = "..."
  const raw = readFileSafe(path.join(rootDir, 'supabase', 'config.toml'));
  if (!raw) return null;
  const m = raw.match(/^project_id\s*=\s*"([^"]+)"/m);
  return m ? m[1].trim() : null;
}

// ---- Main ----

const linkedJsonRef = readLinkedProjectJson(root);
const projectRefFileRef = readProjectRefFile(root);
const envProjectId = readEnvProjectId(root);
const configTomlRef = readConfigTomlProjectId(root);

// CLI-written temp files are the strongest signal of what the CLI thinks it's talking to.
const cliTruth = linkedJsonRef || projectRefFileRef;

console.log('=== Supabase Project Ref Guard ===');
console.log(`Root: ${root}`);
console.log(`Live (authoritative) ref: ${LIVE_PROJECT_REF}`);
console.log(`Known stale ref:           ${STALE_PROJECT_REF}`);
console.log('');

const sources = [
  { name: 'supabase/.temp/linked-project.json  (CLI linked project)', value: linkedJsonRef },
  { name: 'supabase/.temp/project-ref          (CLI project-ref)', value: projectRefFileRef },
  { name: '.env  VITE_SUPABASE_PROJECT_ID', value: envProjectId },
  { name: 'supabase/config.toml  project_id', value: configTomlRef },
];

for (const s of sources) {
  const display = s.value || '(not present)';
  console.log(`  ${s.name.padEnd(52)} → ${display}`);
}
console.log('');

let blocked = false;

// Primary gate: CLI truth (if available) must match the live ref.
if (cliTruth) {
  if (cliTruth !== LIVE_PROJECT_REF) {
    blocked = true;
    console.log(`BLOCKED: CLI-linked project ref is "${cliTruth}", expected "${LIVE_PROJECT_REF}".`);
    console.log('Do NOT apply migrations or deploy edge functions until this is resolved.');
    if (cliTruth === STALE_PROJECT_REF) {
      console.log('');
      console.log('The CLI is pointing at the stale project. Re-link with:');
      console.log(`  supabase link --project-ref ${LIVE_PROJECT_REF}`);
      console.log('Then re-run this guard.');
    }
  } else {
    console.log(`CLI truth OK: "${cliTruth}" matches live ref.`);
  }
} else {
  // No CLI temp files — fall back to .env, then config.toml.
  if (envProjectId) {
    if (envProjectId !== LIVE_PROJECT_REF) {
      blocked = true;
      console.log(`BLOCKED: .env VITE_SUPABASE_PROJECT_ID is "${envProjectId}", expected "${LIVE_PROJECT_REF}".`);
    } else {
      console.log(`.env OK: "${envProjectId}" matches live ref.`);
    }
  } else if (configTomlRef) {
    if (configTomlRef !== LIVE_PROJECT_REF) {
      blocked = true;
      console.log(`BLOCKED: supabase/config.toml project_id is "${configTomlRef}", expected "${LIVE_PROJECT_REF}".`);
    } else {
      console.log(`config.toml OK: "${configTomlRef}" matches live ref.`);
    }
  } else {
    console.log('WARNING: No project ref source found (no CLI temp files, no .env, no config.toml).');
    console.log('Set VITE_SUPABASE_PROJECT_ID in .env or link the CLI before applying migrations.');
    blocked = true;
  }
}

// Secondary check: flag the known stale value even if the active ref is correct.
// This catches the case where config.toml still says the stale ref while the CLI is correct —
// a latent confusion risk for the next person who reads config.toml.
if (configTomlRef && configTomlRef !== LIVE_PROJECT_REF) {
  console.log('');
  console.log(`NOTE: supabase/config.toml still contains the stale ref "${configTomlRef}".`);
  console.log('The active ref appears correct (' + (cliTruth || envProjectId || configTomlRef) + '), but config.toml should be updated to avoid confusion.');
  console.log('Update it with:');
  console.log(`  sed -i.bak 's/project_id = "${configTomlRef}"/project_id = "${LIVE_PROJECT_REF}"/' supabase/config.toml`);
  console.log(`  (or edit supabase/config.toml manually, then re-run \`supabase status\`.)`);
}

// Tertiary check: warn if .env and CLI truth disagree (both present but different).
if (cliTruth && envProjectId && cliTruth !== envProjectId) {
  console.log('');
  console.log(`WARNING: .env (${envProjectId}) and CLI truth (${cliTruth}) disagree.`);
  console.log('Pick one source of truth and align the other — mismatch here means the app and the CLI may talk to different projects.');
}

console.log('');
console.log('=== End guard ===');

if (blocked) {
  process.exit(1);
}
process.exit(0);
