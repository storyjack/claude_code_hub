import React, { useState } from "react";

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export default function SnapshotPanel({
  snapshots = [],
  threadTitle,
  onCreateSnapshot,
  onBranch,
  onDelete,
  onClose,
}) {
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div className="snapshot-overlay" onClick={onClose}>
      <div className="snapshot-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>会话快照 — {threadTitle}</h3>
          <button className="settings-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="snapshot-toolbar">
          <button className="snapshot-create-btn" onClick={onCreateSnapshot}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 2.5v9M2.5 7h9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            创建快照
          </button>
          <span className="snapshot-count-label">
            {snapshots.length} 个快照
          </span>
        </div>

        <div className="snapshot-list">
          {snapshots.length === 0 ? (
            <div className="snapshot-empty">
              <svg
                width="40"
                height="40"
                viewBox="0 0 40 40"
                fill="none"
                style={{ opacity: 0.3, marginBottom: 12 }}
              >
                <rect
                  x="6"
                  y="8"
                  width="28"
                  height="24"
                  rx="3"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <circle
                  cx="20"
                  cy="20"
                  r="6"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <circle cx="20" cy="20" r="2" fill="currentColor" />
              </svg>
              <p>暂无快照</p>
              <p className="hint">
                创建快照保存当前终端状态，随时可从快照分支出新会话
              </p>
            </div>
          ) : (
            snapshots.map((snap) => (
              <div key={snap.id} className="snapshot-item">
                <div
                  className="snapshot-item-header"
                  onClick={() =>
                    setExpandedId(expandedId === snap.id ? null : snap.id)
                  }
                >
                  <div className="snapshot-info">
                    <span className="snapshot-title">{snap.title}</span>
                    <span className="snapshot-meta">
                      {new Date(snap.timestamp).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" · "}
                      {formatBytes(snap.bufferContent?.length || 0)}
                    </span>
                  </div>
                  <div className="snapshot-item-actions">
                    <button
                      className="snapshot-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onBranch(snap.id);
                      }}
                      title="从此快照创建分支会话"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                      >
                        <path
                          d="M4 2v6a3 3 0 003 3h1M10 2v4a3 3 0 01-3 3"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                        />
                        <circle
                          cx="4"
                          cy="2"
                          r="1.5"
                          stroke="currentColor"
                          strokeWidth="1"
                        />
                        <circle
                          cx="10"
                          cy="2"
                          r="1.5"
                          stroke="currentColor"
                          strokeWidth="1"
                        />
                        <circle
                          cx="8"
                          cy="11"
                          r="1.5"
                          stroke="currentColor"
                          strokeWidth="1"
                        />
                      </svg>
                      分支
                    </button>
                    <button
                      className="snapshot-action-btn snapshot-action-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(snap.id);
                      }}
                      title="删除快照"
                    >
                      删除
                    </button>
                  </div>
                </div>
                {expandedId === snap.id && snap.bufferContent && (
                  <div className="snapshot-preview">
                    <pre>{snap.bufferContent.slice(0, 2000)}</pre>
                    {snap.bufferContent.length > 2000 && (
                      <span className="snapshot-preview-more">
                        ... 还有 {formatBytes(snap.bufferContent.length - 2000)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
