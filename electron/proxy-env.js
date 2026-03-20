const { execSync } = require("child_process");

function normalizeNoProxyEntry(entry) {
  const value = String(entry || "").trim();
  if (!value || value === "<local>") return null;
  if (value.startsWith("*.")) return "." + value.slice(2);
  return value;
}

function parseScutilProxy(output) {
  const values = {};
  const exceptions = [];
  let inExceptions = false;

  for (const rawLine of String(output || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("ExceptionsList")) {
      inExceptions = true;
      continue;
    }

    if (inExceptions) {
      if (line === "}") {
        inExceptions = false;
        continue;
      }
      const match = line.match(/^\d+\s*:\s*(.+)$/);
      if (match) {
        const normalized = normalizeNoProxyEntry(match[1]);
        if (normalized) exceptions.push(normalized);
      }
      continue;
    }

    const match = line.match(/^([A-Za-z0-9]+)\s*:\s*(.+)$/);
    if (match) {
      values[match[1]] = match[2].trim();
    }
  }

  return { values, exceptions };
}

function setProxyVar(env, upperKey, lowerKey, value) {
  if (!value) return;
  if (env[upperKey] || env[lowerKey]) return;
  env[upperKey] = value;
  env[lowerKey] = value;
}

function getSystemProxyEnv(baseEnv = process.env) {
  if (process.platform !== "darwin") return {};

  try {
    const output = execSync("/usr/sbin/scutil --proxy", {
      encoding: "utf-8",
      timeout: 3000,
    });
    const { values, exceptions } = parseScutilProxy(output);
    const env = {};

    const httpProxy =
      values.HTTPEnable === "1" && values.HTTPProxy && values.HTTPPort
        ? `http://${values.HTTPProxy}:${values.HTTPPort}`
        : "";
    const httpsProxy =
      values.HTTPSEnable === "1" && values.HTTPSProxy && values.HTTPSPort
        ? `http://${values.HTTPSProxy}:${values.HTTPSPort}`
        : httpProxy;
    const allProxy = httpsProxy || httpProxy;
    const noProxy = exceptions.join(",");

    setProxyVar(env, "HTTP_PROXY", "http_proxy", httpProxy);
    setProxyVar(env, "HTTPS_PROXY", "https_proxy", httpsProxy);
    setProxyVar(env, "ALL_PROXY", "all_proxy", allProxy);
    setProxyVar(env, "NO_PROXY", "no_proxy", noProxy);

    return Object.fromEntries(
      Object.entries(env).filter(
        ([key]) => !baseEnv[key] && env[key] && String(env[key]).trim(),
      ),
    );
  } catch (_) {
    return {};
  }
}

module.exports = { getSystemProxyEnv };
