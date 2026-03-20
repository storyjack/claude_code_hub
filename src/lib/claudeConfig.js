export const CLAUDE_MODELS = [
  {
    id: "claude-opus-4-6",
    name: "Opus 4.6 (1M context)",
    desc: "Most capable for ambitious work",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Sonnet 4.6",
    desc: "Most efficient for everyday tasks",
  },
  {
    id: "claude-haiku-4-5",
    name: "Haiku 4.5",
    desc: "Fastest for quick answers",
  },
];

export const CLAUDE_EFFORT_LEVELS = [
  { id: "auto", name: "Auto", bars: 0, desc: "使用模型默认推理强度" },
  { id: "low", name: "Low", bars: 1, desc: "更快，适合简单任务" },
  { id: "medium", name: "Medium", bars: 2, desc: "平衡速度与推理" },
  { id: "high", name: "High", bars: 3, desc: "更深入的推理" },
  { id: "max", name: "Max", bars: 4, desc: "仅 Opus 4.6 支持" },
];

const LEGACY_MODEL_IDS = {
  default: "claude-opus-4-6",
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
};

const LEGACY_EFFORT_LEVELS = {
  auto: "auto",
  think: "low",
  "think-hard": "medium",
  "think-harder": "high",
  ultrathink: "max",
};

export function getDefaultModelConfig() {
  return {
    model: "claude-opus-4-6",
    effortLevel: "max",
  };
}

export function normalizeModelId(model) {
  if (LEGACY_MODEL_IDS[model]) {
    return LEGACY_MODEL_IDS[model];
  }
  if (CLAUDE_MODELS.some((item) => item.id === model)) {
    return model;
  }
  return getDefaultModelConfig().model;
}

export function isMaxEffortSupported(model) {
  return normalizeModelId(model) === "claude-opus-4-6";
}

export function normalizeEffortLevel(level, model) {
  const mapped = LEGACY_EFFORT_LEVELS[level] || level;
  const normalizedModel = normalizeModelId(model);
  const allowed = new Set(CLAUDE_EFFORT_LEVELS.map((item) => item.id));
  const fallback = isMaxEffortSupported(normalizedModel) ? "max" : "high";
  const nextLevel = allowed.has(mapped) ? mapped : fallback;
  if (nextLevel === "max" && !isMaxEffortSupported(normalizedModel)) {
    return "high";
  }
  return nextLevel;
}

export function normalizeModelConfig(config = {}) {
  const defaults = getDefaultModelConfig();
  const model = normalizeModelId(config.model || defaults.model);
  return {
    model,
    effortLevel: normalizeEffortLevel(
      config.effortLevel || config.thinkingMode || defaults.effortLevel,
      model,
    ),
  };
}

export function getThreadSortTimestamp(thread) {
  return thread?.lastActiveAt || thread?.createdAt || 0;
}
