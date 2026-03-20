import React, { useState, useEffect, useRef, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import TerminalView, {
  clearTerminalContent,
  destroyTerminal,
  ensureTerminal,
  replaceTerminalContent,
} from "./components/TerminalView";
import EmptyState from "./components/EmptyState";
import ProjectSettings from "./components/ProjectSettings";
import SnapshotPanel from "./components/SnapshotPanel";
import UsageStats from "./components/UsageStats";
import BottomTerminal from "./components/SshPanel";
import ModelSelector from "./components/ModelSelector";
import AppSettings from "./components/AppSettings";
import { AppContext } from "./AppContext";
import { t } from "./i18n";
import {
  getDefaultModelConfig,
  getThreadSortTimestamp,
  normalizeModelConfig,
  normalizeModelId,
} from "./lib/claudeConfig";

// Browser fallback: when not running inside Electron, mock window.api
if (!window.api) {
  window.api = {
    store: {
      load: async () => ({ projects: [] }),
      save: async () => true,
      scanClaudeProjects: async () => [],
      scanProjectSessions: async () => [],
      generateTitle: async () => null,
      generateTitles: async () => ({}),
      loadTitleCache: async () => ({}),
      sessionExists: async () => false,
      loadSessionTranscript: async () => "",
      loadSessionTranscriptEntries: async () => [],
    },
    claude: {
      getStatus: async () => ({
        installed: false,
        loggedIn: false,
        needsLogin: true,
        authError: "Not in Electron",
      }),
      login: async () => ({ success: false, error: "Not in Electron" }),
    },
    selectDirectory: async () => null,
    inputDialog: async (title, label, def) => prompt(label, def),
    pty: {
      spawn: async () => ({ success: false, error: "Not in Electron" }),
      spawnShell: async () => ({ success: false, error: "Not in Electron" }),
      getBuffer: async () => "",
      write: () => {},
      resize: () => {},
      stop: () => {},
      isRunning: async () => false,
      onOutput: () => () => {},
      onExit: () => () => {},
    },
  };
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return mins + " 分钟";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + " 小时";
  const days = Math.floor(hours / 24);
  if (days < 7) return days + " 天";
  const weeks = Math.floor(days / 7);
  return weeks + " 周";
}

function getThreadListOrder(thread, fallback = 0) {
  return Number.isFinite(thread?.listOrder) ? thread.listOrder : fallback;
}

function getNextThreadListOrder(project) {
  return (project?.threads || []).reduce(
    (max, thread) => Math.max(max, getThreadListOrder(thread)),
    0,
  ) + 1;
}

function normalizeProject(project) {
  const threads = Array.isArray(project.threads) ? project.threads : [];
  return {
    ...project,
    env: project.env || {},
    settings: project.settings || { shell: "/bin/zsh" },
    deletedSessionIds: Array.from(
      new Set(
        (Array.isArray(project.deletedSessionIds)
          ? project.deletedSessionIds
          : []
        ).filter(Boolean),
      ),
    ),
    threads: threads.map((thread, index) => ({
      ...thread,
      hasUnread: !!thread.hasUnread,
      listOrder: getThreadListOrder(thread, threads.length - index),
    })),
  };
}

// Parse token/cost info from Claude Code terminal output (best-effort)
function parseUsageFromChunk(text) {
  const result = {};
  // Match patterns like "input: 1,234" or "Input tokens: 1234"
  const inputMatch = text.match(
    /input[\s:]*tokens?[\s:]*(\d[\d,]*)|(\d[\d,]*)\s*input\s*tokens?/i,
  );
  if (inputMatch) {
    result.inputTokens = parseInt(
      (inputMatch[1] || inputMatch[2]).replace(/,/g, ""),
    );
  }
  // Match "output: 1,234" or "Output tokens: 1234"
  const outputMatch = text.match(
    /output[\s:]*tokens?[\s:]*(\d[\d,]*)|(\d[\d,]*)\s*output\s*tokens?/i,
  );
  if (outputMatch) {
    result.outputTokens = parseInt(
      (outputMatch[1] || outputMatch[2]).replace(/,/g, ""),
    );
  }
  // Match cost like "$0.12" or "cost: $1.23"
  const costMatch = text.match(/\$(\d+\.?\d*)/);
  if (costMatch) {
    result.cost = parseFloat(costMatch[1]);
  }
  return Object.keys(result).length > 0 ? result : null;
}

function stripAnsi(text = "") {
  return String(text).replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(\u0007|\u001b\\)|\u001b[@-_]/g,
    "",
  );
}

function looksLikeClaudePrompt(text = "") {
  const normalized = stripAnsi(text).replace(/\r/g, "");
  return (
    /Try\s*"/.test(normalized) ||
    /for\s*shortcuts/i.test(normalized) ||
    /bypass\s*permissions\s*on/i.test(normalized) ||
    /shift\+tab\s*to\s*cycle/i.test(normalized) ||
    /image\s*in\s*clipboard/i.test(normalized)
  );
}

const CLAUDE_AUTH_ERROR_RE =
  /OAuth token has expired|Please run \/login|authentication_error/i;
const DEFAULT_MODEL_CONFIG = getDefaultModelConfig();
const DEFAULT_APP_SETTINGS = {
  language: "zh",
  layout: "sidebar-left",
  defaultModel: DEFAULT_MODEL_CONFIG.model,
  terminalFontSize: 13,
  darkMode: false,
};

function recordStartupTrace(event, details = {}) {
  if (typeof window === "undefined") return;
  try {
    const payload = {
      at: new Date().toISOString(),
      event,
      ...details,
    };
    const next = [...(window.__ophubStartupTrace || []), payload];
    window.__ophubStartupTrace = next.slice(-100);
  } catch {}
}

export default function App() {
  const [projects, setProjects] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [threadPreviewContent, setThreadPreviewContent] = useState({});
  const [threadPreviewEntries, setThreadPreviewEntries] = useState({});
  const restoreTarget = useRef(null); // Last selected session to auto-select on startup
  const restoreTimerRef = useRef(null);
  const restoreApplyScheduledRef = useRef(false);
  const [runningThreads, setRunningThreads] = useState(new Set());
  const [processingThreads, setProcessingThreads] = useState(new Set());
  const [runningOrder, setRunningOrder] = useState({});
  const [settingsProject, setSettingsProject] = useState(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [showUsageStats, setShowUsageStats] = useState(false);
  const [showAppSettings, setShowAppSettings] = useState(false);
  const [claudeStatus, setClaudeStatus] = useState({
    loading: true,
    installed: false,
    loggedIn: false,
    needsLogin: true,
    authError: null,
    email: null,
    version: null,
  });
  const [claudeBusy, setClaudeBusy] = useState(false);
  const [appSettings, setAppSettings] = useState(() => {
    try {
      const saved = localStorage.getItem("hub-app-settings");
      if (!saved) return DEFAULT_APP_SETTINGS;
      const parsed = JSON.parse(saved);
      return {
        ...DEFAULT_APP_SETTINGS,
        ...parsed,
        defaultModel: normalizeModelId(
          parsed.defaultModel || DEFAULT_APP_SETTINGS.defaultModel,
        ),
      };
    } catch {
      return DEFAULT_APP_SETTINGS;
    }
  });
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem("hub-dark-mode") === "true";
    } catch {
      return false;
    }
  });
  const [modelConfig, setModelConfig] = useState(() => {
    try {
      const saved = localStorage.getItem("hub-model-config");
      return normalizeModelConfig(
        saved ? JSON.parse(saved) : DEFAULT_MODEL_CONFIG,
      );
    } catch {
      return DEFAULT_MODEL_CONFIG;
    }
  });
  const [sshSessions, setSshSessions] = useState(() => {
    try {
      const saved = localStorage.getItem("hub-ssh-hosts");
      return saved ? JSON.parse(saved) : [
        { id: "ssh-default", host: "", label: "终端" },
      ];
    } catch {
      return [{ id: "ssh-default", host: "", label: "终端" }];
    }
  });
  const [activeSshId, setActiveSshId] = useState(null);
  const [sshPanelHeight, setSshPanelHeight] = useState(() => {
    try { return parseInt(localStorage.getItem("hub-ssh-height")) || 250; } catch { return 250; }
  });
  const isDraggingSshPanel = useRef(false);
  const loaded = useRef(false);
  // Ref to track usage updates without causing re-renders on every output chunk
  const usageBufferRef = useRef({});
  const pendingUnreadThreadsRef = useRef(new Set());
  const pendingResumeMessagesRef = useRef({});
  const activeThreadIdRef = useRef(activeThreadId);
  const modelConfigRef = useRef(modelConfig);
  const outputTailRef = useRef({});

  useEffect(() => {
    modelConfigRef.current = modelConfig;
  }, [modelConfig]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
    recordStartupTrace("active-thread-changed", { activeThreadId });
  }, [activeThreadId]);

  useEffect(() => {
    return () => {
      if (restoreTimerRef.current) {
        window.clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
    };
  }, []);

  const markThreadRunning = useCallback((threadId, startedAt = Date.now()) => {
    setRunningThreads((prev) => {
      if (prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.add(threadId);
      return next;
    });
    setRunningOrder((prev) => {
      if (prev[threadId]) return prev;
      return { ...prev, [threadId]: startedAt };
    });
  }, []);

  const markThreadProcessing = useCallback((threadId) => {
    setProcessingThreads((prev) => {
      if (prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.add(threadId);
      return next;
    });
  }, []);

  const clearThreadProcessing = useCallback((threadId) => {
    setProcessingThreads((prev) => {
      if (!prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.delete(threadId);
      return next;
    });
  }, []);

  const preserveThreadRunningOrder = useCallback((threadId, sortTimestamp = 0) => {
    setRunningThreads((prev) => {
      if (prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.add(threadId);
      return next;
    });
    setRunningOrder((prev) => {
      if (threadId in prev) return prev;
      return { ...prev, [threadId]: sortTimestamp };
    });
  }, []);

  const clearThreadRunning = useCallback((threadId) => {
    setRunningThreads((prev) => {
      if (!prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.delete(threadId);
      return next;
    });
    setProcessingThreads((prev) => {
      if (!prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.delete(threadId);
      return next;
    });
    setRunningOrder((prev) => {
      if (!(threadId in prev)) return prev;
      const next = { ...prev };
      delete next[threadId];
      return next;
    });
    delete outputTailRef.current[threadId];
    delete pendingResumeMessagesRef.current[threadId];
  }, []);

  const clearThreadUnread = useCallback((threadId) => {
    if (!threadId) return;
    pendingUnreadThreadsRef.current.delete(threadId);
    setProjects((prev) =>
      prev.map((p) => ({
        ...p,
        threads: p.threads.map((t) =>
          t.id === threadId && t.hasUnread ? { ...t, hasUnread: false } : t,
        ),
      })),
    );
  }, []);

  const clearThreadPreview = useCallback((threadId) => {
    if (!threadId) return;
    setThreadPreviewContent((prev) => {
      if (!(threadId in prev)) return prev;
      const next = { ...prev };
      delete next[threadId];
      return next;
    });
    setThreadPreviewEntries((prev) => {
      if (!(threadId in prev)) return prev;
      const next = { ...prev };
      delete next[threadId];
      return next;
    });
  }, []);

  const trackInteraction = useCallback((threadId) => {
    markThreadProcessing(threadId);
    setProjects((prev) =>
      prev.map((p) => ({
        ...p,
        threads: p.threads.map((t) =>
          t.id === threadId
            ? {
                ...t,
                lastActiveAt: Date.now(),
                usage: {
                  ...(t.usage || {}),
                  interactions: ((t.usage || {}).interactions || 0) + 1,
                },
              }
            : t,
        ),
      })),
    );
  }, [markThreadProcessing]);

  const syncRunningThreads = useCallback(async (projectList) => {
    const running = [];
    for (const project of projectList) {
      for (const thread of project.threads || []) {
        if (await window.api.pty.isRunning(thread.id)) {
          running.push(thread);
        }
      }
    }
    running.sort(
      (a, b) =>
        getThreadSortTimestamp(b) - getThreadSortTimestamp(a),
    );
    const now = Date.now();
    setRunningThreads(new Set(running.map((thread) => thread.id)));
    setProcessingThreads(new Set());
    setRunningOrder(
      Object.fromEntries(
        running.map((thread, index) => [thread.id, now - index]),
      ),
    );
  }, []);

  // Sidebar resizable width
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      return parseInt(localStorage.getItem("hub-sidebar-width")) || 320;
    } catch {
      return 320;
    }
  });
  const isDraggingSidebar = useRef(false);

  const handleSidebarDragStart = useCallback((e) => {
    e.preventDefault();
    isDraggingSidebar.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev) => {
      if (!isDraggingSidebar.current) return;
      const newWidth = Math.min(Math.max(ev.clientX, 200), 600);
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isDraggingSidebar.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  // SSH panel vertical drag handler
  const handleSshDragStart = useCallback((e) => {
    e.preventDefault();
    isDraggingSshPanel.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    const onMouseMove = (ev) => {
      if (!isDraggingSshPanel.current) return;
      const newH = Math.min(Math.max(window.innerHeight - ev.clientY, 100), 600);
      setSshPanelHeight(newH);
    };
    const onMouseUp = () => {
      isDraggingSshPanel.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  // Persist sidebar width
  useEffect(() => {
    try {
      localStorage.setItem("hub-sidebar-width", sidebarWidth.toString());
    } catch {}
  }, [sidebarWidth]);

  // Persist SSH panel height
  useEffect(() => {
    try { localStorage.setItem("hub-ssh-height", sshPanelHeight.toString()); } catch {}
  }, [sshPanelHeight]);

  // Persist model config
  useEffect(() => {
    try {
      localStorage.setItem("hub-model-config", JSON.stringify(modelConfig));
    } catch {}
  }, [modelConfig]);

  const getThreadContext = useCallback(
    (threadId) => {
      for (const project of projects) {
        const thread = project.threads.find((item) => item.id === threadId);
        if (thread) {
          return { project, thread };
        }
      }
      return { project: null, thread: null };
    },
    [projects],
  );

  const relaunchThreadWithConfig = useCallback(
    async (threadId, config) => {
      if (!threadId) return false;
      const nextConfig = normalizeModelConfig(config);
      const { project, thread } = getThreadContext(threadId);
      if (!project || !thread || !thread.claudeSessionId) return false;

      const inst = ensureTerminal(threadId);
      const cols = inst.term.cols || 120;
      const rows = inst.term.rows || 30;
      const canResume = await window.api.store.sessionExists(
        project.cwd,
        thread.claudeSessionId,
      );

      window.api.pty.stop(threadId);
      clearThreadRunning(threadId);
      clearThreadPreview(threadId);
      if (inst.hasStaticTranscript) {
        clearTerminalContent(threadId);
      }

      const result = await window.api.pty.spawn(
        threadId,
        project.cwd,
        cols,
        rows,
        thread.claudeSessionId,
        !!canResume,
        !!thread.autoConfirm,
        getProjectEnv(project),
        nextConfig.model,
        nextConfig.effortLevel,
      );

      if (result?.success) {
        markThreadRunning(threadId);
        markThreadProcessing(threadId);
        return true;
      }
      return false;
    },
    [clearThreadPreview, clearThreadRunning, getThreadContext, markThreadProcessing, markThreadRunning, projects],
  );

  const loadStoppedSessionPreview = useCallback(async (threadId, cwd, sessionId) => {
    const entries = sessionId
      ? await window.api.store.loadSessionTranscriptEntries(cwd, sessionId)
      : [];
    const transcript = entries.length > 0
      ? entries
          .map(({ role, text }) =>
            `${role === "assistant" ? "Claude" : "You"}: ${text}`.trim(),
          )
          .join("\n\n")
      : "";
    const preview =
      transcript ||
      "会话当前未运行。\n\n右键该 session 选择“重启 Claude”后，才会真正继续对话。";
    setThreadPreviewContent((prev) =>
      prev[threadId] === preview ? prev : { ...prev, [threadId]: preview },
    );
    setThreadPreviewEntries((prev) => {
      const nextValue = entries.length > 0 ? entries : [];
      return prev[threadId] === nextValue ? prev : { ...prev, [threadId]: nextValue };
    });
    replaceTerminalContent(threadId, preview);
  }, []);

  const applySessionModelConfig = useCallback(
    async (threadId, config) => {
      await relaunchThreadWithConfig(threadId, config);
    },
    [relaunchThreadWithConfig],
  );

  const updateModelConfig = useCallback(
    (updates, options = {}) => {
      const shouldApplyToActiveSession = options.applyToActiveSession !== false;
      let nextConfig;
      setModelConfig((prev) => {
        nextConfig = normalizeModelConfig({ ...prev, ...updates });
        return nextConfig;
      });
      if (
        shouldApplyToActiveSession &&
        activeThreadId &&
        runningThreads.has(activeThreadId)
      ) {
        applySessionModelConfig(activeThreadId, nextConfig);
      }
      return nextConfig;
    },
    [activeThreadId, applySessionModelConfig, runningThreads],
  );

  // Persist active thread ID for session restore on restart
  useEffect(() => {
    if (activeThreadId && loaded.current) {
      try {
        // Save active thread ID + its project/session info for restore
        for (const p of projects) {
          const t = p.threads.find((t) => t.id === activeThreadId);
          if (t) {
            localStorage.setItem(
              "hub-last-session",
              JSON.stringify({
                threadId: t.id,
                claudeSessionId: t.claudeSessionId,
                projectCwd: p.cwd,
                autoConfirm: !!t.autoConfirm,
              }),
            );
            break;
          }
        }
      } catch {}
    }
  }, [activeThreadId, projects]);

  // Apply dark mode class
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    try {
      localStorage.setItem("hub-dark-mode", darkMode);
    } catch {}
  }, [darkMode]);

  // Sync app settings changes
  const handleAppSettingsChange = (newSettings) => {
    const normalizedSettings = {
      ...DEFAULT_APP_SETTINGS,
      ...newSettings,
      defaultModel: normalizeModelId(
        newSettings.defaultModel || DEFAULT_APP_SETTINGS.defaultModel,
      ),
    };
    setAppSettings(normalizedSettings);
    try {
      localStorage.setItem(
        "hub-app-settings",
        JSON.stringify(normalizedSettings),
      );
    } catch {}
    // Sync dark mode
    if (normalizedSettings.darkMode !== darkMode) {
      setDarkMode(normalizedSettings.darkMode);
    }
    // Sync default model
    if (
      normalizedSettings.defaultModel &&
      normalizedSettings.defaultModel !== modelConfig.model
    ) {
      updateModelConfig({ model: normalizedSettings.defaultModel });
    }
  };

  const refreshClaudeStatus = useCallback(async () => {
    try {
      const status = await window.api.claude.getStatus();
      setClaudeStatus({
        loading: false,
        ...status,
      });
      return status;
    } catch (error) {
      const fallback = {
        loading: false,
        installed: false,
        loggedIn: false,
        needsLogin: true,
        authError: error?.message || "Failed to check Claude status",
        email: null,
        version: null,
      };
      setClaudeStatus(fallback);
      return fallback;
    }
  }, []);

  const handleClaudeLogin = useCallback(async () => {
    setClaudeBusy(true);
    try {
      const result = await window.api.claude.login(
        claudeStatus.email || undefined,
      );
      if (result?.status) {
        setClaudeStatus({
          loading: false,
          ...result.status,
          authError:
            result.success
              ? null
              : result.error || result.status.authError || null,
        });
      } else {
        await refreshClaudeStatus();
      }
    } finally {
      setClaudeBusy(false);
    }
  }, [claudeStatus.email, refreshClaudeStatus]);

  useEffect(() => {
    refreshClaudeStatus();
    const interval = setInterval(() => {
      refreshClaudeStatus();
    }, 120000);
    const handleFocus = () => {
      refreshClaudeStatus();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [refreshClaudeStatus]);

  // Auto-discover sessions for a list of projects and merge new ones as threads
  const autoDiscoverSessions = async (projectList) => {
    const updated = [];
    for (const p of projectList) {
      try {
        const discovered = await window.api.store.scanProjectSessions(p.cwd);
        if (!discovered || discovered.length === 0) {
          updated.push(p);
          continue;
        }
        const deletedSessionIds = new Set(p.deletedSessionIds || []);
        const visibleDiscovered = discovered.filter(
          (s) => !deletedSessionIds.has(s.id),
        );

        // Build a lookup from discovered sessions for title updates
        const discoveredMap = new Map(
          visibleDiscovered.map((s) => [s.id, s]),
        );

        // Update existing threads that have generic/empty titles
        const updatedThreads = p.threads.map((t) => {
          if (!t.claudeSessionId) return t;
          const disc = discoveredMap.get(t.claudeSessionId);
          if (!disc || !disc.summary) return t;
          // Update title if it looks like a generic fallback or session ID
          const isGenericTitle =
            !t.title ||
            t.title.startsWith("Session ") ||
            /^[0-9a-f]{8}-/.test(t.title);
          if (isGenericTitle) {
            return { ...t, title: disc.summary };
          }
          return t;
        });

        // Find sessions not already tracked as threads
        const existingSessionIds = new Set(
          updatedThreads.map((t) => t.claudeSessionId),
        );
        const newSessions = visibleDiscovered.filter(
          (s) => !existingSessionIds.has(s.id),
        );
        if (newSessions.length === 0) {
          // Still push with possibly updated thread titles
          updated.push({ ...p, threads: updatedThreads });
          continue;
        }
        const nextListOrder = getNextThreadListOrder({
          ...p,
          threads: updatedThreads,
        });
        const newThreads = newSessions.map((s) => ({
          id: genId(),
          title:
            s.summary ||
            `Session ${new Date(s.lastModified).toLocaleDateString("zh-CN")}`,
          cwd: p.cwd,
          createdAt: s.lastModified,
          lastActiveAt: s.lastModified,
          listOrder: nextListOrder + (newSessions.length - 1),
          autoConfirm: false,
          claudeSessionId: s.id,
          snapshots: [],
          usage: {
            interactions: 0,
            outputBytes: 0,
            tokens: { input: 0, output: 0 },
            cost: 0,
          },
          hasUnread: false,
          autoDiscovered: true,
        })).map((thread, index) => ({
          ...thread,
          listOrder: nextListOrder + (newSessions.length - index - 1),
        }));
        updated.push({
          ...p,
          threads: [...updatedThreads, ...newThreads],
        });
      } catch (_) {
        updated.push(p);
      }
    }
    return updated;
  };

  // Generate AI-powered short titles for threads that only have raw summaries.
  // Runs in background, updates titles as they come in.
  const generateAiTitles = async (projectList) => {
    // Collect threads that need title generation:
    // - have a raw summary (long first-message text)
    // - don't already have a short AI-generated title (marked by aiTitle flag)
    const toGenerate = [];
    for (const p of projectList) {
      for (const t of p.threads) {
        if (
          t.claudeSessionId &&
          t.title &&
          t.title.length > 30 &&
          !t.aiTitle
        ) {
          toGenerate.push({
            sessionId: t.claudeSessionId,
            summary: t.title,
          });
        }
      }
    }
    if (toGenerate.length === 0) return;

    // Load cached titles first and apply immediately
    try {
      const cache = await window.api.store.loadTitleCache();
      if (cache && Object.keys(cache).length > 0) {
        setProjects((prev) =>
          prev.map((p) => ({
            ...p,
            threads: p.threads.map((t) => {
              if (t.claudeSessionId && cache[t.claudeSessionId] && !t.aiTitle) {
                return {
                  ...t,
                  title: cache[t.claudeSessionId],
                  aiTitle: true,
                  rawSummary: t.rawSummary || t.title,
                };
              }
              return t;
            }),
          })),
        );
        // Filter out already-cached ones
        const cachedIds = new Set(Object.keys(cache));
        const remaining = toGenerate.filter(
          (s) => !cachedIds.has(s.sessionId),
        );
        if (remaining.length === 0) return;
        // Generate only uncached titles
        for (const { sessionId, summary } of remaining) {
          try {
            const title = await window.api.store.generateTitle(
              sessionId,
              summary,
            );
            if (title) {
              setProjects((prev) =>
                prev.map((p) => ({
                  ...p,
                  threads: p.threads.map((t) =>
                    t.claudeSessionId === sessionId
                      ? { ...t, title, aiTitle: true, rawSummary: t.rawSummary || t.title }
                      : t,
                  ),
                })),
              );
            }
          } catch (_) {}
        }
        return;
      }
    } catch (_) {}

    // No cache — generate all titles sequentially
    for (const { sessionId, summary } of toGenerate) {
      try {
        const title = await window.api.store.generateTitle(sessionId, summary);
        if (title) {
          setProjects((prev) =>
            prev.map((p) => ({
              ...p,
              threads: p.threads.map((t) =>
                t.claudeSessionId === sessionId
                  ? { ...t, title, aiTitle: true, rawSummary: t.rawSummary || t.title }
                  : t,
              ),
            })),
          );
        }
      } catch (_) {}
    }
  };

  // Refresh sessions for a single project
  const refreshProjectSessions = async (projectId) => {
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) return;
    const [updated] = await autoDiscoverSessions([proj]);
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? updated : p)),
    );
    // Generate titles for new sessions
    generateAiTitles([updated]);
  };

  // Load data on mount, migrate threads missing sessionId, env, snapshots, usage
  // Auto-discover Claude Code projects on first run (no existing projects)
  // Auto-scan sessions for all projects on every load
  useEffect(() => {
    window.api.store.load().then(async (data) => {
      let projectList;
      if (data.projects && data.projects.length > 0) {
        projectList = data.projects.map((p) => ({
          ...normalizeProject(p),
          threads: (p.threads || []).map((t) => ({
            ...t,
            claudeSessionId: t.claudeSessionId || crypto.randomUUID(),
            snapshots: t.snapshots || [],
            hasUnread: !!t.hasUnread,
            usage: t.usage || {
              interactions: 0,
              outputBytes: 0,
              tokens: { input: 0, output: 0 },
              cost: 0,
            },
          })),
        }));
      } else {
        // First run: auto-discover Claude Code projects
        projectList = [];
        try {
          const discovered = await window.api.store.scanClaudeProjects();
          if (discovered && discovered.length > 0) {
            projectList = discovered.map((d) =>
              normalizeProject({
              id: genId(),
              name: d.name,
              cwd: d.cwd,
              env: {},
              settings: { shell: "/bin/zsh" },
              threads: [],
              deletedSessionIds: [],
              createdAt: Date.now(),
              autoDiscovered: true,
              }),
            );
          }
        } catch (_) {}
      }

      projectList = projectList.map(normalizeProject);

      // Auto-scan sessions for all projects
      if (projectList.length > 0) {
        try {
          projectList = await autoDiscoverSessions(projectList);
        } catch (_) {}
      }

      setProjects(projectList);
      loaded.current = true;
      recordStartupTrace("projects-loaded", {
        projectCount: projectList.length,
        threadCount: projectList.reduce(
          (count, project) => count + (project.threads || []).length,
          0,
        ),
      });
      syncRunningThreads(projectList);

      // Trigger AI title generation in background for threads with raw summaries
      generateAiTitles(projectList);

      // Store last session info so startup can restore the selection.
      restoreTarget.current = null;
      // Determine which session to auto-select on startup
      try {
        let found = false;
        const saved = localStorage.getItem("hub-last-session");
        recordStartupTrace("restore-saved-session-read", {
          raw: saved,
        });
        if (saved) {
          const last = JSON.parse(saved);
          for (const p of projectList) {
            const t = p.threads.find(
              (t) =>
                t.id === last.threadId ||
                t.claudeSessionId === last.claudeSessionId,
            );
            if (t) {
              restoreTarget.current = {
                threadId: t.id,
                cwd: p.cwd,
                claudeSessionId: t.claudeSessionId,
                autoConfirm: t.autoConfirm,
              };
              recordStartupTrace("restore-saved-session-match", {
                threadId: t.id,
                title: t.title,
                cwd: p.cwd,
                claudeSessionId: t.claudeSessionId,
              });
              found = true;
              break;
            }
          }
        }
        // Fallback: if saved session not found, pick the most recently active thread
        if (!found) {
          let bestThread = null;
          let bestProject = null;
          let bestTime = 0;
          for (const p of projectList) {
            for (const t of p.threads) {
              const time = t.lastActiveAt || t.createdAt || 0;
              if (time > bestTime) {
                bestTime = time;
                bestThread = t;
                bestProject = p;
              }
            }
          }
          if (bestThread && bestProject) {
            restoreTarget.current = {
              threadId: bestThread.id,
              cwd: bestProject.cwd,
              claudeSessionId: bestThread.claudeSessionId,
              autoConfirm: bestThread.autoConfirm,
            };
            recordStartupTrace("restore-fallback-match", {
              threadId: bestThread.id,
              title: bestThread.title,
              cwd: bestProject.cwd,
              claudeSessionId: bestThread.claudeSessionId,
            });
          }
        }
      } catch (_) {}
    });
  }, [syncRunningThreads]);

  // Persist on change
  useEffect(() => {
    if (loaded.current) {
      window.api.store.save({ projects });
    }
  }, [projects]);

  useEffect(() => {
    clearThreadUnread(activeThreadId);
  }, [activeThreadId, clearThreadUnread]);

  // Auto-select the last active session after initial load.
  // Viewing a stopped session should stay read-only until the user sends a
  // new message from the preview composer.
  useEffect(() => {
    if (
      !loaded.current ||
      !restoreTarget.current ||
      projects.length === 0 ||
      restoreApplyScheduledRef.current
    )
      return;
    const target = restoreTarget.current;
    restoreTarget.current = null; // Only restore once
    restoreApplyScheduledRef.current = true;
    recordStartupTrace("restore-effect-start", {
      threadId: target.threadId,
      cwd: target.cwd,
      claudeSessionId: target.claudeSessionId,
    });

    // Find the thread's owning project to get env
    const ownerProject = projects.find((p) =>
      p.threads.some((t) => t.id === target.threadId),
    );
    if (!ownerProject) {
      restoreApplyScheduledRef.current = false;
      return;
    }
    const ownerThread = ownerProject.threads.find((t) => t.id === target.threadId);
    if (!ownerThread) {
      restoreApplyScheduledRef.current = false;
      return;
    }

    // Small delay to let the terminal container mount in DOM
    restoreTimerRef.current = window.setTimeout(async () => {
      restoreTimerRef.current = null;
      restoreApplyScheduledRef.current = false;
      recordStartupTrace("restore-apply", {
        threadId: target.threadId,
        title: ownerThread.title,
      });
      setActiveThreadId(target.threadId);

      const running = await window.api.pty.isRunning(target.threadId);
      recordStartupTrace("restore-running-check", {
        threadId: target.threadId,
        running,
      });
      if (!running) {
        ensureTerminal(target.threadId);
        await loadStoppedSessionPreview(
          target.threadId,
          target.cwd,
          target.claudeSessionId,
        );
        clearThreadRunning(target.threadId);
        recordStartupTrace("restore-preview-loaded", {
          threadId: target.threadId,
        });
      } else {
        clearThreadPreview(target.threadId);
        preserveThreadRunningOrder(
          target.threadId,
          getThreadSortTimestamp(ownerThread),
        );
        recordStartupTrace("restore-running-preserved", {
          threadId: target.threadId,
        });
      }
    }, 150);
  }, [
    clearThreadPreview,
    clearThreadRunning,
    loadStoppedSessionPreview,
    preserveThreadRunningOrder,
    projects,
  ]);

  // Listen for thread exit
  useEffect(() => {
    const unsub = window.api.pty.onExit((threadId) => {
      clearThreadRunning(threadId);
    });
    return () => unsub();
  }, [clearThreadRunning]);

  // Usage tracking: listen to all PTY output and accumulate bytes + parse tokens
  useEffect(() => {
    const unsub = window.api.pty.onOutput((threadId, data) => {
      if (CLAUDE_AUTH_ERROR_RE.test(data || "")) {
        setClaudeStatus((prev) => ({
          ...prev,
          loading: false,
          installed: true,
          loggedIn: false,
          needsLogin: true,
          authError: (data || "").trim().slice(-240),
        }));
      }

      const bytes = typeof data === "string" ? data.length : 0;
      if (bytes === 0) return;

      const nextTail =
        ((outputTailRef.current[threadId] || "") + data).slice(-4000);
      outputTailRef.current[threadId] = nextTail;
      if (looksLikeClaudePrompt(nextTail)) {
        const pendingResume = pendingResumeMessagesRef.current[threadId];
        if (pendingResume) {
          delete pendingResumeMessagesRef.current[threadId];
          window.api.pty.write(
            threadId,
            `\x1b[200~${pendingResume}\x1b[201~`,
          );
          window.setTimeout(() => {
            window.api.pty.write(threadId, "\r");
            trackInteraction(threadId);
          }, 50);
          return;
        }
        clearThreadProcessing(threadId);
      }

      // Accumulate in ref (non-reactive) to avoid re-render on every chunk
      if (!usageBufferRef.current[threadId]) {
        usageBufferRef.current[threadId] = { bytes: 0, lastChunk: "" };
      }
      if (threadId !== activeThreadIdRef.current) {
        pendingUnreadThreadsRef.current.add(threadId);
      }
      const buf = usageBufferRef.current[threadId];
      buf.bytes += bytes;
      // Keep last 500 chars for token parsing (tokens appear in recent output)
      buf.lastChunk = (buf.lastChunk + data).slice(-500);
    });

    // Flush usage data to state every 5 seconds
    const flushInterval = setInterval(() => {
      const updates = usageBufferRef.current;
      const threadIds = Object.keys(updates);
      const pendingUnread = pendingUnreadThreadsRef.current;
      if (threadIds.length === 0 && pendingUnread.size === 0) return;

      setProjects((prev) =>
        prev.map((p) => ({
          ...p,
          threads: p.threads.map((t) => {
            const buf = updates[t.id];
            const shouldMarkUnread =
              pendingUnread.has(t.id) && t.id !== activeThreadIdRef.current;
            if ((!buf || buf.bytes === 0) && !shouldMarkUnread) return t;

            let nextThread = t;
            let changed = false;
            if (buf && buf.bytes > 0) {
              const usage = { ...(t.usage || {}) };
              usage.outputBytes = (usage.outputBytes || 0) + buf.bytes;
              // Try to parse token/cost from recent output
              const parsed = parseUsageFromChunk(buf.lastChunk);
              if (parsed) {
                if (!usage.tokens) usage.tokens = { input: 0, output: 0 };
                if (parsed.inputTokens) usage.tokens.input = parsed.inputTokens;
                if (parsed.outputTokens)
                  usage.tokens.output = parsed.outputTokens;
                if (parsed.cost) usage.cost = parsed.cost;
              }
              nextThread = { ...nextThread, usage, lastActiveAt: Date.now() };
              changed = true;
            }
            if (shouldMarkUnread && !nextThread.hasUnread) {
              nextThread = { ...nextThread, hasUnread: true };
              changed = true;
            }
            if (buf) {
              buf.bytes = 0;
              buf.lastChunk = "";
            }
            return changed ? nextThread : t;
          }),
        })),
      );
      pendingUnread.clear();
    }, 5000);

    return () => {
      unsub();
      clearInterval(flushInterval);
    };
  }, [clearThreadProcessing]);

  // Helper: get project env for spawning
  const getProjectEnv = (proj) => proj?.env || {};

  const addProject = async () => {
    const cwd = await window.api.selectDirectory();
    if (!cwd) return;
    const name = cwd.split("/").filter(Boolean).pop();
    const project = {
      id: genId(),
      name,
      cwd,
      env: {},
      settings: { shell: "/bin/zsh" },
      threads: [],
      deletedSessionIds: [],
      createdAt: Date.now(),
    };
    setProjects((prev) => [project, ...prev]);
  };

  const removeProject = (projectId) => {
    const proj = projects.find((p) => p.id === projectId);
    if (proj) {
      proj.threads.forEach((t) => {
        window.api.pty.stop(t.id);
        clearThreadRunning(t.id);
      });
    }
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    if (proj && proj.threads.some((t) => t.id === activeThreadId)) {
      setActiveThreadId(null);
    }
  };

  const updateProjectSettings = (projectId, updates) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, ...updates } : p)),
    );
    setSettingsProject(null);
  };

  const addThread = async (projectId, autoConfirm = false) => {
    const title = await window.api.inputDialog("新建会话", "输入会话名称", "");
    if (!title) return;
    const proj = projects.find((p) => p.id === projectId);
    const sessionId = crypto.randomUUID();
    const thread = {
      id: genId(),
      title,
      cwd: proj ? proj.cwd : "",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      listOrder: getNextThreadListOrder(proj),
      autoConfirm,
      claudeSessionId: sessionId,
      snapshots: [],
      usage: {
        interactions: 0,
        outputBytes: 0,
        tokens: { input: 0, output: 0 },
        cost: 0,
      },
      hasUnread: false,
    };
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId ? { ...p, threads: [thread, ...p.threads] } : p,
      ),
    );
    setActiveThreadId(thread.id);

    if (proj) {
      ensureTerminal(thread.id);
      window.api.pty
        .spawn(
          thread.id,
          proj.cwd,
          null,
          null,
          sessionId,
          false,
          autoConfirm,
          getProjectEnv(proj),
          modelConfig.model,
          modelConfig.effortLevel,
        )
        .then((result) => {
          if (result?.success) {
            markThreadRunning(thread.id);
            markThreadProcessing(thread.id);
          }
        });
    }
  };

  const selectThread = async (
    threadId,
    projectCwd,
    claudeSessionId,
    autoConfirm,
  ) => {
    ensureTerminal(threadId);
    setActiveThreadId(threadId);

    const ownerProject = projects.find((p) =>
      p.threads.some((t) => t.id === threadId),
    );

    const running = await window.api.pty.isRunning(threadId);
    if (!running) {
      // Viewing a stopped session should stay read-only: do not resume Claude,
      // do not mark it running, and do not touch its last active timestamp.
      await loadStoppedSessionPreview(threadId, projectCwd, claudeSessionId);
      clearThreadRunning(threadId);
    } else {
      clearThreadPreview(threadId);
      const inst = ensureTerminal(threadId);
      if (inst.hasStaticTranscript) {
        clearTerminalContent(threadId);
      }
      // Selecting an already-running thread should not reshuffle it to the top.
      preserveThreadRunningOrder(
        threadId,
        getThreadSortTimestamp(ownerProject?.threads.find((t) => t.id === threadId)),
      );
    }
  };

  const stopThread = (threadId) => {
    window.api.pty.stop(threadId);
    clearThreadRunning(threadId);
  };

  const restartClaude = async (threadId) => {
    await relaunchThreadWithConfig(
      threadId,
      modelConfigRef.current || DEFAULT_MODEL_CONFIG,
    );
  };

  // Terminal panel: open/toggle bottom terminal
  const openTerminal = async (existingId, existingHost) => {
    if (existingId) {
      if (activeSshId === existingId) {
        setActiveSshId(null);
      } else {
        setActiveSshId(existingId);
      }
      return;
    }
    // New terminal - ask for command (ssh or local)
    const host = await window.api.inputDialog(
      "终端连接",
      "输入 SSH 目标 或留空打开本地终端",
      "",
    );
    if (host === null || host === undefined) return;
    const id = "term-" + Date.now();
    const label = host ? host.split("@").pop() : "本地终端";
    const newSession = { id, host: host || "", label };
    const updated = [...sshSessions, newSession];
    setSshSessions(updated);
    try { localStorage.setItem("hub-ssh-hosts", JSON.stringify(updated)); } catch {}
    setActiveSshId(id);
  };

  const renameThread = async (projectId, threadId, oldTitle) => {
    const newTitle = await window.api.inputDialog(
      "重命名会话",
      "输入新名称",
      oldTitle,
    );
    if (!newTitle || newTitle === oldTitle) return;
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? {
              ...p,
              threads: p.threads.map((t) =>
                t.id === threadId ? { ...t, title: newTitle } : t,
              ),
            }
          : p,
      ),
    );
  };

  const removeThread = (projectId, threadId) => {
    window.api.pty.stop(threadId);
    destroyTerminal(threadId);
    clearThreadPreview(threadId);
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        const removedThread = p.threads.find((t) => t.id === threadId);
        if (!removedThread) return p;
        return {
          ...p,
          deletedSessionIds: removedThread.claudeSessionId
            ? Array.from(
                new Set([
                  ...(p.deletedSessionIds || []),
                  removedThread.claudeSessionId,
                ]),
              )
            : p.deletedSessionIds || [],
          threads: p.threads.filter((t) => t.id !== threadId),
        };
      }),
    );
    if (activeThreadId === threadId) {
      setActiveThreadId(null);
      try {
        localStorage.removeItem("hub-last-session");
      } catch {}
    }
    clearThreadRunning(threadId);
  };

  // ─── Snapshot handlers ─────────────────────────────
  const createSnapshot = useCallback(async (threadId) => {
    const title = await window.api.inputDialog(
      "创建快照",
      "快照名称",
      `快照 ${new Date().toLocaleTimeString("zh-CN")}`,
    );
    if (!title) return;

    const bufferContent = await window.api.pty.getBuffer(threadId);
    const snapshot = {
      id: genId(),
      title,
      timestamp: Date.now(),
      bufferContent: bufferContent || "",
    };

    setProjects((prev) =>
      prev.map((p) => ({
        ...p,
        threads: p.threads.map((t) =>
          t.id === threadId
            ? { ...t, snapshots: [snapshot, ...(t.snapshots || [])] }
            : t,
        ),
      })),
    );
  }, []);

  const deleteSnapshot = useCallback((threadId, snapshotId) => {
    setProjects((prev) =>
      prev.map((p) => ({
        ...p,
        threads: p.threads.map((t) =>
          t.id === threadId
            ? {
                ...t,
                snapshots: (t.snapshots || []).filter(
                  (s) => s.id !== snapshotId,
                ),
              }
            : t,
        ),
      })),
    );
  }, []);

  const branchFromSnapshot = useCallback(
    async (threadId, snapshotId) => {
      // Find the thread and snapshot
      let ownerProject = null;
      let sourceThread = null;
      let snapshot = null;
      for (const p of projects) {
        const t = p.threads.find((t) => t.id === threadId);
        if (t) {
          ownerProject = p;
          sourceThread = t;
          snapshot = (t.snapshots || []).find((s) => s.id === snapshotId);
          break;
        }
      }
      if (!ownerProject || !snapshot) return;

      const newSessionId = crypto.randomUUID();
      const branchThread = {
        id: genId(),
        title: `${sourceThread.title} [${snapshot.title}]`,
        cwd: ownerProject.cwd,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        listOrder: getNextThreadListOrder(ownerProject),
        autoConfirm: sourceThread.autoConfirm,
        claudeSessionId: newSessionId,
        snapshots: [],
        usage: {
          interactions: 0,
          outputBytes: 0,
          tokens: { input: 0, output: 0 },
          cost: 0,
        },
        hasUnread: false,
      };

      setProjects((prev) =>
        prev.map((p) =>
          p.id === ownerProject.id
            ? { ...p, threads: [branchThread, ...p.threads] }
            : p,
        ),
      );

      // Set as active, create terminal, write snapshot buffer, then spawn
      setActiveThreadId(branchThread.id);
      const inst = ensureTerminal(branchThread.id);
      if (snapshot.bufferContent) {
        inst.term.write(snapshot.bufferContent);
      }

      window.api.pty
        .spawn(
          branchThread.id,
          ownerProject.cwd,
          null,
          null,
          newSessionId,
          false,
          branchThread.autoConfirm,
          getProjectEnv(ownerProject),
          modelConfig.model,
          modelConfig.effortLevel,
        )
        .then((result) => {
          if (result?.success) {
            markThreadRunning(branchThread.id);
            markThreadProcessing(branchThread.id);
          }
        });

      setShowSnapshots(false);
    },
    [markThreadProcessing, projects],
  );

  const submitStoppedSessionMessage = useCallback(
    async (threadId, message) => {
      const text = message?.trim();
      if (!threadId || !text) return false;

      const existingPreview = threadPreviewContent[threadId];
      const launched = await relaunchThreadWithConfig(
        threadId,
        modelConfigRef.current || DEFAULT_MODEL_CONFIG,
      );
      if (!launched) {
        if (typeof existingPreview === "string") {
          setThreadPreviewContent((prev) => ({
            ...prev,
            [threadId]: existingPreview,
          }));
        }
        return false;
      }

      const payload = text.replace(/\r\n/g, "\n");
      pendingResumeMessagesRef.current[threadId] = payload;

      const currentBuffer = await window.api.pty.getBuffer(threadId);
      const currentTail =
        typeof currentBuffer === "string" ? currentBuffer.slice(-4000) : "";
      if (looksLikeClaudePrompt(currentTail)) {
        delete pendingResumeMessagesRef.current[threadId];
        window.api.pty.write(threadId, `\x1b[200~${payload}\x1b[201~`);
        window.setTimeout(() => {
          window.api.pty.write(threadId, "\r");
          trackInteraction(threadId);
        }, 50);
      }

      return true;
    },
    [relaunchThreadWithConfig, threadPreviewContent, trackInteraction],
  );

  // Find active thread's project (or SSH session)
  let activeProject = null;
  let activeThread = null;
  for (const p of projects) {
    const t = p.threads.find((t) => t.id === activeThreadId);
    if (t) {
      activeProject = p;
      activeThread = t;
      break;
    }
  }

  const lang = appSettings.language || "zh";
  const i = (key, ...args) => t(lang, key, ...args);
  const ctxValue = { lang, terminalFontSize: appSettings.terminalFontSize || 13, t: i };
  const claudeStatusLabel = claudeStatus.loading
    ? i("claudeChecking")
    : claudeStatus.loggedIn
      ? `${i("claudeSignedIn")}${claudeStatus.email ? ` · ${claudeStatus.email}` : ""}`
      : claudeStatus.installed
        ? i("claudeLoginNeeded")
        : i("claudeNotInstalled");
  const claudeActionLabel = claudeBusy
    ? i("claudeAuthenticating")
    : claudeStatus.loggedIn
      ? i("claudeRefreshAuth")
      : i("claudeLogin");
  const claudeStatusTitle = [
    claudeStatus.version,
    claudeStatus.email,
    claudeStatus.authError,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <AppContext.Provider value={ctxValue}>
    <div className="app">
      <div className="titlebar">
        <span className="titlebar-text">Claude Code Hub</span>
        <div className="titlebar-actions">
          <div
            className={`titlebar-auth-pill ${
              claudeStatus.loggedIn
                ? "is-ok"
                : claudeStatus.installed
                  ? "is-warning"
                  : "is-error"
            }`}
            title={claudeStatusTitle}
          >
            <span className="titlebar-auth-dot" />
            <span className="titlebar-auth-text">{claudeStatusLabel}</span>
          </div>
          <button
            className="titlebar-btn"
            onClick={
              claudeStatus.loggedIn ? refreshClaudeStatus : handleClaudeLogin
            }
            disabled={claudeBusy}
            title={claudeStatus.authError || ""}
          >
            {claudeActionLabel}
          </button>
          <button
            className="titlebar-icon-btn"
            onClick={() => setShowUsageStats(true)}
            title={i("usageStats")}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect
                x="1"
                y="8"
                width="3"
                height="5"
                rx="0.5"
                fill="currentColor"
                opacity="0.5"
              />
              <rect
                x="5.5"
                y="5"
                width="3"
                height="8"
                rx="0.5"
                fill="currentColor"
                opacity="0.7"
              />
              <rect
                x="10"
                y="1"
                width="3"
                height="12"
                rx="0.5"
                fill="currentColor"
              />
            </svg>
          </button>
          <button
            className="titlebar-icon-btn"
            onClick={() => setDarkMode((d) => !d)}
            title={darkMode ? i("lightMode") : i("darkMode")}
          >
            {darkMode ? "☀" : "☾"}
          </button>
          <ModelSelector
            model={modelConfig?.model || DEFAULT_MODEL_CONFIG.model}
            effortLevel={modelConfig?.effortLevel || DEFAULT_MODEL_CONFIG.effortLevel}
            onModelChange={(model) => updateModelConfig({ model })}
            onEffortChange={(effortLevel) => updateModelConfig({ effortLevel })}
          />
          <button className="titlebar-btn" onClick={addProject}>
            {i("addProject")}
          </button>
          <button
            className="titlebar-icon-btn"
            onClick={() => setShowAppSettings(true)}
            title={i("settings")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 10a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M13 9.2l-.8-.5a5 5 0 000-1.4l.8-.5a.6.6 0 00.2-.7l-.6-1a.6.6 0 00-.7-.3l-.8.5a5 5 0 00-1.2-.7V3.7a.6.6 0 00-.5-.5H8.6a.6.6 0 00-.5.5v.9a5 5 0 00-1.2.7l-.8-.5a.6.6 0 00-.7.3l-.6 1a.6.6 0 00.2.7l.8.5a5 5 0 000 1.4l-.8.5a.6.6 0 00-.2.7l.6 1a.6.6 0 00.7.3l.8-.5a5 5 0 001.2.7v.9a.6.6 0 00.5.5h.8a.6.6 0 00.5-.5v-.9a5 5 0 001.2-.7l.8.5a.6.6 0 00.7-.3l.6-1a.6.6 0 00-.2-.7z" stroke="currentColor" strokeWidth="1" fill="none"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="workspace">
        <div className="main" style={appSettings.layout === "sidebar-right" ? { flexDirection: "row-reverse" } : undefined}>
          <Sidebar
            projects={projects}
            activeThreadId={activeThreadId}
            runningThreads={runningThreads}
            processingThreads={processingThreads}
            runningOrder={runningOrder}
            timeAgo={timeAgo}
            onSelectThread={selectThread}
            onAddThread={addThread}
            onStopThread={stopThread}
            onRemoveThread={removeThread}
            onRestartClaude={restartClaude}
            onRenameThread={renameThread}
            onRemoveProject={removeProject}
            onAddProject={addProject}
            onProjectSettings={(projectId) => {
              const proj = projects.find((p) => p.id === projectId);
              if (proj) setSettingsProject(proj);
            }}
            onRefreshSessions={refreshProjectSessions}
            onToggleTerminal={() => setActiveSshId((prev) => prev ? null : "sidebar-term")}
            terminalOpen={!!activeSshId}
            style={{ width: sidebarWidth, minWidth: sidebarWidth }}
          />
          <div
            className="sidebar-resize-handle"
            onMouseDown={handleSidebarDragStart}
          />
          <div className="content">
            {activeThread ? (
              <TerminalView
                key={activeThread.id}
                thread={activeThread}
                project={activeProject}
                isRunning={runningThreads.has(activeThread.id)}
                staticPreview={threadPreviewContent[activeThread.id]}
                staticPreviewEntries={threadPreviewEntries[activeThread.id]}
                onSubmitStaticPreview={(message) =>
                  submitStoppedSessionMessage(activeThread.id, message)
                }
                onCreateSnapshot={() => createSnapshot(activeThread.id)}
                onShowSnapshots={() => setShowSnapshots(true)}
                snapshotCount={(activeThread.snapshots || []).length}
                onTrackInteraction={() => trackInteraction(activeThread.id)}
              />
            ) : (
              <EmptyState onAddProject={addProject} />
            )}
          </div>
        </div>
        {activeSshId && (
          <>
            <div className="workspace-term-drag" onMouseDown={handleSshDragStart} />
            <div className="workspace-term-container" style={{ height: sshPanelHeight }}>
              <BottomTerminal
                panelId="sidebar-term"
                cwd={activeProject?.cwd || "/"}
                command=""
                label="终端"
                onClose={() => setActiveSshId(null)}
                style={{ height: "100%" }}
              />
            </div>
          </>
        )}
      </div>

      {settingsProject && (
        <ProjectSettings
          project={settingsProject}
          onSave={(updates) =>
            updateProjectSettings(settingsProject.id, updates)
          }
          onClose={() => setSettingsProject(null)}
        />
      )}

      {showSnapshots && activeThread && (
        <SnapshotPanel
          snapshots={activeThread.snapshots || []}
          threadTitle={activeThread.title}
          onCreateSnapshot={() => createSnapshot(activeThread.id)}
          onBranch={(snapshotId) =>
            branchFromSnapshot(activeThread.id, snapshotId)
          }
          onDelete={(snapshotId) => deleteSnapshot(activeThread.id, snapshotId)}
          onClose={() => setShowSnapshots(false)}
        />
      )}

      {showUsageStats && (
        <UsageStats
          projects={projects}
          onClose={() => setShowUsageStats(false)}
          currentModel={modelConfig?.model || DEFAULT_MODEL_CONFIG.model}
        />
      )}

      {showAppSettings && (
        <AppSettings
          settings={{
            ...appSettings,
            darkMode,
            defaultModel: modelConfig?.model || DEFAULT_MODEL_CONFIG.model,
          }}
          onSettingsChange={handleAppSettingsChange}
          onClose={() => setShowAppSettings(false)}
        />
      )}
    </div>
    </AppContext.Provider>
  );
}
