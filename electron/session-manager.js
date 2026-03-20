const EventEmitter = require("events");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { app } = require("electron");
const { getSystemProxyEnv } = require("./proxy-env");

const isDev = !app.isPackaged && !process.env.OPHUB_PRODUCTION;

function ensureHomeBinFirst(currentPath) {
  const homeBin = path.join(os.homedir(), "bin");
  if (!fs.existsSync(homeBin)) {
    return currentPath;
  }

  const entries = (currentPath || "").split(":").filter(Boolean);
  const filtered = entries.filter((entry) => entry !== homeBin);
  return [homeBin, ...filtered].join(":");
}

// Get the user's full shell PATH
function getUserPath() {
  let p = process.env.PATH || "";
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    p = require("child_process")
      .execSync(`${shell} -ilc "echo \\$PATH"`, {
        encoding: "utf-8",
        timeout: 5000,
      })
      .trim();
  } catch (e) {
    const extra = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];
    const current = new Set(p.split(":"));
    for (const x of extra) {
      if (!current.has(x)) p += ":" + x;
    }
  }
  return ensureHomeBinFirst(p);
}

// Find system Node.js binary (for dev mode)
function findSystemNode() {
  const candidates = [
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
    "/usr/bin/node",
  ];
  const fs = require("fs");
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  try {
    return execSync("which node", { encoding: "utf-8" }).trim();
  } catch (e) {
    return "node";
  }
}

class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.host = null;
    this.pendingCallbacks = new Map();
    this.callbackId = 0;
    this.runningSet = new Set();
    this.destroyed = false;
    this._startHost();
  }

  _startHost() {
    const hostScript = path.join(__dirname, "pty-host.js");

    let nodeBin;
    let envExtra = {};

    if (isDev) {
      // Dev mode: use system node (node-pty built for system Node ABI)
      nodeBin = findSystemNode();
      envExtra = {
        NODE_PATH: path.join(__dirname, "..", "node_modules"),
      };
    } else {
      // Packaged mode: use Electron binary as Node
      // ELECTRON_RUN_AS_NODE=1 makes it behave as plain Node.js
      // node-pty was rebuilt for Electron's ABI by electron-builder
      nodeBin = process.execPath;
      envExtra = {
        ELECTRON_RUN_AS_NODE: "1",
        NODE_PATH: path.join(process.resourcesPath, "app", "node_modules"),
      };
    }

    console.log(
      "[pty-host] mode:",
      isDev ? "dev" : "packaged",
      "| node:",
      nodeBin,
    );

    this.host = spawn(nodeBin, [hostScript], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...envExtra,
        ...getSystemProxyEnv(process.env),
        PATH: getUserPath(),
        CLAUDECODE: "", // prevent nested session error
      },
    });

    this.host.stderr.on("data", (data) => {
      console.error("[pty-host stderr]", data.toString());
    });

    const rl = readline.createInterface({ input: this.host.stdout });
    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        this._handleMessage(msg);
      } catch (e) {
        // ignore
      }
    });

    this.host.on("exit", (code) => {
      console.error("[pty-host] exited with code", code);
      this.host = null;
      // Notify frontend that ALL running sessions are dead
      for (const id of this.runningSet) {
        this.emit("exit", id, code);
      }
      this.runningSet.clear();
    });
  }

  _send(msg) {
    if (this.host && this.host.stdin && !this.host.stdin.destroyed) {
      this.host.stdin.write(JSON.stringify(msg) + "\n");
    }
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case "ready":
        console.log("[pty-host] ready");
        break;
      case "output":
        this.emit("output", msg.id, msg.data);
        break;
      case "exit":
        this.runningSet.delete(msg.id);
        this.emit("exit", msg.id, msg.code);
        break;
      case "spawned":
        if (msg.success) {
          this.runningSet.add(msg.id);
        }
        const spawnCb = this.pendingCallbacks.get("spawn_" + msg.id);
        if (spawnCb) {
          this.pendingCallbacks.delete("spawn_" + msg.id);
          spawnCb(msg);
        }
        break;
      case "isRunning":
        const runCb = this.pendingCallbacks.get("isRunning_" + msg.id);
        if (runCb) {
          this.pendingCallbacks.delete("isRunning_" + msg.id);
          runCb(msg.running);
        }
        break;
      case "stopped":
        this.runningSet.delete(msg.id);
        this.emit("exit", msg.id, msg.code ?? null);
        break;
      case "buffer": {
        const bufCb = this.pendingCallbacks.get("buffer_" + msg.id);
        if (bufCb) {
          this.pendingCallbacks.delete("buffer_" + msg.id);
          bufCb(msg.data);
        }
        break;
      }
    }
  }

  spawnSession(
    threadId,
    cwd,
    cols,
    rows,
    sessionId,
    isResume,
    autoConfirm,
    projectEnv,
    model,
    effortLevel,
  ) {
    return new Promise((resolve) => {
      this.pendingCallbacks.set("spawn_" + threadId, (msg) => {
        resolve({ success: msg.success, error: msg.error });
      });
      this._send({
        action: "spawn",
        id: threadId,
        cwd,
        cols,
        rows,
        env: { ...(projectEnv || {}) },
        sessionId,
        isResume: !!isResume,
        autoConfirm: !!autoConfirm,
        model: model || "",
        effortLevel: effortLevel || "",
      });
    });
  }

  spawnShell(id, cwd, cols, rows, command) {
    return new Promise((resolve) => {
      this.pendingCallbacks.set("spawn_" + id, (msg) => {
        resolve({ success: msg.success, error: msg.error });
      });
      this._send({
        action: "spawn-shell",
        id,
        cwd: cwd || process.env.HOME,
        cols,
        rows,
        command: command || "",
      });
    });
  }

  getBuffer(threadId) {
    return new Promise((resolve) => {
      this.pendingCallbacks.set("buffer_" + threadId, resolve);
      this._send({ action: "getBuffer", id: threadId });
      setTimeout(() => {
        if (this.pendingCallbacks.has("buffer_" + threadId)) {
          this.pendingCallbacks.delete("buffer_" + threadId);
          resolve("");
        }
      }, 1000);
    });
  }

  write(threadId, data) {
    this._send({ action: "write", id: threadId, data });
    return true;
  }

  resize(threadId, cols, rows) {
    this._send({ action: "resize", id: threadId, cols, rows });
    return true;
  }

  stop(threadId) {
    this._send({ action: "stop", id: threadId });
    this.runningSet.delete(threadId);
    return true;
  }

  isRunning(threadId) {
    return new Promise((resolve) => {
      this.pendingCallbacks.set("isRunning_" + threadId, resolve);
      this._send({ action: "isRunning", id: threadId });
      setTimeout(() => {
        if (this.pendingCallbacks.has("isRunning_" + threadId)) {
          this.pendingCallbacks.delete("isRunning_" + threadId);
          resolve(this.runningSet.has(threadId));
        }
      }, 1000);
    });
  }

  destroyAll() {
    this.destroyed = true;
    if (this.host) {
      this.host.kill("SIGTERM");
      this.host = null;
    }
  }
}

module.exports = { SessionManager };
