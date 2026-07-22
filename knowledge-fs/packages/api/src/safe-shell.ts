import type {
  AuthSubject,
  CommandName,
  CommandRegistry,
  RegisteredCommandResourceType,
} from "@knowledge/core";

export type SafeShellCommandName =
  | "cat"
  | "diff"
  | "find"
  | "grep"
  | "head"
  | "jq"
  | "ls"
  | "stat"
  | "tail"
  | "tree"
  | "wc";

export type SafeShellStepKind = "registry" | "transform";

export interface SafeShellPlanStep {
  readonly argv: readonly string[];
  readonly command: SafeShellCommandName;
  readonly input: Record<string, unknown>;
  readonly kind: SafeShellStepKind;
  readonly resourceType?: RegisteredCommandResourceType;
}

export interface SafeShellPlan {
  readonly command: string;
  readonly steps: readonly SafeShellPlanStep[];
}

export interface SafeShellExecutionResult {
  readonly output: unknown;
  readonly plan: SafeShellPlan;
  readonly truncated: boolean;
}

export interface SafeShellOptions {
  readonly defaultLimit?: number | undefined;
  readonly knowledgeSpaceId: string;
  readonly maxListLimit?: number | undefined;
  readonly maxOutputBytes?: number | undefined;
  readonly maxPipelineCommands?: number | undefined;
  readonly registries: Partial<Record<RegisteredCommandResourceType, CommandRegistry>>;
  readonly subject: AuthSubject;
  readonly traceId?: string | undefined;
}

export interface SafeShell {
  execute(command: string): Promise<SafeShellExecutionResult>;
  plan(command: string): SafeShellPlan;
}

const safeShellRegistryCommands = new Set<SafeShellCommandName>([
  "cat",
  "diff",
  "find",
  "grep",
  "ls",
  "stat",
  "tree",
]);
const safeShellTransformCommands = new Set<SafeShellCommandName>(["head", "jq", "tail", "wc"]);
const safeShellAllowlist = new Set<SafeShellCommandName>([
  ...safeShellRegistryCommands,
  ...safeShellTransformCommands,
]);

export function createSafeShell({
  defaultLimit = 20,
  knowledgeSpaceId,
  maxListLimit = 100,
  maxOutputBytes = 128 * 1024,
  maxPipelineCommands = 5,
  registries,
  subject,
  traceId,
}: SafeShellOptions): SafeShell {
  validateSafeShellBound("defaultLimit", defaultLimit);
  validateSafeShellBound("maxListLimit", maxListLimit);
  validateSafeShellBound("maxOutputBytes", maxOutputBytes);
  validateSafeShellBound("maxPipelineCommands", maxPipelineCommands);

  const plan = (command: string) =>
    planSafeShellCommand({
      command,
      defaultLimit,
      knowledgeSpaceId,
      maxListLimit,
      maxPipelineCommands,
    });

  return {
    execute: async (command) => {
      const shellPlan = plan(command);
      let output: unknown;

      for (const step of shellPlan.steps) {
        if (step.kind === "registry") {
          const resourceType = step.resourceType;

          if (!resourceType) {
            throw new Error("Safe shell registry step is missing resource type");
          }

          const registry = registries[resourceType];

          if (!registry) {
            throw new Error(
              `Safe shell registry for resource type ${resourceType} is not configured`,
            );
          }

          const result = await registry.execute({
            context: {
              resourceType,
              subject,
              ...(traceId ? { traceId } : {}),
            },
            input: step.input,
            name: step.command as CommandName,
          });
          output = result.output;
          continue;
        }

        output = applySafeShellTransform(step, output);
      }

      const bounded = boundSafeShellOutput(output, maxOutputBytes);

      return {
        output: bounded.output,
        plan: shellPlan,
        truncated: bounded.truncated,
      };
    },
    plan,
  };
}

export function summarizeWorkspaceReplayOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }

  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function planSafeShellCommand({
  command,
  defaultLimit,
  knowledgeSpaceId,
  maxListLimit,
  maxPipelineCommands,
}: {
  readonly command: string;
  readonly defaultLimit: number;
  readonly knowledgeSpaceId: string;
  readonly maxListLimit: number;
  readonly maxPipelineCommands: number;
}): SafeShellPlan {
  const tokenGroups = tokenizeSafeShellCommand(command);

  if (tokenGroups.length > maxPipelineCommands) {
    throw new Error(`Safe shell pipeline exceeds maxPipelineCommands=${maxPipelineCommands}`);
  }

  const steps = tokenGroups.map((tokens, index): SafeShellPlanStep => {
    const commandName = parseSafeShellCommandName(tokens[0]);
    const argv = tokens.slice(1);

    if (safeShellRegistryCommands.has(commandName) && index > 0) {
      throw new Error("Safe shell registry commands must be the first pipeline step");
    }

    if (safeShellRegistryCommands.has(commandName)) {
      const input = buildSafeShellRegistryInput({
        argv,
        command: commandName,
        defaultLimit,
        knowledgeSpaceId,
        maxListLimit,
      });
      const path = typeof input.path === "string" ? input.path : String(input.oldPath ?? "");

      return {
        argv,
        command: commandName,
        input,
        kind: "registry",
        resourceType: safeShellResourceTypeForPath(path),
      };
    }

    return {
      argv,
      command: commandName,
      input: buildSafeShellTransformInput(commandName, argv),
      kind: "transform",
    };
  });

  return {
    command,
    steps,
  };
}

function tokenizeSafeShellCommand(command: string): string[][] {
  if (/[;&<>`]/u.test(command) || command.includes("$(")) {
    throw new Error("Safe shell command contains unsupported host-shell syntax");
  }

  const groups: string[][] = [[]];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "|") {
      pushSafeShellToken(groups.at(-1), current);
      current = "";
      groups.push([]);
      continue;
    }

    if (/\s/u.test(char)) {
      pushSafeShellToken(groups.at(-1), current);
      current = "";
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error("Safe shell command has an unterminated quote");
  }

  pushSafeShellToken(groups.at(-1), current);

  if (groups.some((group) => group.length === 0)) {
    throw new Error("Safe shell pipeline contains an empty command");
  }

  return groups;
}

function pushSafeShellToken(group: string[] | undefined, token: string): void {
  if (group && token.length > 0) {
    group.push(token);
  }
}

function parseSafeShellCommandName(value: string | undefined): SafeShellCommandName {
  if (!value) {
    throw new Error("Safe shell command is required");
  }

  if (!safeShellAllowlist.has(value as SafeShellCommandName)) {
    throw new Error(`Safe shell command ${value} is not allowlisted`);
  }

  return value as SafeShellCommandName;
}

function buildSafeShellRegistryInput({
  argv,
  command,
  defaultLimit,
  knowledgeSpaceId,
  maxListLimit,
}: {
  readonly argv: readonly string[];
  readonly command: SafeShellCommandName;
  readonly defaultLimit: number;
  readonly knowledgeSpaceId: string;
  readonly maxListLimit: number;
}): Record<string, unknown> {
  const { flags, positionals } = parseSafeShellArgs(argv);

  if (command === "cat" || command === "stat") {
    const path = requireSafeShellPath(positionals, command);

    return {
      knowledgeSpaceId,
      path,
    };
  }

  if (command === "ls" || command === "tree" || command === "find") {
    const path = requireSafeShellPath(positionals, command);
    const limit = safeShellLimit(flags.limit, defaultLimit, maxListLimit, command);

    return {
      knowledgeSpaceId,
      limit,
      path,
      ...(command === "tree" && flags.depth
        ? { depth: positiveIntegerFlag(flags.depth, "depth") }
        : {}),
      ...(command === "find" && flags["name-contains"]
        ? { nameContains: flags["name-contains"] }
        : {}),
    };
  }

  if (command === "grep") {
    if (positionals.length < 2) {
      throw new Error("Safe shell grep requires query and path");
    }

    const [q, path] = positionals;
    const limit = safeShellLimit(flags.limit, defaultLimit, maxListLimit, command);

    return {
      knowledgeSpaceId,
      limit,
      path,
      q,
    };
  }

  if (command === "diff") {
    if (positionals.length < 2) {
      throw new Error("Safe shell diff requires old and new paths");
    }

    return {
      knowledgeSpaceId,
      mode: flags.mode ?? "line",
      newPath: positionals[1],
      oldPath: positionals[0],
    };
  }

  throw new Error(`Safe shell command ${command} is not a registry command`);
}

function buildSafeShellTransformInput(
  command: SafeShellCommandName,
  argv: readonly string[],
): Record<string, unknown> {
  const { flags, positionals } = parseSafeShellArgs(argv);

  if (command === "head" || command === "tail") {
    return {
      lines: positiveIntegerFlag(flags.n ?? flags.lines ?? "10", "n"),
    };
  }

  if (command === "jq") {
    const selector = positionals[0];

    if (!selector) {
      throw new Error("Safe shell jq requires a selector");
    }

    return { selector };
  }

  return {};
}

function parseSafeShellArgs(argv: readonly string[]): {
  readonly flags: Record<string, string>;
  readonly positionals: string[];
} {
  const flags: Record<string, string> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === undefined) {
      continue;
    }

    if (token === "-n") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("Safe shell flag -n requires a value");
      }

      flags.n = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      const name = token.slice(2);
      const value = argv[index + 1];

      if (!name || !value || value.startsWith("--")) {
        throw new Error(`Safe shell flag ${token} requires a value`);
      }

      flags[name] = value;
      index += 1;
      continue;
    }

    positionals.push(token);
  }

  return { flags, positionals };
}

function requireSafeShellPath(
  positionals: readonly string[],
  command: SafeShellCommandName,
): string {
  const path = positionals[0];

  if (!path) {
    throw new Error(`Safe shell ${command} requires a path`);
  }

  return path;
}

function safeShellLimit(
  value: string | undefined,
  defaultLimit: number,
  maxListLimit: number,
  command: SafeShellCommandName,
): number {
  const limit = value === undefined ? defaultLimit : positiveIntegerFlag(value, "limit");

  if (limit > maxListLimit) {
    throw new Error(`Safe shell ${command} limit exceeds maxListLimit=${maxListLimit}`);
  }

  return limit;
}

function positiveIntegerFlag(value: string, name: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Safe shell flag ${name} must be an integer >= 1`);
  }

  return parsed;
}

function safeShellResourceTypeForPath(path: string): RegisteredCommandResourceType {
  if (path.startsWith("/sources")) {
    return "source";
  }

  if (path.startsWith("/evidence")) {
    return "evidence";
  }

  return "workspace";
}

function applySafeShellTransform(step: SafeShellPlanStep, input: unknown): unknown {
  if (step.command === "head" || step.command === "tail") {
    return applySafeShellLineTransform(input, Number(step.input.lines), step.command);
  }

  if (step.command === "wc") {
    return countSafeShellText(extractSafeShellText(input));
  }

  if (step.command === "jq") {
    return selectSafeShellJson(input, String(step.input.selector));
  }

  throw new Error(`Safe shell transform ${step.command} is not implemented`);
}

function applySafeShellLineTransform(
  input: unknown,
  lines: number,
  command: "head" | "tail",
): unknown {
  const text = extractSafeShellText(input);
  const split = text.split(/\r?\n/u);
  const nextText = (command === "head" ? split.slice(0, lines) : split.slice(-lines)).join("\n");

  if (isRecord(input) && typeof input.text === "string") {
    return {
      ...input,
      text: nextText,
      truncated: Boolean(input.truncated) || split.length > lines,
    };
  }

  return nextText;
}

function extractSafeShellText(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (isRecord(input) && typeof input.text === "string") {
    return input.text;
  }

  return JSON.stringify(input ?? "");
}

function countSafeShellText(text: string): {
  readonly bytes: number;
  readonly lines: number;
  readonly words: number;
} {
  const trimmed = text.trim();

  return {
    bytes: new TextEncoder().encode(text).byteLength,
    lines: text.length === 0 ? 0 : text.split(/\r?\n/u).length,
    words: trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length,
  };
}

function selectSafeShellJson(input: unknown, selector: string): unknown {
  if (!selector.startsWith(".")) {
    throw new Error("Safe shell jq selector must start with .");
  }

  let value = input;
  const parts = selector
    .slice(1)
    .split(".")
    .flatMap((part) => part.split(/(\[\d+\])/u).filter(Boolean));

  for (const part of parts) {
    const arrayIndex = part.match(/^\[(\d+)\]$/u)?.[1];

    if (arrayIndex !== undefined) {
      if (!Array.isArray(value)) {
        return null;
      }

      value = value[Number(arrayIndex)];
      continue;
    }

    if (!isRecord(value)) {
      return null;
    }

    value = value[part];
  }

  return value ?? null;
}

function boundSafeShellOutput(
  output: unknown,
  maxOutputBytes: number,
): { readonly output: unknown; readonly truncated: boolean } {
  if (typeof output === "string") {
    const bytes = new TextEncoder().encode(output);

    if (bytes.byteLength <= maxOutputBytes) {
      return { output, truncated: false };
    }

    return {
      output: output.slice(0, maxOutputBytes),
      truncated: true,
    };
  }

  if (isRecord(output) && typeof output.text === "string") {
    const bounded = boundSafeShellOutput(output.text, maxOutputBytes);

    return bounded.truncated
      ? {
          output: {
            ...output,
            text: bounded.output,
            truncated: true,
          },
          truncated: true,
        }
      : { output, truncated: Boolean(output.truncated) };
  }

  return { output, truncated: false };
}

function validateSafeShellBound(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Safe shell ${name} must be an integer >= 1`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
