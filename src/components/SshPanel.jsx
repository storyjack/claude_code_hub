import React, { useEffect, useRef, useCallback } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";
import { useApp } from "../AppContext";

const panelTerminals = new Map();
const TERMINAL_FONT_FAMILY =
  '"SF Mono", Menlo, Monaco, "PingFang SC", "Hiragino Sans GB", "Noto Sans Mono CJK SC", monospace';

const DARK_THEME = {
  background: "#1a1a1e",
  foreground: "#e4e4e7",
  cursor: "#e4e4e7",
  cursorAccent: "#1a1a1e",
  selectionBackground: "#3a5c8a",
  black: "#3a3a3e", red: "#f87171", green: "#4ade80", yellow: "#facc15",
  blue: "#60a5fa", magenta: "#c084fc", cyan: "#22d3ee", white: "#d4d4d8",
  brightBlack: "#71717a", brightRed: "#fca5a5", brightGreen: "#86efac",
  brightYellow: "#fde68a", brightBlue: "#93c5fd", brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9", brightWhite: "#fafafa",
};

const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#1a1a1a",
  cursor: "#1a1a1a",
  cursorAccent: "#ffffff",
  selectionBackground: "#b4d5fe",
  black: "#1a1a1a", red: "#d73a49", green: "#22863a", yellow: "#b08800",
  blue: "#0366d6", magenta: "#6f42c1", cyan: "#1b7c83", white: "#6a737d",
  brightBlack: "#586069", brightRed: "#cb2431", brightGreen: "#28a745",
  brightYellow: "#dbab09", brightBlue: "#2188ff", brightMagenta: "#8a63d2",
  brightCyan: "#3192aa", brightWhite: "#959da5",
};

function isDark() {
  return document.documentElement.classList.contains("dark");
}

export default function BottomTerminal({ panelId, cwd, command, label, onClose, style }) {
  const { terminalFontSize } = useApp();
  const containerRef = useRef(null);
  const fitRef = useRef(null);

  const fitTerminal = useCallback(() => {
    if (fitRef.current) {
      try {
        fitRef.current.fit();
        const inst = panelTerminals.get(panelId);
        if (inst) {
          window.api.pty.resize(panelId, inst.term.cols, inst.term.rows);
        }
      } catch {}
    }
  }, [panelId]);

  // Update font size on existing terminal when settings change
  useEffect(() => {
    const inst = panelTerminals.get(panelId);
    if (inst && inst.term.options.fontSize !== terminalFontSize) {
      inst.term.options.fontSize = terminalFontSize;
      try { fitRef.current?.fit(); } catch {}
    }
  }, [terminalFontSize, panelId]);

  useEffect(() => {
    if (!containerRef.current) return;
    let inst = panelTerminals.get(panelId);

    if (!inst) {
      const term = new Terminal({
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: terminalFontSize || 13,
        lineHeight: 1.3,
        theme: isDark() ? DARK_THEME : LIGHT_THEME,
        cursorBlink: true,
        scrollback: 5000,
        allowProposedApi: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      inst = { term, fit, mounted: false, spawned: false };
      panelTerminals.set(panelId, inst);
    }

    containerRef.current.innerHTML = "";
    inst.term.open(containerRef.current);
    inst.fit.fit();
    fitRef.current = inst.fit;

    if (!inst.spawned) {
      inst.spawned = true;
      const cols = inst.term.cols || 120;
      const rows = inst.term.rows || 15;
      window.api.pty.spawnShell(
        panelId, cwd || process.env.HOME || "/tmp", cols, rows,
        command || "",
      ).catch(() => {});

      inst.term.onData((data) => {
        window.api.pty.write(panelId, data);
      });
    } else {
      // Replay buffer for re-mount
      window.api.pty.getBuffer(panelId).then((buf) => {
        if (buf) inst.term.write(buf);
      });
    }

    const unsub = window.api.pty.onOutput((id, data) => {
      if (id === panelId) inst.term.write(data);
    });

    const observer = new MutationObserver(() => {
      inst.term.options.theme = isDark() ? DARK_THEME : LIGHT_THEME;
    });
    observer.observe(document.documentElement, {
      attributes: true, attributeFilter: ["class"],
    });

    const ro = new ResizeObserver(() => fitTerminal());
    ro.observe(containerRef.current);

    return () => { unsub(); observer.disconnect(); ro.disconnect(); };
  }, [panelId, cwd, command, fitTerminal]);

  return (
    <div className="bottom-panel" style={style}>
      <div className="bottom-panel-header">
        <span className="bottom-panel-title">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{marginRight: 5, verticalAlign: -1}}>
            <rect x="1" y="3" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
            <path d="M4 7l1.5 1.5L4 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M7 10h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          {label || "终端"}
        </span>
        <button className="bottom-panel-close" onClick={onClose} title="关闭">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 9l6-6M3 3l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      <div className="bottom-panel-terminal" ref={containerRef} />
    </div>
  );
}
