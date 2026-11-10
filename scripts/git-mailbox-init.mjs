#!/usr/bin/env node
/**
 * Turns a GitHub repository into a MeshChat mailbox (the "free server" trick).
 *
 *   npm run git:init -- --owner you --repo mesh-mailbox --token github_pat_…
 *   npm run git:init -- --owner you --repo mesh-mailbox --token … --branch meshchat
 *
 * It creates the branch, keeps the default branch untouched, and drops a short
 * README into the mailbox folder. Everything MeshChat writes there is
 * ciphertext; the repo can be public or private.
 */
import process from 'node:process';

const API = 'https://api.github.com';

function parseArgs(argv) {
  const out = { branch: 'meshchat', path: 'box' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--owner' || arg === '-o') out.owner = next();
    else if (arg === '--repo' || arg === '-r') out.repo = next();
    else if (arg === '--token' || arg === '-t') out.token = next();
    else if (arg === '--branch' || arg === '-b') out.branch = next();
    else if (arg === '--path') out.path = next();
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function usage() {
  console.log(`meshchat git:init — prepare a GitHub repository as a mailbox

  --owner, -o   repository owner (user or org)
  --repo,  -r   repository name
  --token, -t   fine-grained token with Contents: Read & write on this repo
  --branch,-b   mailbox branch (default: meshchat)
  --path        mailbox folder inside the branch (default: box)

The token only needs access to this single repository. MeshChat stores it
locally in your browser and never sends it anywhere except api.github.com.`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}
if (!args.owner || !args.repo || !args.token) {
  usage();
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${args.token}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body, headers: res.headers };
}

async function main() {
  console.log(`→ checking access to ${args.owner}/${args.repo}`);
  const repo = await api(`/repos/${args.owner}/${args.repo}`);
  if (repo.status === 401) throw new Error('token rejected (401) — check the token value');
  if (repo.status === 403) throw new Error('token lacks permissions (403) — need Contents: Read & write');
  if (repo.status === 404) throw new Error('repository not found (404) — check owner/repo and token scope');
  if (!repo.ok) throw new Error(`GitHub API error ${repo.status}`);
  console.log(`  ✓ ${repo.body.full_name} · private=${repo.body.private} · default=${repo.body.default_branch}`);

  const branch = await api(`/repos/${args.owner}/${args.repo}/branches/${encodeURIComponent(args.branch)}`);
  if (branch.status === 404) {
    console.log(`→ creating branch "${args.branch}"`);
    const base = await api(`/repos/${args.owner}/${args.repo}/git/ref/heads/${repo.body.default_branch}`);
    if (!base.ok) throw new Error(`cannot read default branch: ${base.status}`);
    const created = await api(`/repos/${args.owner}/${args.repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${args.branch}`, sha: base.body.object.sha }),
    });
    if (!created.ok) throw new Error(`cannot create branch: ${created.status} ${JSON.stringify(created.body)}`);
    console.log('  ✓ branch created from default');
  } else if (branch.ok) {
    console.log(`  ✓ branch "${args.branch}" already exists`);
  }

  const readmePath = `${args.path}/README.md`;
  const existing = await api(
    `/repos/${args.owner}/${args.repo}/contents/${encodeURIComponent(readmePath)}?ref=${encodeURIComponent(args.branch)}`,
  );
  if (existing.status === 404) {
    const content = [
      '# MeshChat mailbox',
      '',
      'This repository is used as a transport for MeshChat.',
      '',
      'Every file inside `box/<routing-tag>/` is an **end-to-end encrypted** envelope.',
      'Nothing here can be read without the recipient private key.',
      '',
      'You can make this repository public: the content is ciphertext, and the',
      'routing tags are derived from public keys without revealing them.',
      '',
      'Created by `npm run git:init`.',
      '',
    ].join('\n');
    const put = await api(`/repos/${args.owner}/${args.repo}/contents/${encodeURIComponent(readmePath)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'meshchat: initialise mailbox',
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch: args.branch,
      }),
    });
    if (!put.ok) throw new Error(`cannot write README: ${put.status} ${JSON.stringify(put.body)}`);
    console.log(`  ✓ wrote ${readmePath}`);
  } else {
    console.log(`  ✓ ${readmePath} already present`);
  }

  const remaining = repo.headers.get('x-ratelimit-remaining');
  console.log(`
ready. Now paste these into MeshChat → Settings → Git repository:

  owner   ${args.owner}
  repo    ${args.repo}
  branch  ${args.branch}
  token   (the one you just used — it stays on this device)

Remaining GitHub API calls this hour: ${remaining ?? 'n/a'}
Polling one mailbox ≈ 8 requests/minute; a single token is plenty.`);
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
