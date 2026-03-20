const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { findClaudeBinary, getCliEnv } = require("./claude-cli");

const STORE_DIR = path.join(os.homedir(), ".claude-code-hub");
const STORE_FILE = path.join(STORE_DIR, "data.json");

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
}

function load() {
  ensureDir();
  if (!fs.existsSync(STORE_FILE)) {
    return { projects: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));
  } catch (e) {
    return { projects: [] };
  }
}

function save(data) {
  ensureDir();
  // Write to temp file first, then rename atomically to prevent corruption
  const tmpFile = STORE_FILE + ".tmp";
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpFile, STORE_FILE);
}

/**
 * Check if a Claude session .jsonl file exists for the given cwd + sessionId.
 */
function sessionExists(cwd, sessionId) {
  const filePath = getSessionFilePath(cwd, sessionId);
  return fs.existsSync(filePath);
}

function getSessionFilePath(cwd, sessionId) {
  const encoded = cwd.replace(/\//g, "-");
  return path.join(
    os.homedir(),
    ".claude",
    "projects",
    encoded,
    sessionId + ".jsonl",
  );
}

function extractPlainText(content, options = {}) {
  const { includeToolResults = true } = options;
  if (!content) return "";
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        if (item.type === "text" && typeof item.text === "string") {
          return item.text;
        }
        if (item.type === "thinking" || item.type === "tool_use") {
          return "";
        }
        if (item.type === "tool_result") {
          if (!includeToolResults) return "";
          if (typeof item.content === "string") return item.content;
          return extractPlainText(item.content, options);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (content.content) return extractPlainText(content.content, options);
  }
  return "";
}

function formatTranscriptEntry(role, text) {
  if (!text) return "";
  const normalized = normalizeTranscriptText(text);
  if (!normalized) return "";
  const prefix = role === "assistant" ? "Claude" : "You";
  return `${prefix}: ${normalized}\n\n`;
}

function normalizeTranscriptText(text) {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function loadSessionTranscriptEntries(cwd, sessionId) {
  const filePath = getSessionFilePath(cwd, sessionId);
  if (!fs.existsSync(filePath)) return [];

  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    const entries = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.isMeta) continue;

        if (
          obj.type === "queue-operation" &&
          obj.operation === "enqueue" &&
          typeof obj.content === "string"
        ) {
          const text = extractPlainText(obj.content, {
            includeToolResults: false,
          });
          const normalized = normalizeTranscriptText(text);
          if (normalized) entries.push({ role: "user", text: normalized });
          continue;
        }

        if (obj.type === "user" && obj.message) {
          const text = extractPlainText(
            obj.message.content || obj.message,
            { includeToolResults: false },
          );
          const normalized = normalizeTranscriptText(text);
          if (normalized) entries.push({ role: "user", text: normalized });
          continue;
        }

        if (obj.type === "assistant" && obj.message) {
          const text = extractPlainText(obj.message.content || obj.message);
          const normalized = normalizeTranscriptText(text);
          if (normalized) entries.push({ role: "assistant", text: normalized });
        }
      } catch (_) {}
    }

    return entries;
  } catch (_) {
    return [];
  }
}

function loadSessionTranscript(cwd, sessionId) {
  return loadSessionTranscriptEntries(cwd, sessionId)
    .map((entry) => formatTranscriptEntry(entry.role, entry.text))
    .join("")
    .trim();
}

/**
 * Scan ~/.claude/projects/ for existing Claude Code projects.
 * Directory names are encoded paths: "-Users-niegang-Desktop-foo" → "/Users/niegang/Desktop/foo"
 * Returns array of { name, cwd, sessions: [{id, ...}] }
 */
function scanClaudeProjects() {
  const claudeDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(claudeDir)) return [];

  const results = [];
  try {
    const entries = fs.readdirSync(claudeDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Decode dir name: leading "-" → "/", remaining "-" → "/"
      const decoded = "/" + entry.name.replace(/^-/, "").replace(/-/g, "/");
      // Only include if the decoded path actually exists
      if (!fs.existsSync(decoded)) continue;

      const projectDir = path.join(claudeDir, entry.name);
      const sessions = [];
      try {
        const files = fs.readdirSync(projectDir);
        for (const f of files) {
          if (f.endsWith(".jsonl")) {
            const sessionId = f.replace(".jsonl", "");
            sessions.push({ id: sessionId });
          }
        }
      } catch (_) {}

      results.push({
        name: path.basename(decoded),
        cwd: decoded,
        encodedName: entry.name,
        sessionCount: sessions.length,
        sessions,
      });
    }
  } catch (_) {}
  return results;
}

/**
 * Scan sessions for a specific project by its cwd.
 * Returns array of { id, lastModified, size, summary }
 */
function scanProjectSessions(cwd) {
  const encoded = cwd.replace(/\//g, "-");
  const projectDir = path.join(os.homedir(), ".claude", "projects", encoded);
  if (!fs.existsSync(projectDir)) return [];

  const sessions = [];
  try {
    const files = fs.readdirSync(projectDir);
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const sessionId = f.replace(".jsonl", "");
      const filePath = path.join(projectDir, f);
      try {
        const stat = fs.statSync(filePath);
        let summary = "";

        // Extract first user message as summary.
        // Claude Code CLI uses "queue-operation" (enqueue) for the first prompt,
        // and "user" type for conversation messages.
        // User messages can be huge (700KB+ with embedded images), so we read
        // the file in chunks and find complete lines to parse.
        try {
          const fd = fs.openSync(filePath, "r");
          const CHUNK_SIZE = 256 * 1024; // 256KB per read
          const MAX_READS = 4; // Up to 1MB total
          let leftover = "";
          let linesChecked = 0;
          const MAX_LINES = 50;

          for (let r = 0; r < MAX_READS && !summary; r++) {
            const buf = Buffer.alloc(CHUNK_SIZE);
            const bytesRead = fs.readSync(
              fd,
              buf,
              0,
              CHUNK_SIZE,
              r * CHUNK_SIZE,
            );
            if (bytesRead === 0) break;
            const text = leftover + buf.toString("utf-8", 0, bytesRead);
            const parts = text.split("\n");
            // Last part may be incomplete — carry it over
            leftover = parts.pop() || "";
            for (const line of parts) {
              if (++linesChecked > MAX_LINES) break;
              if (!line.trim()) continue;
              try {
                const obj = JSON.parse(line);
                // Priority 1: queue-operation enqueue with non-empty content
                if (
                  obj.type === "queue-operation" &&
                  obj.operation === "enqueue" &&
                  obj.content &&
                  obj.content.trim()
                ) {
                  summary = obj.content.slice(0, 120);
                  break;
                }
                // Priority 2: "user" type message (Claude Code CLI format)
                if (obj.type === "user" && obj.message) {
                  const msg = obj.message;
                  if (typeof msg === "string") {
                    summary = msg.slice(0, 120);
                  } else if (msg.content) {
                    if (typeof msg.content === "string") {
                      summary = msg.content.slice(0, 120);
                    } else if (Array.isArray(msg.content)) {
                      const textPart = msg.content.find(
                        (c) => c.type === "text",
                      );
                      if (textPart) summary = textPart.text.slice(0, 120);
                    }
                  }
                  if (summary) break;
                }
                // Priority 3: legacy "human" type (older Claude Code versions)
                if (obj.type === "human") {
                  const msg = obj.message;
                  if (typeof msg === "string") {
                    summary = msg.slice(0, 120);
                  } else if (msg && msg.content) {
                    if (typeof msg.content === "string") {
                      summary = msg.content.slice(0, 120);
                    } else if (Array.isArray(msg.content)) {
                      const textPart = msg.content.find(
                        (c) => c.type === "text",
                      );
                      if (textPart) summary = textPart.text.slice(0, 120);
                    }
                  }
                  if (summary) break;
                }
              } catch (_) {}
            }
          }
          fs.closeSync(fd);
        } catch (_) {}

        sessions.push({
          id: sessionId,
          lastModified: stat.mtimeMs,
          size: stat.size,
          summary,
        });
      } catch (_) {}
    }
    sessions.sort((a, b) => b.lastModified - a.lastModified);
  } catch (_) {}
  return sessions;
}

const TITLE_CACHE_FILE = path.join(STORE_DIR, "title-cache.json");

function loadTitleCache() {
  try {
    if (fs.existsSync(TITLE_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(TITLE_CACHE_FILE, "utf-8"));
    }
  } catch (_) {}
  return {};
}

function saveTitleCache(cache) {
  ensureDir();
  const tmp = TITLE_CACHE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf-8");
  fs.renameSync(tmp, TITLE_CACHE_FILE);
}

/**
 * Generate a short title for a session from its first message.
 * Uses claude CLI with --print and haiku model for speed.
 * Returns cached result if available.
 */
function generateTitle(sessionId, summary) {
  return new Promise((resolve) => {
    if (!summary || !summary.trim()) {
      resolve(null);
      return;
    }

    // Check cache first
    const cache = loadTitleCache();
    if (cache[sessionId]) {
      resolve(cache[sessionId]);
      return;
    }

    // Truncate long summaries to save tokens
    const input = summary.slice(0, 200);
    const prompt = `Generate a short session title (max 5 words, use underscores instead of spaces, like "Deploy_dataware" or "Fix_login_bug" or "ACK_node_query") for this conversation that starts with:\n\n${input}\n\nReturn ONLY the title, nothing else.`;

    const claudeBin = findClaudeBinary() || "claude";

    const args = [
      "-p",
      prompt,
      "--model",
      "haiku",
      "--no-session-persistence",
      "--tools",
      "",
    ];

    execFile(claudeBin, args, {
      timeout: 15000,
      maxBuffer: 1024 * 10,
      env: getCliEnv({
        CLAUDE_CODE_DISABLE_NONESSENTIAL: "1",
        CLAUDE_GUARD_SKIP: "1",
      }),
    }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const title = (stdout || "").trim().replace(/^["']|["']$/g, "").trim();
      if (title && title.length > 0 && title.length < 60) {
        // Cache it
        const cache = loadTitleCache();
        cache[sessionId] = title;
        saveTitleCache(cache);
        resolve(title);
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Batch generate titles for multiple sessions.
 * Returns { sessionId: title } map for successful generations.
 */
async function generateTitles(sessions) {
  const cache = loadTitleCache();
  const results = {};
  const toGenerate = [];

  // Separate cached from uncached
  for (const { sessionId, summary } of sessions) {
    if (cache[sessionId]) {
      results[sessionId] = cache[sessionId];
    } else if (summary && summary.trim()) {
      toGenerate.push({ sessionId, summary });
    }
  }

  // Generate titles sequentially (avoid overwhelming the CLI)
  for (const { sessionId, summary } of toGenerate) {
    const title = await generateTitle(sessionId, summary);
    if (title) {
      results[sessionId] = title;
    }
  }

  return results;
}

module.exports = {
  load,
  save,
  scanClaudeProjects,
  scanProjectSessions,
  sessionExists,
  loadSessionTranscript,
  loadSessionTranscriptEntries,
  generateTitle,
  generateTitles,
  loadTitleCache,
};
