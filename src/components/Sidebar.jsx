import React, { useState, useRef, useEffect } from "react";
import { useApp } from "../AppContext";
import { getThreadSortTimestamp } from "../lib/claudeConfig";

function getThreadListOrder(thread) {
  return Number.isFinite(thread?.listOrder)
    ? thread.listOrder
    : thread?.createdAt || 0;
}

function sortThreads(threads, runningThreads, runningOrder) {
  return [...threads].sort((a, b) => {
    const aRunning = runningThreads.has(a.id);
    const bRunning = runningThreads.has(b.id);
    if (aRunning !== bRunning) {
      return aRunning ? -1 : 1;
    }
    if (aRunning && bRunning) {
      const runningDelta = (runningOrder[b.id] || 0) - (runningOrder[a.id] || 0);
      if (runningDelta !== 0) return runningDelta;
    }
    const timeDelta = getThreadSortTimestamp(b) - getThreadSortTimestamp(a);
    if (timeDelta !== 0) return timeDelta;
    const orderDelta = getThreadListOrder(b) - getThreadListOrder(a);
    if (orderDelta !== 0) return orderDelta;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-message">{message}</p>
        <div className="confirm-buttons">
          <button className="confirm-btn confirm-btn-cancel" onClick={onCancel}>
            取消
          </button>
          <button
            className="confirm-btn confirm-btn-danger"
            onClick={onConfirm}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

function CollapsibleThreadList({ collapsed, children }) {
  const contentRef = useRef(null);
  const [height, setHeight] = useState(collapsed ? 0 : "auto");
  const [isAnimating, setIsAnimating] = useState(false);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      setHeight(collapsed ? 0 : "auto");
      return;
    }

    const el = contentRef.current;
    if (!el) return;

    if (collapsed) {
      // Collapse: set explicit height first, then to 0
      setHeight(el.scrollHeight);
      setIsAnimating(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setHeight(0));
      });
    } else {
      // Expand: set to scrollHeight, then auto after transition
      setHeight(el.scrollHeight);
      setIsAnimating(true);
    }
  }, [collapsed]);

  const onTransitionEnd = () => {
    setIsAnimating(false);
    if (!collapsed) setHeight("auto");
  };

  return (
    <div
      ref={contentRef}
      className="thread-list-collapsible"
      style={{
        height: height === "auto" ? "auto" : `${height}px`,
        overflow: isAnimating || collapsed ? "hidden" : "visible",
      }}
      onTransitionEnd={onTransitionEnd}
    >
      {children}
    </div>
  );
}

export default function Sidebar({
  projects,
  activeThreadId,
  runningThreads,
  processingThreads,
  runningOrder,
  timeAgo,
  onSelectThread,
  onAddThread,
  onStopThread,
  onRestartClaude,
  onRenameThread,
  onRemoveThread,
  onRemoveProject,
  onAddProject,
  onProjectSettings,
  onRefreshSessions,
  onToggleTerminal,
  terminalOpen,
  style,
  children,
}) {
  const { t: i } = useApp();
  const [collapsed, setCollapsed] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [newThreadMenu, setNewThreadMenu] = useState(null);
  const [copiedPath, setCopiedPath] = useState(null);

  const toggleProject = (id) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleRemoveThread = (projectId, threadId, threadTitle) => {
    setConfirmDelete({
      type: "thread",
      projectId,
      threadId,
      title: threadTitle,
    });
  };

  const handleRemoveProject = (projectId, projectName) => {
    setConfirmDelete({ type: "project", projectId, title: projectName });
  };

  const confirmAction = () => {
    if (!confirmDelete) return;
    if (confirmDelete.type === "thread") {
      onRemoveThread(confirmDelete.projectId, confirmDelete.threadId);
    } else {
      onRemoveProject(confirmDelete.projectId);
    }
    setConfirmDelete(null);
  };

  return (
    <div className="sidebar" style={style}>
      <div className="sidebar-header">
        <span className="sidebar-title">{i("threads")}</span>
        <div className="sidebar-actions">
          <button
            className="sidebar-icon-btn"
            onClick={onAddProject}
            title={i("addProjectFolder")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 3.5A1.5 1.5 0 013.5 2H6l1 1.5h5.5A1.5 1.5 0 0114 5v7.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9z"
                stroke="currentColor"
                strokeWidth="1.2"
                fill="none"
              />
              <path
                d="M8 7v4M6 9h4"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="sidebar-list">
        {projects.map((project) => {
          const isCollapsed = !!collapsed[project.id];
          const sortedThreads = sortThreads(
            project.threads,
            runningThreads,
            runningOrder,
          );
          const threadCount = project.threads.length;
          const runningCount = project.threads.filter((t) =>
            runningThreads.has(t.id),
          ).length;

          return (
            <div key={project.id} className="project-group">
              <div
                className="project-header"
                onClick={() => toggleProject(project.id)}
              >
                <span className="project-folder-icon">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path
                      d="M2 4.5A1.5 1.5 0 013.5 3H7l1.5 1.5H14.5A1.5 1.5 0 0116 6v7.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 012 13.5v-9z"
                      fill="#8b8b8e"
                      opacity="0.25"
                      stroke="#8b8b8e"
                      strokeWidth="1"
                    />
                  </svg>
                </span>
                <span
                  className="project-name"
                  title={copiedPath === project.id ? i("pathCopied") : (project.cwd || i("copyPath"))}
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (project.cwd) {
                      navigator.clipboard.writeText(project.cwd);
                      setCopiedPath(project.id);
                      setTimeout(() => setCopiedPath(null), 1500);
                    }
                  }}
                >{project.name}</span>
                {threadCount > 0 && (
                  <span
                    className="thread-count-badge"
                    title={`${runningCount} 运行中 / ${threadCount} 总计`}
                  >
                    {runningCount > 0 ? `${runningCount}/` : ""}
                    {threadCount}
                  </span>
                )}
                {Object.keys(project.env || {}).length > 0 && (
                  <span className="env-badge" title="有项目环境变量">
                    E
                  </span>
                )}
                <div className="project-actions">
                  <button
                    className="icon-btn icon-btn-refresh"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onRefreshSessions) onRefreshSessions(project.id);
                    }}
                    title={i("refreshSessions")}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M11.5 2.5v3H8.5M2.5 11.5v-3H5.5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M3 5.5A4.5 4.5 0 018.5 2.5l3 3M11 8.5A4.5 4.5 0 015.5 11.5l-3-3"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    className="icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onProjectSettings(project.id);
                    }}
                    title={i("projectSettings")}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M7 9a2 2 0 100-4 2 2 0 000 4z"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                      <path
                        d="M11.3 8.6l-.7-.4a3.9 3.9 0 000-2.4l.7-.4a.5.5 0 00.2-.6l-.5-.9a.5.5 0 00-.6-.2l-.7.4a3.9 3.9 0 00-2.1-1.2V2.1a.5.5 0 00-.5-.5h-1a.5.5 0 00-.5.5v.8a3.9 3.9 0 00-2.1 1.2l-.7-.4a.5.5 0 00-.6.2l-.5.9a.5.5 0 00.2.6l.7.4a3.9 3.9 0 000 2.4l-.7.4a.5.5 0 00-.2.6l.5.9a.5.5 0 00.6.2l.7-.4a3.9 3.9 0 002.1 1.2v.8a.5.5 0 00.5.5h1a.5.5 0 00.5-.5v-.8a3.9 3.9 0 002.1-1.2l.7.4a.5.5 0 00.6-.2l.5-.9a.5.5 0 00-.2-.6z"
                        stroke="currentColor"
                        strokeWidth="1"
                        fill="none"
                      />
                    </svg>
                  </button>
                  <button
                    className="icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setNewThreadMenu({
                        projectId: project.id,
                        x: rect.left,
                        y: rect.bottom + 4,
                      });
                    }}
                    title={i("newSession")}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M7 2.5v9M2.5 7h9"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                  <button
                    className="icon-btn icon-btn-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveProject(project.id, project.name);
                    }}
                    title={i("deleteProject")}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M3 4h8M5.5 4V3a1 1 0 011-1h1a1 1 0 011 1v1M6 6.5v3M8 6.5v3M4 4l.5 7a1 1 0 001 1h3a1 1 0 001-1L10 4"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <CollapsibleThreadList collapsed={isCollapsed}>
                <div className="thread-list">
                  {sortedThreads.map((thread) => {
                    const isActive = thread.id === activeThreadId;
                    const isRunning = runningThreads.has(thread.id);
                    const isProcessing = processingThreads.has(thread.id);
                    const hasSession = !!thread.claudeSessionId;
                    const showUnread = !!thread.hasUnread && !isRunning && !isActive;
                    return (
                      <div
                        key={thread.id}
                        className={`thread-item ${isActive ? "active" : ""}`}
                        onClick={() =>
                          onSelectThread(
                            thread.id,
                            project.cwd,
                            thread.claudeSessionId,
                            thread.autoConfirm,
                          )
                        }
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            projectId: project.id,
                            threadId: thread.id,
                            title: thread.title,
                          });
                        }}
                      >
                        <div className="thread-status-slot">
                          {isProcessing ? (
                            <span
                              className="thread-status-spinner"
                              title="处理中"
                            />
                          ) : isRunning ? (
                            <span
                              className="thread-status-live-dot"
                              title={i("running")}
                            />
                          ) : showUnread ? (
                            <span
                              className="thread-status-dot"
                              title="待阅读"
                            />
                          ) : (
                            <span className="thread-status-placeholder" />
                          )}
                        </div>
                        <div className="thread-main">
                          <span
                            className="thread-title"
                            title={thread.rawSummary || thread.title}
                          >
                            {thread.title}
                            {thread.autoConfirm && (
                              <span
                                className="auto-confirm-badge"
                                title={i("autoConfirmMode")}
                              >
                                Y
                              </span>
                            )}
                            {(thread.snapshots || []).length > 0 && (
                              <span
                                className="snapshot-count-badge"
                                title={`${(thread.snapshots || []).length} 个快照`}
                              >
                                {(thread.snapshots || []).length}
                              </span>
                            )}
                          </span>
                          <span className="thread-time">
                            {timeAgo(thread.lastActiveAt || thread.createdAt)}
                          </span>
                        </div>
                        <div className="thread-actions">
                          {isRunning && (
                            <button
                              className="icon-btn icon-btn-small icon-btn-restart"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRestartClaude(thread.id);
                              }}
                              title={i("restartClaudeFull")}
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 12 12"
                                fill="none"
                              >
                                <path
                                  d="M10 2v3.5H6.5M2 10V6.5h3.5"
                                  stroke="currentColor"
                                  strokeWidth="1.2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                <path
                                  d="M2.5 4.5A4 4 0 017.5 2.1L10 5.5M9.5 7.5A4 4 0 014.5 9.9L2 6.5"
                                  stroke="currentColor"
                                  strokeWidth="1.2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </button>
                          )}
                          {hasSession && !isRunning && (
                            <span
                              className="session-badge"
                              title={`可恢复: ${thread.claudeSessionId}`}
                            >
                              ↻
                            </span>
                          )}
                          <button
                            className="icon-btn icon-btn-small icon-btn-danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveThread(
                                project.id,
                                thread.id,
                                thread.title,
                              );
                            }}
                            title={i("delete")}
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 12 12"
                              fill="none"
                            >
                              <path
                                d="M2.5 3.5h7M4.5 3.5V3a1 1 0 011-1h1a1 1 0 011 1v.5M5 5.5v2.5M7 5.5v2.5M3.5 3.5l.4 5.6a1 1 0 001 .9h2.2a1 1 0 001-.9l.4-5.6"
                                stroke="currentColor"
                                strokeWidth="1"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {sortedThreads.length === 0 && (
                    <div className="no-threads">{i("noSessions")}</div>
                  )}
                </div>
              </CollapsibleThreadList>
            </div>
          );
        })}

        {projects.length === 0 && (
          <div className="empty-sidebar">
            <p>{i("noProjects")}</p>
            <p className="hint">{i("noProjectsHint")}</p>
          </div>
        )}
      </div>

      {/* Terminal toggle bar */}
      <div className="sidebar-terminal-toggle" onClick={onToggleTerminal}>
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{marginRight: 6, verticalAlign: -1}}>
          <rect x="1" y="3" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
          <path d="M4 7l1.5 1.5L4 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M7 10h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        {i("terminal")}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{marginLeft: 'auto'}}>
          <path d={terminalOpen ? "M2 6l3-3 3 3" : "M2 4l3 3 3-3"} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Terminal slot rendered by parent */}
      {children}

      {newThreadMenu && (
        <div
          className="context-menu-overlay"
          onClick={() => setNewThreadMenu(null)}
        >
          <div
            className="context-menu"
            style={{ top: newThreadMenu.y, left: newThreadMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="context-menu-item"
              onClick={() => {
                onAddThread(newThreadMenu.projectId, false);
                setNewThreadMenu(null);
              }}
            >
              {i("normalSession")}
            </div>
            <div
              className="context-menu-item"
              onClick={() => {
                onAddThread(newThreadMenu.projectId, true);
                setNewThreadMenu(null);
              }}
            >
              {i("autoConfirmSession")}
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="context-menu-overlay"
          onClick={() => setContextMenu(null)}
        >
          <div
            className="context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="context-menu-item"
              onClick={() => {
                onRestartClaude(contextMenu.threadId);
                setContextMenu(null);
              }}
            >
              {i("restartClaude")}
            </div>
            <div
              className="context-menu-item"
              onClick={() => {
                onRenameThread(
                  contextMenu.projectId,
                  contextMenu.threadId,
                  contextMenu.title,
                );
                setContextMenu(null);
              }}
            >
              {i("rename")}
            </div>
            <div
              className="context-menu-item context-menu-danger"
              onClick={() => {
                handleRemoveThread(
                  contextMenu.projectId,
                  contextMenu.threadId,
                  contextMenu.title,
                );
                setContextMenu(null);
              }}
            >
              {i("delete")}
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={
            confirmDelete.type === "thread"
              ? i("confirmDeleteThread", confirmDelete.title)
              : i("confirmDeleteProject", confirmDelete.title)
          }
          onConfirm={confirmAction}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
