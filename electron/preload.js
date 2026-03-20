const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  store: {
    load: () => ipcRenderer.invoke("store:load"),
    save: (data) => ipcRenderer.invoke("store:save", data),
    scanClaudeProjects: () => ipcRenderer.invoke("store:scanClaudeProjects"),
    scanProjectSessions: (cwd) =>
      ipcRenderer.invoke("store:scanProjectSessions", cwd),
    getInitialCwd: () => ipcRenderer.invoke("store:getInitialCwd"),
    generateTitle: (sessionId, summary) =>
      ipcRenderer.invoke("store:generateTitle", sessionId, summary),
    generateTitles: (sessions) =>
      ipcRenderer.invoke("store:generateTitles", sessions),
    loadTitleCache: () => ipcRenderer.invoke("store:loadTitleCache"),
    sessionExists: (cwd, sessionId) =>
      ipcRenderer.invoke("store:sessionExists", cwd, sessionId),
    loadSessionTranscript: (cwd, sessionId) =>
      ipcRenderer.invoke("store:loadSessionTranscript", cwd, sessionId),
    loadSessionTranscriptEntries: (cwd, sessionId) =>
      ipcRenderer.invoke("store:loadSessionTranscriptEntries", cwd, sessionId),
  },
  claude: {
    getStatus: () => ipcRenderer.invoke("claude:getStatus"),
    login: (email) => ipcRenderer.invoke("claude:login", email),
  },
  selectDirectory: () => ipcRenderer.invoke("dialog:selectDirectory"),
  inputDialog: (title, label, defaultValue) =>
    ipcRenderer.invoke("dialog:input", title, label, defaultValue),
  pty: {
    spawn: (
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
    ) =>
      ipcRenderer.invoke(
        "pty:spawn",
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
      ),
    spawnShell: (id, cwd, cols, rows, command) =>
      ipcRenderer.invoke("pty:spawnShell", id, cwd, cols, rows, command),
    getBuffer: (threadId) => ipcRenderer.invoke("pty:getBuffer", threadId),
    write: (threadId, data) => ipcRenderer.invoke("pty:write", threadId, data),
    resize: (threadId, cols, rows) =>
      ipcRenderer.invoke("pty:resize", threadId, cols, rows),
    stop: (threadId) => ipcRenderer.invoke("pty:stop", threadId),
    isRunning: (threadId) => ipcRenderer.invoke("pty:isRunning", threadId),
    onOutput: (callback) => {
      const listener = (_, threadId, data) => callback(threadId, data);
      ipcRenderer.on("pty:output", listener);
      return () => ipcRenderer.removeListener("pty:output", listener);
    },
    onExit: (callback) => {
      const listener = (_, threadId, code) => callback(threadId, code);
      ipcRenderer.on("pty:exit", listener);
      return () => ipcRenderer.removeListener("pty:exit", listener);
    },
  },
});
