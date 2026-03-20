import React, { useState } from "react";

// Claude API pricing (per million tokens, USD)
const PRICING = {
  sonnet: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  opus:   { input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
  haiku:  { input: 0.25, output: 1.25, cache_read: 0.025, cache_write: 0.3 },
};

function estimateCost(tokensInput, tokensOutput, model = "sonnet") {
  const p = PRICING[model] || PRICING.sonnet;
  return (tokensInput / 1e6) * p.input + (tokensOutput / 1e6) * p.output;
}

function formatCost(cost) {
  if (!cost || cost < 0.001) return "$0.00";
  if (cost < 0.01) return "$" + cost.toFixed(4);
  return "$" + cost.toFixed(2);
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatTokens(n) {
  if (!n) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function formatDuration(ms) {
  if (!ms || ms < 60000) return "< 1 分钟";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return mins + " 分钟";
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hours < 24)
    return hours + " 小时" + (remainMins > 0 ? " " + remainMins + " 分" : "");
  const days = Math.floor(hours / 24);
  return days + " 天";
}

export default function UsageStats({ projects, onClose, currentModel }) {
  const [expandedProject, setExpandedProject] = useState(null);

  const projectStats = projects.map((p) => {
    const stats = {
      id: p.id,
      name: p.name,
      threadCount: p.threads.length,
      totalInteractions: 0,
      totalOutputBytes: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      totalCost: 0,
      totalDuration: 0,
      totalSnapshots: 0,
      threads: [],
    };

    p.threads.forEach((t) => {
      const usage = t.usage || {};
      const interactions = usage.interactions || 0;
      const outputBytes = usage.outputBytes || 0;
      const tokens = usage.tokens || {};
      const cost = usage.cost || 0;
      const duration = (t.lastActiveAt || t.createdAt) - t.createdAt;
      const snapshotCount = (t.snapshots || []).length;

      stats.totalInteractions += interactions;
      stats.totalOutputBytes += outputBytes;
      stats.totalTokensInput += tokens.input || 0;
      stats.totalTokensOutput += tokens.output || 0;
      stats.totalCost += cost;
      stats.totalDuration += duration;
      stats.totalSnapshots += snapshotCount;

      stats.threads.push({
        title: t.title,
        interactions,
        outputBytes,
        tokensInput: tokens.input || 0,
        tokensOutput: tokens.output || 0,
        cost,
        duration,
        snapshots: snapshotCount,
      });
    });

    return stats;
  });

  const model = currentModel || "sonnet";

  const grandTotal = {
    projects: projectStats.length,
    threads: projectStats.reduce((s, p) => s + p.threadCount, 0),
    interactions: projectStats.reduce((s, p) => s + p.totalInteractions, 0),
    outputBytes: projectStats.reduce((s, p) => s + p.totalOutputBytes, 0),
    tokensInput: projectStats.reduce((s, p) => s + p.totalTokensInput, 0),
    tokensOutput: projectStats.reduce((s, p) => s + p.totalTokensOutput, 0),
    cost: projectStats.reduce((s, p) => s + p.totalCost, 0),
    snapshots: projectStats.reduce((s, p) => s + p.totalSnapshots, 0),
  };

  const totalTokens = grandTotal.tokensInput + grandTotal.tokensOutput;
  // Use parsed cost if available, otherwise estimate from tokens
  const displayCost = grandTotal.cost > 0
    ? grandTotal.cost
    : estimateCost(grandTotal.tokensInput, grandTotal.tokensOutput, model);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="usage-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>用量统计</h3>
          <button className="settings-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="usage-body">
          <div className="usage-summary">
            <div className="usage-card">
              <span className="usage-card-value">{grandTotal.projects}</span>
              <span className="usage-card-label">项目</span>
            </div>
            <div className="usage-card">
              <span className="usage-card-value">{grandTotal.threads}</span>
              <span className="usage-card-label">会话</span>
            </div>
            <div className="usage-card">
              <span className="usage-card-value">
                {grandTotal.interactions}
              </span>
              <span className="usage-card-label">交互次数</span>
            </div>
            <div className="usage-card">
              <span className="usage-card-value">
                {formatBytes(grandTotal.outputBytes)}
              </span>
              <span className="usage-card-label">输出数据</span>
            </div>
            {totalTokens > 0 && (
              <div className="usage-card">
                <span className="usage-card-value">
                  {formatTokens(totalTokens)}
                </span>
                <span className="usage-card-label">Tokens</span>
              </div>
            )}
            <div className="usage-card">
              <span className="usage-card-value">
                {formatCost(displayCost)}
              </span>
              <span className="usage-card-label">
                预估费用 ({model})
              </span>
            </div>
          </div>

          <div className="usage-projects">
            {projectStats.map((p) => {
              const isExpanded = expandedProject === p.id;
              const pTokens = p.totalTokensInput + p.totalTokensOutput;
              return (
                <div key={p.id} className="usage-project">
                  <div
                    className="usage-project-header"
                    onClick={() => setExpandedProject(isExpanded ? null : p.id)}
                  >
                    <span className="usage-project-arrow">
                      {isExpanded ? "▾" : "▸"}
                    </span>
                    <span className="usage-project-name">{p.name}</span>
                    <span className="usage-project-meta">
                      {p.threadCount} 会话 · {p.totalInteractions} 交互 ·{" "}
                      {formatBytes(p.totalOutputBytes)}
                      {pTokens > 0 && ` · ${formatTokens(pTokens)} tokens`}
                      {` · ${formatCost(p.totalCost > 0 ? p.totalCost : estimateCost(p.totalTokensInput, p.totalTokensOutput, model))}`}
                    </span>
                  </div>
                  {isExpanded && p.threads.length > 0 && (
                    <div className="usage-thread-table">
                      <div className="usage-thread-header-row">
                        <span className="usage-col-name">会话</span>
                        <span className="usage-col">交互</span>
                        <span className="usage-col">输出</span>
                        <span className="usage-col">Tokens</span>
                        <span className="usage-col">时长</span>
                        <span className="usage-col">快照</span>
                      </div>
                      {p.threads.map((t, j) => (
                        <div key={j} className="usage-thread-row">
                          <span className="usage-col-name">{t.title}</span>
                          <span className="usage-col">{t.interactions}</span>
                          <span className="usage-col">
                            {formatBytes(t.outputBytes)}
                          </span>
                          <span className="usage-col">
                            {t.tokensInput + t.tokensOutput > 0
                              ? formatTokens(t.tokensInput + t.tokensOutput)
                              : "—"}
                          </span>
                          <span className="usage-col">
                            {formatDuration(t.duration)}
                          </span>
                          <span className="usage-col">{t.snapshots}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {projectStats.length === 0 && (
              <div className="usage-empty">暂无项目数据</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
