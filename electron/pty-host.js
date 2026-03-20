// This script runs in system Node.js (not Electron) to avoid ABI issues with node-pty.
// Communication with the Electron main process is via stdin/stdout JSON lines.

const pty = require("node-pty");
const {
  buildClaudeLaunchCommand,
  findClaudeBinary,
  getCliPath,
} = require("./claude-cli");

const sessions = new Map(); // id -> pty process
const buffers = new Map(); // id -> output buffer (circular)

const MAX_BUFFER = 200 * 1024; // 200KB per session

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function appendBuffer(id, data) {
  let buf = buffers.get(id) || "";
  buf += data;
  if (buf.length > MAX_BUFFER) {
    buf = buf.slice(buf.length - MAX_BUFFER);
  }
  buffers.set(id, buf);
}

const userPath = getCliPath();

function pickUtf8Locale(env = {}) {
  const candidates = [env.LC_CTYPE, env.LANG];
  for (const value of candidates) {
    if (
      typeof value === "string" &&
      /utf-?8/i.test(value) &&
      !/^C\.UTF-8$/i.test(value)
    ) {
      return value;
    }
  }
  return "en_US.UTF-8";
}

function buildPtyEnv(...sources) {
  const merged = Object.assign({}, ...sources);
  const locale = pickUtf8Locale(merged);
  delete merged.LC_ALL;
  merged.LANG = locale;
  merged.LC_CTYPE = locale;
  return merged;
}

function handleMessage(msg) {
  switch (msg.action) {
    case "spawn": {
        const {
          id,
          cwd,
        cols,
        rows,
        env,
        sessionId,
        isResume,
          autoConfirm,
          model,
          effortLevel,
        } = msg;
      try {
        const claudePath = findClaudeBinary();
        if (!claudePath) {
          throw new Error(
            "Claude Code CLI not found. Install it with npm install -g @anthropic-ai/claude-code",
          );
        }

        // Build a clean env for the PTY shell:
        // 1. Remove CLAUDECODE so claude CLI doesn't think it's nested
        // 2. Skip network guard (proxy preflight) to reuse existing auth
        // 3. Inherit proxy settings for API connectivity
        const defaultProxy = "http://127.0.0.1:7897";
        const cleanEnv = { ...process.env };
        delete cleanEnv.CLAUDECODE;  // Critical: prevent nested-session lockout
        const proc = pty.spawn("/bin/zsh", ["-l"], {
          name: "xterm-256color",
          cols: cols || 120,
          rows: rows || 30,
          cwd: cwd || process.env.HOME,
          env: buildPtyEnv(cleanEnv, env, {
            ...cleanEnv,
            ...env,
            PATH: userPath,
            TERM: "xterm-256color",
            CLAUDE_GUARD_SKIP: "1",
            HTTP_PROXY: process.env.HTTP_PROXY || defaultProxy,
            HTTPS_PROXY: process.env.HTTPS_PROXY || defaultProxy,
            http_proxy: process.env.http_proxy || defaultProxy,
            https_proxy: process.env.https_proxy || defaultProxy,
          }),
        });

        proc.onData((data) => {
          appendBuffer(id, data);
          send({ type: "output", id, data });
        });

        proc.onExit(({ exitCode }) => {
          if (sessions.get(id) === proc) {
            sessions.delete(id);
            send({ type: "exit", id, code: exitCode });
          }
        });

        sessions.set(id, proc);

        const launchCommand = buildClaudeLaunchCommand({
          claudePath,
          model,
          effortLevel,
          sessionId,
          isResume,
          autoConfirm,
        });
        setTimeout(() => {
          // Replace the login shell with Claude itself so a Claude exit
          // becomes a real PTY exit instead of dropping back to zsh.
          proc.write(`exec ${launchCommand}\r`);
        }, 500);

        send({ type: "spawned", id, success: true });
      } catch (err) {
        send({ type: "spawned", id, success: false, error: err.message });
      }
      break;
    }
    case "spawn-shell": {
      // Spawn a plain shell (no claude) for SSH, local terminal, etc.
      const { id: shId, cwd: shCwd, cols: shCols, rows: shRows, command: shCmd } = msg;
      try {
        const proc = pty.spawn("/bin/zsh", ["-l"], {
          name: "xterm-256color",
          cols: shCols || 120,
          rows: shRows || 30,
          cwd: shCwd || process.env.HOME,
          env: buildPtyEnv(process.env, {
            PATH: userPath,
            TERM: "xterm-256color",
          }),
        });
        proc.onData((data) => {
          appendBuffer(shId, data);
          send({ type: "output", id: shId, data });
        });
        proc.onExit(({ exitCode }) => {
          if (sessions.get(shId) === proc) {
            sessions.delete(shId);
            send({ type: "exit", id: shId, code: exitCode });
          }
        });
        sessions.set(shId, proc);
        if (shCmd) {
          setTimeout(() => proc.write(shCmd + "\r"), 300);
        }
        send({ type: "spawned", id: shId, success: true });
      } catch (err) {
        send({ type: "spawned", id: shId, success: false, error: err.message });
      }
      break;
    }
    case "write": {
      const proc = sessions.get(msg.id);
      if (proc) proc.write(msg.data);
      break;
    }
    case "resize": {
      const proc = sessions.get(msg.id);
      if (proc) proc.resize(msg.cols, msg.rows);
      break;
    }
    case "stop": {
      const proc = sessions.get(msg.id);
      if (proc) {
        proc.kill();
        sessions.delete(msg.id);
      }
      send({ type: "stopped", id: msg.id });
      break;
    }
    case "isRunning": {
      send({ type: "isRunning", id: msg.id, running: sessions.has(msg.id) });
      break;
    }
    case "getBuffer": {
      const buf = buffers.get(msg.id) || "";
      send({ type: "buffer", id: msg.id, data: buf });
      break;
    }
  }
}

// Read JSON lines from stdin
let buffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newlineIdx);
    buffer = buffer.slice(newlineIdx + 1);
    if (line.trim()) {
      try {
        handleMessage(JSON.parse(line));
      } catch (e) {
        // ignore parse errors
      }
    }
  }
});

process.on("SIGTERM", () => {
  for (const [, proc] of sessions) proc.kill();
  process.exit(0);
});

send({ type: "ready" });
