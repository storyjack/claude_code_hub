const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, execSync } = require("child_process");

const CLAUDE_PATHS = [
  path.join(os.homedir(), ".local", "bin", "claude"),
  path.join(os.homedir(), ".claude", "local", "claude"),
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
];

function ensureHomeBinFirst(currentPath) {
  const homeBin = path.join(os.homedir(), "bin");
  if (!fs.existsSync(homeBin)) {
    return currentPath;
  }

  const entries = (currentPath || "").split(":").filter(Boolean);
  const filtered = entries.filter((entry) => entry !== homeBin);
  return [homeBin, ...filtered].join(":");
}

function getShellPath() {
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    return execSync(`${shell} -ilc "echo \\$PATH"`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch (_) {
    const extra = [
      path.join(os.homedir(), ".local", "bin"),
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ];
    const current = new Set((process.env.PATH || "").split(":").filter(Boolean));
    for (const item of extra) {
      current.add(item);
    }
    return Array.from(current).join(":");
  }
}

function getCliPath() {
  return ensureHomeBinFirst(getShellPath());
}

function getCliEnv(extra = {}) {
  const env = {
    ...process.env,
    ...extra,
    PATH: getCliPath(),
  };
  delete env.CLAUDECODE;
  return env;
}

function findBinary(name, knownPaths = []) {
  for (const candidate of knownPaths) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    return execSync(`which ${name}`, {
      encoding: "utf-8",
      timeout: 5000,
      env: getCliEnv(),
    }).trim();
  } catch (_) {
    return null;
  }
}

function findClaudeBinary() {
  return findBinary("claude", CLAUDE_PATHS);
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        encoding: "utf-8",
        ...options,
      },
      (error, stdout = "", stderr = "") => {
        resolve({
          error,
          stdout,
          stderr,
          exitCode:
            typeof error?.code === "number"
              ? error.code
              : error
                ? 1
                : 0,
        });
      },
    );
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function shellJoin(args) {
  return args.map(shellQuote).join(" ");
}

function normalizeClaudeError(output, fallbackMessage) {
  const text = `${output || ""} ${fallbackMessage || ""}`.trim();
  if (!text) return null;
  if (/OAuth token has expired/i.test(text)) {
    return "OAuth token expired";
  }
  if (/Please run \/login/i.test(text)) {
    return "Claude login required";
  }
  return text.split("\n").find(Boolean)?.trim() || text;
}

async function getClaudeVersion(claudePath) {
  if (!claudePath) return null;
  const result = await execFileAsync(claudePath, ["--version"], {
    timeout: 10000,
    env: getCliEnv(),
  });
  if (result.exitCode !== 0) {
    return null;
  }
  return (result.stdout || "").trim() || null;
}

async function getClaudeAuthStatus({ claudePath } = {}) {
  const resolvedPath = claudePath || findClaudeBinary();
  if (!resolvedPath) {
    return {
      installed: false,
      loggedIn: false,
      needsLogin: true,
      authError: "Claude Code CLI not found",
      claudePath: null,
    };
  }

  const result = await execFileAsync(resolvedPath, ["auth", "status"], {
    timeout: 15000,
    env: getCliEnv(),
  });

  if (result.exitCode !== 0) {
    return {
      installed: true,
      loggedIn: false,
      needsLogin: true,
      authError: normalizeClaudeError(
        `${result.stdout}\n${result.stderr}`,
        result.error?.message,
      ),
      claudePath: resolvedPath,
    };
  }

  try {
    const parsed = JSON.parse(result.stdout || "{}");
    return {
      installed: true,
      loggedIn: !!parsed.loggedIn,
      needsLogin: !parsed.loggedIn,
      authMethod: parsed.authMethod || null,
      apiProvider: parsed.apiProvider || null,
      email: parsed.email || null,
      orgId: parsed.orgId || null,
      orgName: parsed.orgName || null,
      subscriptionType: parsed.subscriptionType || null,
      authError: null,
      claudePath: resolvedPath,
    };
  } catch (_) {
    return {
      installed: true,
      loggedIn: false,
      needsLogin: true,
      authError: normalizeClaudeError(
        `${result.stdout}\n${result.stderr}`,
        "Failed to parse Claude auth status",
      ),
      claudePath: resolvedPath,
    };
  }
}

async function getClaudeStatus({ claudePath } = {}) {
  const resolvedPath = claudePath || findClaudeBinary();
  const auth = await getClaudeAuthStatus({ claudePath: resolvedPath });
  const version = await getClaudeVersion(auth.claudePath);
  return {
    ...auth,
    version,
  };
}

async function loginClaude({ claudePath, email } = {}) {
  const resolvedPath = claudePath || findClaudeBinary();
  if (!resolvedPath) {
    return {
      success: false,
      status: {
        installed: false,
        loggedIn: false,
        needsLogin: true,
        authError: "Claude Code CLI not found",
        claudePath: null,
      },
      error: "Claude Code CLI not found",
    };
  }

  const args = ["auth", "login"];
  if (email) {
    args.push("--email", email);
  }

  const result = await execFileAsync(resolvedPath, args, {
    timeout: 10 * 60 * 1000,
    env: getCliEnv(),
  });
  const status = await getClaudeStatus({ claudePath: resolvedPath });
  return {
    success: !!status.loggedIn,
    status,
    stdout: result.stdout,
    stderr: result.stderr,
    error:
      result.exitCode === 0
        ? status.loggedIn
          ? null
          : status.authError || "Claude login did not complete"
        : normalizeClaudeError(
            `${result.stdout}\n${result.stderr}`,
            result.error?.message,
          ),
  };
}

function buildClaudeLaunchCommand({
  claudePath,
  model,
  effortLevel,
  sessionId,
  isResume,
  autoConfirm,
  prompt = "hi",
}) {
  const args = [claudePath];
  if (model) {
    args.push("--model", model);
  }
  if (
    effortLevel &&
    ["low", "medium", "high", "max"].includes(effortLevel)
  ) {
    args.push("--effort", effortLevel);
  }
  if (autoConfirm) {
    args.push("--dangerously-skip-permissions");
  }
  if (isResume) {
    args.push("--resume", sessionId);
  } else {
    args.push("--session-id", sessionId, prompt);
  }
  return shellJoin(args);
}

module.exports = {
  findBinary,
  findClaudeBinary,
  getCliEnv,
  getCliPath,
  getShellPath,
  getClaudeVersion,
  getClaudeAuthStatus,
  getClaudeStatus,
  loginClaude,
  buildClaudeLaunchCommand,
  shellJoin,
  shellQuote,
};
