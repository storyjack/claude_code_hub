import React, { useState, useRef, useEffect } from "react";
import {
  CLAUDE_EFFORT_LEVELS,
  CLAUDE_MODELS,
  isMaxEffortSupported,
} from "../lib/claudeConfig";

function ThinkingBars({ count, max = 4, className = "" }) {
  return (
    <span className={`thinking-bars ${className}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`thinking-bar ${i < count ? "active" : ""}`} />
      ))}
    </span>
  );
}

export default function ModelSelector({
  model,
  effortLevel,
  onModelChange,
  onEffortChange,
}) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showThinkingMenu, setShowThinkingMenu] = useState(false);
  const modelRef = useRef(null);
  const thinkingRef = useRef(null);

  const currentModel =
    CLAUDE_MODELS.find((item) => item.id === model) || CLAUDE_MODELS[0];
  const currentThinking =
    CLAUDE_EFFORT_LEVELS.find((item) => item.id === effortLevel) ||
    CLAUDE_EFFORT_LEVELS[0];
  const supportsMaxEffort = isMaxEffortSupported(model);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e) => {
      if (modelRef.current && !modelRef.current.contains(e.target)) {
        setShowModelMenu(false);
      }
      if (thinkingRef.current && !thinkingRef.current.contains(e.target)) {
        setShowThinkingMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="model-selector">
      {/* Model selector */}
      <div className="model-selector-item" ref={modelRef}>
        <button
          className="model-selector-btn"
          onClick={() => {
            setShowModelMenu(!showModelMenu);
            setShowThinkingMenu(false);
          }}
        >
          <svg
            className="model-icon"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
          >
            <path
              d="M7 1L12.5 4v6L7 13 1.5 10V4L7 1z"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
            />
            <circle cx="7" cy="7" r="2" fill="currentColor" opacity="0.4" />
          </svg>
          <span className="model-selector-label">{currentModel.name}</span>
          <svg
            className="model-chevron"
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
          >
            <path
              d="M3 4l2 2 2-2"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {showModelMenu && (
          <div className="model-dropdown">
            {CLAUDE_MODELS.map((m) => (
              <div
                key={m.id}
                className={`model-dropdown-item ${m.id === model ? "active" : ""}`}
                onClick={() => {
                  onModelChange(m.id);
                  setShowModelMenu(false);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M7 1L12.5 4v6L7 13 1.5 10V4L7 1z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    fill="none"
                  />
                  <circle
                    cx="7"
                    cy="7"
                    r="2"
                    fill="currentColor"
                    opacity="0.4"
                  />
                </svg>
                <div className="model-dropdown-text">
                  <span className="model-dropdown-name">{m.name}</span>
                  <span className="model-dropdown-desc">{m.desc}</span>
                </div>
                {m.id === model && (
                  <svg
                    className="model-check"
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                  >
                    <path
                      d="M3 7l3 3 5-5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <span className="model-selector-divider" />

      {/* Thinking mode selector */}
      <div className="model-selector-item" ref={thinkingRef}>
        <button
          className="model-selector-btn"
          onClick={() => {
            setShowThinkingMenu(!showThinkingMenu);
            setShowModelMenu(false);
          }}
        >
          {currentThinking.bars > 0 ? (
            <ThinkingBars count={currentThinking.bars} />
          ) : (
            <svg
              className="model-icon"
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
            >
              <circle
                cx="7"
                cy="7"
                r="5"
                stroke="currentColor"
                strokeWidth="1.2"
                fill="none"
              />
              <path
                d="M7 4.5v5M4.5 7h5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          )}
          <span className="model-selector-label">{currentThinking.name}</span>
          <svg
            className="model-chevron"
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
          >
            <path
              d="M3 4l2 2 2-2"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {showThinkingMenu && (
          <div className="model-dropdown">
            {CLAUDE_EFFORT_LEVELS.map((t) => {
              const disabled = t.id === "max" && !supportsMaxEffort;
              return (
              <div
                key={t.id}
                className={`model-dropdown-item ${t.id === effortLevel ? "active" : ""} ${
                  disabled ? "disabled" : ""
                }`}
                onClick={() => {
                  if (disabled) return;
                  onEffortChange(t.id);
                  setShowThinkingMenu(false);
                }}
              >
                <div className="model-dropdown-icon-wrap">
                  {t.bars > 0 ? (
                    <ThinkingBars count={t.bars} />
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle
                        cx="7"
                        cy="7"
                        r="5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        fill="none"
                      />
                      <path
                        d="M7 4.5v5M4.5 7h5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </div>
                <div className="model-dropdown-text">
                  <span className="model-dropdown-name">{t.name}</span>
                  <span className="model-dropdown-desc">{t.desc}</span>
                </div>
                {t.id === effortLevel && (
                  <svg
                    className="model-check"
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                  >
                    <path
                      d="M3 7l3 3 5-5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
