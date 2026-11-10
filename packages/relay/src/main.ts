/**
 * meshchat-relay — CLI entry point.
 *
 *   node relay.mjs --port 8787 --data ./data --pow 16
 *
 * Everything is configurable through flags or MESHCHAT_* environment
 * variables, which is what the Docker image and the Fly/Railway templates use.
 */
import { Relay, defaultConfig, type RelayConfig } from './server';

function parseArgs(argv: string[]): RelayConfig {
  const config = defaultConfig();
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('-')) {
      console.warn(`ignoring positional argument "${raw}"`);
      continue;
    }
    // supports both `--port 8787` and `--port=8787`
    let key = raw;
    let inline: string | undefined;
    const eq = raw.indexOf('=');
    if (eq > 0) {
      key = raw.slice(0, eq);
      inline = raw.slice(eq + 1);
    }
    const next = () => inline ?? argv[++i];
    switch (key) {
      case '--port':
      case '-p':
        config.port = Number(next());
        break;
      case '--host':
        config.host = String(next());
        break;
      case '--pow':
        config.pow = Number(next());
        break;
      case '--name':
        config.name = String(next());
        break;
      case '--data':
        config.dataDir = String(next());
        break;
      case '--static':
        config.staticDir = String(next());
        break;
      case '--ttl-days':
        config.ttlMs = Number(next()) * 24 * 3600_000;
        break;
      case '--log':
        config.logRequests = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        console.warn(`unknown flag ${key} (see --help)`);
    }
  }
  if (!Number.isFinite(config.port)) {
    console.warn('invalid --port, falling back to 8787');
    config.port = 8787;
  }
  return config;
}

function printHelp(): void {
  console.log(`meshchat-relay — zero-knowledge mailbox for MeshChat

Usage: meshchat-relay [options]

  -p, --port <n>        port to listen on            (default 8787)
      --host <addr>     bind address                 (default 0.0.0.0)
      --pow <bits>      proof-of-work difficulty     (default 16, 0 = off)
      --ttl-days <n>    how long to keep envelopes   (default 7)
      --data <dir>      persist to disk              (default: memory only)
      --static <dir>    directory with the built UI  (default ./public)
      --name <label>    relay name shown in clients
      --log             log request lines (off by default: no IPs in logs!)
  -h, --help            this text

Environment: MESHCHAT_PORT, MESHCHAT_HOST, MESHCHAT_POW, MESHCHAT_TTL_DAYS,
             MESHCHAT_DATA, MESHCHAT_STATIC, MESHCHAT_NAME, MESHCHAT_LOG=1`);
}

function banner(config: RelayConfig): void {
  const addr = `${config.host}:${config.port}`;
  console.log(`
  ███╗   ███╗███████╗███████╗██╗  ██╗ ██████╗██╗  ██╗ █████╗ ████████╗
  ████╗ ████║██╔════╝██╔════╝██║  ██║██╔════╝██║  ██║██╔══██╗╚══██╔══╝
  ██╔████╔██║█████╗  ███████╗███████║██║     ███████║███████║   ██║
  ██║╚██╔╝██║██╔══╝  ╚════██║██╔══██║██║     ██╔══██║██╔══██║   ██║
  ██║ ╚═╝ ██║███████╗███████║██║  ██║╚██████╗██║  ██║██║  ██║   ██║
  ╚═╝     ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝
  relay ${config.version} · zero-knowledge mailbox
`);
  console.log(`  listening      http://${addr}`);
  console.log(`  websocket      ws://${addr}/v1/ws`);
  console.log(`  proof of work  ${config.pow ? `${config.pow} bits` : 'disabled'}`);
  console.log(`  envelope TTL   ${Math.round(config.ttlMs / 3600_000)} h`);
  console.log(`  storage        ${config.dataDir ? `${config.dataDir} (journal)` : 'memory only'}`);
  console.log(`  ui             ${config.staticDir}`);
  console.log('');
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const relay = new Relay(config);
  await relay.listen();
  relay.startTimers();
  banner(config);
  const shutdown = async (signal: string) => {
    console.log(`\n${signal}: flushing and shutting down…`);
    await relay.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
