import React, { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";
import { useApp } from "../AppContext";

// Global map: keep xterm instances alive across re-renders
const terminalInstances = new Map();
const TERMINAL_FONT_FAMILY =
  '"SF Mono", Menlo, Monaco, "PingFang SC", "Hiragino Sans GB", "Noto Sans Mono CJK SC", monospace';

const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#1a1a1a",
  cursor: "#1a1a1a",
  cursorAccent: "#ffffff",
  selectionBackground: "#b4d5fe",
  selectionForeground: "#1a1a1a",
  black: "#1a1a1a",
  red: "#d73a49",
  green: "#22863a",
  yellow: "#b08800",
  blue: "#0366d6",
  magenta: "#6f42c1",
  cyan: "#1b7c83",
  white: "#6a737d",
  brightBlack: "#586069",
  brightRed: "#cb2431",
  brightGreen: "#28a745",
  brightYellow: "#dbab09",
  brightBlue: "#2188ff",
  brightMagenta: "#8a63d2",
  brightCyan: "#3192aa",
  brightWhite: "#959da5",
};

const DARK_THEME = {
  background: "#1a1a1e",
  foreground: "#e4e4e7",
  cursor: "#e4e4e7",
  cursorAccent: "#1a1a1e",
  selectionBackground: "#3a5c8a",
  selectionForeground: "#e4e4e7",
  black: "#3a3a3e",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#d4d4d8",
  brightBlack: "#71717a",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#fafafa",
};

function isDarkMode() {
  return document.documentElement.classList.contains("dark");
}

function getCurrentTheme() {
  return isDarkMode() ? DARK_THEME : LIGHT_THEME;
}

/** Apply current theme to ALL existing terminal instances */
function applyThemeToAll() {
  const theme = getCurrentTheme();
  for (const [, inst] of terminalInstances) {
    inst.term.options.theme = theme;
  }
}

// Watch for dark mode class changes on <html> and update all terminals
if (typeof MutationObserver !== "undefined") {
  const observer = new MutationObserver(() => {
    applyThemeToAll();
  });
  if (document.documentElement) {
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
}

function getOrCreateTerminal(threadId, fontSize) {
  if (terminalInstances.has(threadId)) {
    const existing = terminalInstances.get(threadId);
    // Update fontSize if changed
    if (fontSize && existing.term.options.fontSize !== fontSize) {
      existing.term.options.fontSize = fontSize;
      try { existing.fitAddon.fit(); } catch {}
    }
    return existing;
  }

  const term = new Terminal({
    fontSize: fontSize || 14,
    fontFamily: TERMINAL_FONT_FAMILY,
    theme: getCurrentTheme(),
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  let isWritable = true;

  // Handle macOS shortcuts (Cmd+A, Cmd+C, Cmd+V) and Shift+Enter for newline
  term.attachCustomKeyEventHandler((e) => {
    // Shift+Enter → insert newline without submitting
    // Use bracketed paste mode so Claude Code treats it as pasted text, not a key press
    if (e.key === "Enter" && e.shiftKey && e.type === "keydown") {
      if (!isWritable) return false;
      window.api.pty.write(threadId, "\x1b[200~\n\x1b[201~");
      return false;
    }
    if (
      (e.key === "Backspace" || e.key === "Delete") &&
      e.type === "keydown" &&
      term.hasSelection()
    ) {
      if (!isWritable) return false;
      window.api.pty.write(threadId, "\x15");
      term.clearSelection();
      return false;
    }
    if (e.metaKey && e.type === "keydown") {
      if (e.key === "a") {
        term.selectAll();
        return false;
      }
      if (e.key === "c") {
        const sel = term.getSelection();
        if (sel) navigator.clipboard.writeText(sel);
        return false;
      }
      // Cmd+V: let xterm handle paste natively via browser paste event
      if (e.key === "v") {
        return false;
      }
    }
    return true;
  });

  // Buffer output that arrives before xterm is opened in DOM
  let pendingWrites = [];
  let isOpened = false;

  // Auto-scroll: only scroll to bottom when user is already at bottom
  // When user scrolls up to read history, don't force them back down
  let autoScroll = true;

  // Listen for output globally — conditionally scroll to bottom
  let rafId = null;
  const unsubOutput = window.api.pty.onOutput((id, data) => {
    if (id === threadId) {
      inst.hasStaticTranscript = false;
      if (isOpened) {
        term.write(data, () => {
          if (autoScroll) {
            term.scrollToBottom();
          }
          if (inst.onScrollCheck) inst.onScrollCheck();
        });
        // Second scroll after xterm finishes rendering the full batch
        if (autoScroll) {
          cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => {
            if (autoScroll) {
              term.scrollToBottom();
            }
            if (inst.onScrollCheck) inst.onScrollCheck();
          });
        }
      } else {
        pendingWrites.push(data);
      }
    }
  });

  // Send input to PTY — track Enter as interaction
  // When user sends input, re-enable auto-scroll (they want to see response)
  term.onData((data) => {
    if (!isWritable) {
      return;
    }
    window.api.pty.write(threadId, data);
    if (data === "\r" || data === "\n") {
      autoScroll = true;
      if (inst.onInteraction) inst.onInteraction();
    }
  });

  const inst = {
    term,
    fitAddon,
    unsubOutput,
    pendingWrites,
    needsBufferReplay: true,
    hasStaticTranscript: false,
    onScrollCheck: null,
    onInteraction: null,
    setWritable(val) {
      isWritable = !!val;
    },
    setAutoScroll(val) {
      autoScroll = val;
    },
    getAutoScroll() {
      return autoScroll;
    },
    markOpened() {
      isOpened = true;
      if (pendingWrites.length > 0) {
        for (const chunk of pendingWrites) {
          term.write(chunk);
        }
        pendingWrites.length = 0;
        term.scrollToBottom();
      }
    },
  };
  terminalInstances.set(threadId, inst);
  return inst;
}

export function destroyTerminal(threadId) {
  const inst = terminalInstances.get(threadId);
  if (inst) {
    inst.unsubOutput();
    inst.term.dispose();
    terminalInstances.delete(threadId);
  }
}

export function ensureTerminal(threadId) {
  return getOrCreateTerminal(threadId);
}

export function replaceTerminalContent(threadId, content) {
  const inst = getOrCreateTerminal(threadId);
  inst.term.reset();
  inst.pendingWrites.length = 0;
  inst.needsBufferReplay = false;
  inst.hasStaticTranscript = true;
  if (content) {
    const nextContent = content.endsWith("\n") ? content : `${content}\n`;
    if (inst.term.element) {
      inst.term.write(nextContent);
    } else {
      inst.pendingWrites.push(nextContent);
    }
  }
  return inst;
}

export function clearTerminalContent(threadId) {
  const inst = getOrCreateTerminal(threadId);
  inst.term.reset();
  inst.pendingWrites.length = 0;
  inst.needsBufferReplay = false;
  inst.hasStaticTranscript = false;
  return inst;
}

export default function TerminalView({
  thread,
  project,
  isRunning,
  staticPreview,
  staticPreviewEntries,
  onSubmitStaticPreview,
  onCreateSnapshot,
  onShowSnapshots,
  snapshotCount,
  onTrackInteraction,
}) {
  const { terminalFontSize } = useApp();
  const containerRef = useRef(null);
  const staticPreviewRef = useRef(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [previewInput, setPreviewInput] = useState("");
  const [submittingPreview, setSubmittingPreview] = useState(false);
  const hasStaticPreview = typeof staticPreview === "string";
  const previewEntries = Array.isArray(staticPreviewEntries)
    ? staticPreviewEntries
    : [];
  const showStaticPreview = !isRunning && hasStaticPreview;
  const showStaticPreviewLoading = !isRunning && !hasStaticPreview;

  // Use ref for onTrackInteraction to avoid re-running the main effect
  // when the callback reference changes (which happens on every parent render)
  const onTrackInteractionRef = useRef(onTrackInteraction);
  useEffect(() => {
    onTrackInteractionRef.current = onTrackInteraction;
  }, [onTrackInteraction]);

  useEffect(() => {
    const inst = getOrCreateTerminal(thread.id, terminalFontSize);
    inst.setWritable(isRunning);
  }, [isRunning, terminalFontSize, thread.id]);

  useEffect(() => {
    if (isRunning) {
      setPreviewInput("");
      setSubmittingPreview(false);
    }
  }, [isRunning, thread.id]);

  useEffect(() => {
    if (!showStaticPreview) return undefined;
    let raf1 = 0;
    let raf2 = 0;
    const scrollToPreviewBottom = () => {
      const previewEl = staticPreviewRef.current;
      if (!previewEl) return;
      previewEl.scrollTop = previewEl.scrollHeight;
      const textArea = previewEl.querySelector("textarea");
      if (textArea) {
        textArea.scrollTop = textArea.scrollHeight;
      }
    };
    raf1 = requestAnimationFrame(() => {
      scrollToPreviewBottom();
      raf2 = requestAnimationFrame(scrollToPreviewBottom);
    });
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [showStaticPreview, staticPreview, previewEntries.length, thread.id]);

  useEffect(() => {
    if (showStaticPreview || showStaticPreviewLoading) {
      setShowScrollBtn(false);
      return undefined;
    }
    if (!containerRef.current) return;

    const inst = getOrCreateTerminal(thread.id, terminalFontSize);
    const { term, fitAddon } = inst;

    // Wire up interaction tracking via ref (stable across renders)
    inst.onInteraction = () => onTrackInteractionRef.current?.();

    // Attach to DOM
    if (!term.element) {
      term.open(containerRef.current);
    } else {
      containerRef.current.innerHTML = "";
      containerRef.current.appendChild(term.element);
    }

    // Reset state on switch
    setShowScrollBtn(false);
    inst.markOpened();

    // Force scroll helper
    const forceScroll = () => {
      term.scrollToBottom();
      const vp = containerRef.current?.querySelector(".xterm-viewport");
      if (vp) vp.scrollTop = vp.scrollHeight;
    };

    const syncPromptAnchor = () => {
      try {
        const screen = containerRef.current?.querySelector(".xterm-screen");
        const helpers = containerRef.current?.querySelector(".xterm-helpers");
        if (!screen) return;

        const cellHeight =
          term._core?._renderService?.dimensions?.css?.cell?.height || 0;
        const shouldPinToBottom = inst.getAutoScroll?.() !== false;
        const cursorY = term.buffer.active?.cursorY ?? term.rows - 1;
        const spareRows = shouldPinToBottom
          ? Math.max(0, term.rows - cursorY - 1)
          : 0;
        const offset = cellHeight > 0 ? Math.round(spareRows * cellHeight) : 0;
        const transform = offset > 0 ? `translateY(${offset}px)` : "";

        screen.style.transform = transform;
        if (helpers) {
          helpers.style.transform = transform;
        }
      } catch (e) {
        /* ignore */
      }
    };

    const syncTerminalSize = () => {
      try {
        fitAddon.fit();
        window.api.pty.resize(thread.id, term.cols, term.rows);
        syncPromptAnchor();
      } catch (e) {
        /* ignore */
      }
    };

    // After switch: scroll on every render until rendering stops (debounce 100ms)
    let settling = true;
    let settleTimer = null;
    const renderListener = term.onRender(() => {
      if (settling) {
        forceScroll();
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          settling = false;
        }, 100);
      }
      syncPromptAnchor();
    });
    // Fallback: if no render fires at all
    settleTimer = setTimeout(() => {
      forceScroll();
      settling = false;
    }, 300);

    // Fit to container without shrinking a row, so the prompt stays flush to the bottom.
    requestAnimationFrame(() => {
      syncTerminalSize();
      forceScroll();
    });

    // Replay buffer
    if (inst.needsBufferReplay) {
      inst.needsBufferReplay = false;
      window.api.pty.getBuffer(thread.id).then((buf) => {
        if (buf) {
          term.write(buf, () => {
            forceScroll();
            syncPromptAnchor();
          });
        }
      });
    }

    // Handle resize with the same sizing strategy as initial mount.
    const observer = new ResizeObserver(() => {
      syncTerminalSize();
    });
    observer.observe(containerRef.current);

    // Scroll position check for button + auto-scroll control
    const viewportEl = containerRef.current.querySelector(".xterm-viewport");
    const checkScrollPosition = () => {
      if (viewportEl) {
        const atBottom =
          viewportEl.scrollTop + viewportEl.clientHeight >=
          viewportEl.scrollHeight - 10;
        setShowScrollBtn(!atBottom);
        // When user scrolls up, disable auto-scroll; when at bottom, re-enable
        inst.setAutoScroll(atBottom);
      }
      syncPromptAnchor();
    };
    inst.onScrollCheck = checkScrollPosition;

    const scrollListener = term.onScroll(checkScrollPosition);

    const onViewportScroll = () => checkScrollPosition();
    if (viewportEl)
      viewportEl.addEventListener("scroll", onViewportScroll, {
        passive: true,
      });

    term.focus();
    syncPromptAnchor();

    return () => {
      observer.disconnect();
      scrollListener.dispose();
      renderListener.dispose();
      clearTimeout(settleTimer);
      inst.onScrollCheck = null;
      inst.onInteraction = null;
      if (viewportEl)
        viewportEl.removeEventListener("scroll", onViewportScroll);
      const helpers = containerRef.current?.querySelector(".xterm-helpers");
      const screen = containerRef.current?.querySelector(".xterm-screen");
      if (helpers) helpers.style.transform = "";
      if (screen) screen.style.transform = "";
    };
  }, [showStaticPreview, showStaticPreviewLoading, terminalFontSize, thread.id]);

  const scrollToBottom = () => {
    const inst = terminalInstances.get(thread.id);
    if (inst) {
      inst.setAutoScroll(true);
      inst.term.scrollToBottom();
      inst.term.focus();
      setShowScrollBtn(false);
    }
  };

  const handlePreviewSubmit = async () => {
    const text = previewInput.trim();
    if (!text || !onSubmitStaticPreview || submittingPreview) return;
    setSubmittingPreview(true);
    try {
      const ok = await onSubmitStaticPreview(text);
      if (ok !== false) {
        setPreviewInput("");
      }
    } finally {
      setSubmittingPreview(false);
    }
  };

  return (
    <div className="terminal-container">
      <div className="terminal-header">
        <div className="terminal-info">
          <span className="terminal-project">{project.name}</span>
          <span className="terminal-sep">/</span>
          <span className="terminal-title">{thread.title}</span>
        </div>
        <div className="terminal-meta">
          <button
            className="terminal-header-btn"
            onClick={onCreateSnapshot}
            title="创建快照"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect
                x="2"
                y="3"
                width="10"
                height="8"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <circle
                cx="7"
                cy="7"
                r="2"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </button>
          {snapshotCount > 0 && (
            <button
              className="terminal-header-btn terminal-snapshot-badge"
              onClick={onShowSnapshots}
              title={`${snapshotCount} 个快照`}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <rect
                  x="2"
                  y="3"
                  width="10"
                  height="8"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <circle
                  cx="7"
                  cy="7"
                  r="2"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
              <span className="snapshot-badge-count">{snapshotCount}</span>
            </button>
          )}
          <span className="terminal-cwd">{project.cwd}</span>
          <span
            className={`terminal-status ${isRunning ? "status-running" : "status-stopped"}`}
          >
            {isRunning ? "运行中" : "已停止"}
          </span>
        </div>
      </div>
      <div className="terminal-body-wrapper">
        {showStaticPreview || showStaticPreviewLoading ? (
          <div className="terminal-static-preview-shell">
            <div
              ref={staticPreviewRef}
              className={`terminal-static-preview ${
                showStaticPreviewLoading ? "terminal-static-preview-loading" : ""
              }`}
            >
              {showStaticPreview ? (
                previewEntries.length > 0 ? (
                  <div className="terminal-static-preview-messages">
                    {previewEntries.map((entry, index) => (
                      <div
                        key={`${entry.role}-${index}`}
                        className={`terminal-preview-message terminal-preview-${entry.role}`}
                      >
                        <div className="terminal-preview-message-role">
                          {entry.role === "assistant" ? "Claude" : "You"}
                        </div>
                        <pre className="terminal-preview-message-body">
                          {entry.text}
                        </pre>
                      </div>
                    ))}
                  </div>
                ) : (
                  <textarea readOnly spellCheck={false} value={staticPreview} />
                )
              ) : (
                <div className="terminal-static-preview-loading-text">
                  正在加载历史对话...
                </div>
              )}
            </div>
            <div className="terminal-preview-composer">
              <textarea
                value={previewInput}
                onChange={(e) => setPreviewInput(e.target.value)}
                placeholder={
                  submittingPreview
                    ? "正在恢复会话..."
                    : "输入消息并回车，将恢复该会话"
                }
                disabled={submittingPreview}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handlePreviewSubmit();
                  }
                }}
              />
              <button
                className="terminal-preview-send-btn"
                onClick={handlePreviewSubmit}
                disabled={submittingPreview || !previewInput.trim()}
              >
                {submittingPreview ? "恢复中..." : "继续对话"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="terminal-body" ref={containerRef} />
            {showScrollBtn && (
              <button
                className="scroll-to-bottom-btn"
                onClick={scrollToBottom}
                title="回到底部"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 3v10M4 9l4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
