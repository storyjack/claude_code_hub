const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const { SessionManager } = require("./session-manager");
const store = require("./store");
const { runPreflight } = require("./preflight");
const { getClaudeStatus, loginClaude } = require("./claude-cli");

let mainWindow;
let sessionManager;
let ipcRegistered = false;

// Dev mode only when explicitly set (OPHUB_DEV=1)
// Default to production (load dist/index.html) so Dock launch works
const isDev = process.env.OPHUB_DEV === "1";

// Disable sandbox so node-pty can spawn PTY processes
app.commandLine.appendSwitch("no-sandbox");

function ensureSessionManager() {
  if (!sessionManager || sessionManager.destroyed) {
    sessionManager = new SessionManager();

    sessionManager.on("output", (threadId, data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("pty:output", threadId, data);
      }
    });

    sessionManager.on("exit", (threadId, code) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("pty:exit", threadId, code);
      }
    });
  }
}

function registerIPC() {
  if (ipcRegistered) return;
  ipcRegistered = true;

  // Data persistence
  ipcMain.handle("store:load", () => store.load());
  ipcMain.handle("store:save", (_, data) => {
    store.save(data);
    return true;
  });

  // Scan Claude Code projects from ~/.claude/projects/
  ipcMain.handle("store:scanClaudeProjects", () => store.scanClaudeProjects());

  // Scan sessions for a specific project
  ipcMain.handle("store:scanProjectSessions", (_, cwd) =>
    store.scanProjectSessions(cwd),
  );

  // Generate AI titles for sessions
  ipcMain.handle("store:generateTitle", (_, sessionId, summary) =>
    store.generateTitle(sessionId, summary),
  );
  ipcMain.handle("store:generateTitles", (_, sessions) =>
    store.generateTitles(sessions),
  );
  ipcMain.handle("store:loadTitleCache", () => store.loadTitleCache());
  ipcMain.handle("store:sessionExists", (_, cwd, sessionId) =>
    store.sessionExists(cwd, sessionId),
  );
  ipcMain.handle("store:loadSessionTranscript", (_, cwd, sessionId) =>
    store.loadSessionTranscript(cwd, sessionId),
  );
  ipcMain.handle("store:loadSessionTranscriptEntries", (_, cwd, sessionId) =>
    store.loadSessionTranscriptEntries(cwd, sessionId),
  );
  ipcMain.handle("claude:getStatus", () => getClaudeStatus());
  ipcMain.handle("claude:login", (_, email) => loginClaude({ email }));

  // Get initial CWD from ophub CLI argument (if launched with a directory)
  ipcMain.handle(
    "store:getInitialCwd",
    () => process.env.OPHUB_INITIAL_CWD || null,
  );

  // Input dialog
  ipcMain.handle("dialog:input", async (_, title, label, defaultValue) => {
    const { BrowserWindow: BW } = require("electron");
    const inputWin = new BW({
      width: 400,
      height: 180,
      parent: mainWindow,
      modal: true,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      titleBarStyle: "default",
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    return new Promise((resolve) => {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body{font-family:-apple-system,sans-serif;padding:20px;background:#f7f7f8;margin:0}
        h3{font-size:15px;margin:0 0 12px;font-weight:600}
        input{width:100%;padding:8px 10px;border:1px solid #d1d1d6;border-radius:6px;font-size:14px;box-sizing:border-box;outline:none}
        input:focus{border-color:#007aff}
        .btns{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
        button{padding:6px 16px;border-radius:6px;font-size:13px;cursor:pointer;border:1px solid #d1d1d6;background:white}
        button.primary{background:#1a1a1a;color:white;border-color:#1a1a1a}
      </style></head><body>
        <h3>${title || "输入"}</h3>
        <input id="inp" value="${defaultValue || ""}" placeholder="${label || ""}" autofocus/>
        <div class="btns">
          <button onclick="window.close()">取消</button>
          <button class="primary" onclick="submit()">确定</button>
        </div>
        <script>
          const inp=document.getElementById('inp');
          inp.select();
          inp.addEventListener('keydown',e=>{if(e.key==='Enter')submit();if(e.key==='Escape')window.close()});
          function submit(){
            const v=inp.value.trim();
            document.title='__RESULT__:'+v;
          }
        </script>
      </body></html>`;
      inputWin.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(html),
      );
      inputWin.once("ready-to-show", () => inputWin.show());
      inputWin.webContents.on("page-title-updated", (e, newTitle) => {
        if (newTitle.startsWith("__RESULT__:")) {
          const val = newTitle.slice("__RESULT__:".length);
          inputWin.close();
          resolve(val || null);
        }
      });
      inputWin.on("closed", () => resolve(null));
    });
  });

  // Directory picker
  ipcMain.handle("dialog:selectDirectory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "Select Project Directory",
      defaultPath: require("os").homedir(),
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Terminal process management — use arrow functions to always reference current sessionManager
  ipcMain.handle(
    "pty:spawn",
    (
      _,
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
    ) => {
      ensureSessionManager();
      return sessionManager.spawnSession(
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
      );
    },
  );
  ipcMain.handle("pty:spawnShell", (_, id, cwd, cols, rows, command) => {
    ensureSessionManager();
    return sessionManager.spawnShell(id, cwd, cols, rows, command);
  });
  ipcMain.handle("pty:write", (_, threadId, data) => {
    ensureSessionManager();
    return sessionManager.write(threadId, data);
  });
  ipcMain.handle("pty:resize", (_, threadId, cols, rows) => {
    ensureSessionManager();
    return sessionManager.resize(threadId, cols, rows);
  });
  ipcMain.handle("pty:stop", (_, threadId) => {
    ensureSessionManager();
    return sessionManager.stop(threadId);
  });
  ipcMain.handle("pty:isRunning", (_, threadId) => {
    ensureSessionManager();
    return sessionManager.isRunning(threadId);
  });
  ipcMain.handle("pty:getBuffer", (_, threadId) => {
    ensureSessionManager();
    return sessionManager.getBuffer(threadId);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: "Claude Code Hub",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  const debugCapturePath = process.env.OPHUB_DEBUG_CAPTURE || null;
  const debugScriptPath = process.env.OPHUB_DEBUG_SCRIPT || null;
  const debugResultPath = process.env.OPHUB_DEBUG_RESULT || null;
  const debugAutoClose = process.env.OPHUB_DEBUG_AUTOCLOSE === "1";

  async function runDebugHooks() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      if (debugCapturePath) {
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(debugCapturePath, image.toPNG());
      }
      if (debugScriptPath && fs.existsSync(debugScriptPath)) {
        const script = fs.readFileSync(debugScriptPath, "utf-8");
        const result = await mainWindow.webContents.executeJavaScript(
          script,
          true,
        );
        if (debugResultPath) {
          fs.writeFileSync(
            debugResultPath,
            typeof result === "string"
              ? result
              : JSON.stringify(result, null, 2),
            "utf-8",
          );
        }
      }
    } catch (error) {
      if (debugResultPath) {
        fs.writeFileSync(
          debugResultPath,
          JSON.stringify({ error: error?.message || String(error) }, null, 2),
          "utf-8",
        );
      }
    } finally {
      if (debugAutoClose) {
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.close();
          }
        }, 300);
      }
    }
  }

  if (debugCapturePath || debugScriptPath) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        runDebugHooks();
      }, 1200);
    });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  registerIPC();

  // Run dependency check before starting
  const preflight = await runPreflight(null);
  if (!preflight.ok && !preflight.skipped) {
    // User closed setup without completing - quit
    app.quit();
    return;
  }

  ensureSessionManager();
  createWindow();
});

app.on("window-all-closed", () => {
  // On macOS, keep sessions alive so reopening the window can reconnect
  if (process.platform !== "darwin") {
    if (sessionManager) sessionManager.destroyAll();
    app.quit();
  }
});

app.on("activate", () => {
  ensureSessionManager();
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  // Clean up all sessions when actually quitting
  if (sessionManager) sessionManager.destroyAll();
});
