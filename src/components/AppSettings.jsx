import React from "react";
import { CLAUDE_MODELS } from "../lib/claudeConfig";

const LANGUAGES = [
  { id: "zh", name: "中文" },
  { id: "en", name: "English" },
];

const LAYOUTS = [
  { id: "sidebar-left", name: "侧边栏在左" },
  { id: "sidebar-right", name: "侧边栏在右" },
];

const FONT_SIZES = [
  { id: 11, name: "11px" },
  { id: 12, name: "12px" },
  { id: 13, name: "13px" },
  { id: 14, name: "14px" },
  { id: 16, name: "16px" },
];

export default function AppSettings({ settings, onSettingsChange, onClose }) {
  const update = (key, value) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="app-settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>设置</h3>
          <button className="settings-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="app-settings-body">
          <div className="app-settings-row">
            <span className="app-settings-label">语言 / Language</span>
            <div className="app-settings-options">
              {LANGUAGES.map((l) => (
                <button
                  key={l.id}
                  className={`app-settings-option ${settings.language === l.id ? "active" : ""}`}
                  onClick={() => update("language", l.id)}
                >
                  {l.name}
                </button>
              ))}
            </div>
          </div>

          <div className="app-settings-row">
            <span className="app-settings-label">布局方向</span>
            <div className="app-settings-options">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  className={`app-settings-option ${settings.layout === l.id ? "active" : ""}`}
                  onClick={() => update("layout", l.id)}
                >
                  {l.name}
                </button>
              ))}
            </div>
          </div>

          <div className="app-settings-row">
            <span className="app-settings-label">默认模型</span>
            <div className="app-settings-options">
              {CLAUDE_MODELS.map((m) => (
                <button
                  key={m.id}
                  className={`app-settings-option ${settings.defaultModel === m.id ? "active" : ""}`}
                  onClick={() => update("defaultModel", m.id)}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>

          <div className="app-settings-row">
            <span className="app-settings-label">终端字号</span>
            <div className="app-settings-options">
              {FONT_SIZES.map((f) => (
                <button
                  key={f.id}
                  className={`app-settings-option ${settings.terminalFontSize === f.id ? "active" : ""}`}
                  onClick={() => update("terminalFontSize", f.id)}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>

          <div className="app-settings-row">
            <span className="app-settings-label">深色模式</span>
            <div className="app-settings-options">
              <button
                className={`app-settings-option ${settings.darkMode ? "active" : ""}`}
                onClick={() => update("darkMode", !settings.darkMode)}
              >
                {settings.darkMode ? "已开启 ☾" : "已关闭 ☀"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
