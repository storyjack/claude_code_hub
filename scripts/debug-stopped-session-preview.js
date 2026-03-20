// Installed-app smoke for stopped-session preview behavior.
// Run via OPHUB_DEBUG_SCRIPT=/abs/path/to/this/file when launching OpHub.app.
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const targetTitle = window.__OPHUB_DEBUG_TARGET_TITLE__ || "ophub优化";
  const initialWaitMs = Number(window.__OPHUB_DEBUG_INITIAL_WAIT_MS__ || 12000);
  const afterClickWaitMs = Number(window.__OPHUB_DEBUG_AFTER_CLICK_WAIT_MS__ || 1500);

  const findItem = (title) =>
    Array.from(document.querySelectorAll(".thread-item")).find((el) =>
      (el.querySelector(".thread-title")?.textContent || "").includes(title),
    );

  const pickThread = async () => {
    const store = await window.api.store.load();
    for (const project of store.projects || []) {
      const thread = (project.threads || []).find((item) => item.title === targetTitle);
      if (thread) return { project, thread };
    }
    return { project: null, thread: null };
  };

  await sleep(initialWaitMs);
  const before = await pickThread();
  findItem(targetTitle)?.click();
  await sleep(afterClickWaitMs);
  const after = await pickThread();
  const preview = document.querySelector(".terminal-static-preview");

  return {
    activeTitle: document.querySelector(".thread-item.active .thread-title")?.textContent?.trim() || null,
    beforeLastActiveAt: before.thread?.lastActiveAt || null,
    afterLastActiveAt: after.thread?.lastActiveAt || null,
    scrollTop: preview?.scrollTop ?? null,
    clientHeight: preview?.clientHeight ?? null,
    scrollHeight: preview?.scrollHeight ?? null,
    status: document.querySelector(".terminal-status")?.textContent?.trim() || null,
    hasComposer: !!document.querySelector(".terminal-preview-composer textarea"),
  };
})();
