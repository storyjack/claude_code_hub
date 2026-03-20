import React, { useState } from "react";

export default function ProjectSettings({ project, onSave, onClose }) {
  const [name, setName] = useState(project.name || "");
  const [envText, setEnvText] = useState(
    Object.entries(project.env || {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );
  const [shell, setShell] = useState(project.settings?.shell || "/bin/zsh");

  const handleSave = () => {
    const env = {};
    envText.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
      }
    });
    onSave({
      name: name.trim() || project.name,
      env,
      settings: { shell },
    });
  };

  const handleChangeCwd = async () => {
    const cwd = await window.api.selectDirectory();
    if (cwd) {
      onSave({
        name: name.trim() || project.name,
        cwd,
        env: Object.fromEntries(
          envText
            .split("\n")
            .filter((l) => l.trim() && !l.trim().startsWith("#"))
            .map((l) => {
              const i = l.indexOf("=");
              return i > 0
                ? [l.slice(0, i).trim(), l.slice(i + 1).trim()]
                : null;
            })
            .filter(Boolean),
        ),
        settings: { shell },
      });
    }
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>项目设置</h3>
          <button className="settings-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-field">
            <label>项目名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="项目名称"
            />
          </div>

          <div className="settings-field">
            <label>工作目录</label>
            <div className="settings-cwd-row">
              <span className="settings-cwd-path">{project.cwd}</span>
              <button className="settings-btn-small" onClick={handleChangeCwd}>
                更改
              </button>
            </div>
          </div>

          <div className="settings-field">
            <label>Shell</label>
            <select value={shell} onChange={(e) => setShell(e.target.value)}>
              <option value="/bin/zsh">zsh</option>
              <option value="/bin/bash">bash</option>
              <option value="/bin/sh">sh</option>
            </select>
          </div>

          <div className="settings-field">
            <label>
              环境变量
              <span className="settings-hint">
                每行一个，格式: KEY=VALUE，# 开头为注释
              </span>
            </label>
            <textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder={`# 项目专用环境变量\nNODE_ENV=development\nLOG_LEVEL=debug`}
              rows={8}
              spellCheck={false}
            />
          </div>
        </div>

        <div className="settings-footer">
          <button className="settings-btn-cancel" onClick={onClose}>
            取消
          </button>
          <button className="settings-btn-save" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
