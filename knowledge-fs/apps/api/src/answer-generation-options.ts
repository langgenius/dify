import type { LlmProvider } from "@knowledge/generation";

import {
  type ChatProviderPluginDaemonConfig,
  createChatProvider,
  positiveIntegerEnv,
  trimmed,
} from "./generation-provider";
import {
  type PluginDaemonClientEnv,
  parsePluginDaemonCredentials,
  pluginDaemonRequired,
} from "./plugin-daemon-options";

export interface ApiAnswerGenerationEnv extends PluginDaemonClientEnv {
  readonly KNOWLEDGE_ANSWER_MAX_OUTPUT_TOKENS?: string | undefined;
  readonly KNOWLEDGE_ANSWER_MODEL?: string | undefined;
  readonly KNOWLEDGE_ANSWER_PLUGIN_CREDENTIALS_JSON?: string | undefined;
  readonly KNOWLEDGE_ANSWER_PLUGIN_ID?: string | undefined;
  readonly KNOWLEDGE_ANSWER_PLUGIN_PROVIDER?: string | undefined;
  readonly KNOWLEDGE_ANSWER_PROVIDER?: string | undefined;
}

export interface ApiAnswerGenerationOptions {
  readonly maxOutputTokens: number;
  readonly model: string;
  readonly provider: LlmProvider;
  readonly providerFactory: (selection: ApiReasoningModelSelection) => LlmProvider;
}

export interface ApiProfileReasoningCapability {
  readonly maxOutputTokens: number;
  readonly providerFactory: (selection: ApiReasoningModelSelection) => LlmProvider;
}

export interface ApiReasoningModelSelection {
  readonly model: string;
  readonly pluginId: string;
  readonly provider: string;
}

/**
 * Builds the profile-scoped reasoning capability independently of the legacy answer-provider
 * switch. Knowledge-space model selections are complete plugin-daemon routes and therefore do not
 * require KNOWLEDGE_ANSWER_MODEL/PLUGIN_ID/PLUGIN_PROVIDER defaults.
 */
export function createApiProfileReasoningCapability(
  env: ApiAnswerGenerationEnv = process.env,
): ApiProfileReasoningCapability {
  return {
    maxOutputTokens: answerMaxOutputTokens(env),
    providerFactory: (selection) =>
      createChatProvider(env, {
        model: selection.model,
        pluginId: selection.pluginId,
        provider: selection.provider,
      }).provider,
  };
}

/**
 * Resolves the LLM provider used to synthesize query answers. Returns `undefined` when
 * `KNOWLEDGE_ANSWER_PROVIDER` is unset or `off`, in which case the gateway keeps its extractive
 * (evidence-only) answer path. Answer generation stays opt-in and, when enabled, routes through the
 * plugin-daemon.
 */
export function createApiAnswerGenerationOptions(
  env: ApiAnswerGenerationEnv = process.env,
): ApiAnswerGenerationOptions | undefined {
  if (!answerEnabled(env.KNOWLEDGE_ANSWER_PROVIDER)) {
    return undefined;
  }

  const defaultConfig = answerPluginDaemonConfig(env);
  const { provider, defaultModel } = createChatProvider(env, defaultConfig);
  // The compatibility provider above may use explicit deployment credentials. Per-space model
  // routes must always let plugin-daemon resolve credentials in the request tenant.
  const providerFactory = (selection: ApiReasoningModelSelection) =>
    createChatProvider(env, {
      model: selection.model,
      pluginId: selection.pluginId,
      provider: selection.provider,
    }).provider;

  return {
    maxOutputTokens: answerMaxOutputTokens(env),
    model: trimmed(env.KNOWLEDGE_ANSWER_MODEL) ?? defaultModel,
    provider,
    providerFactory,
  };
}

function answerMaxOutputTokens(env: ApiAnswerGenerationEnv): number {
  return positiveIntegerEnv(
    env.KNOWLEDGE_ANSWER_MAX_OUTPUT_TOKENS,
    1_024,
    "KNOWLEDGE_ANSWER_MAX_OUTPUT_TOKENS",
  );
}

function answerPluginDaemonConfig(env: ApiAnswerGenerationEnv): ChatProviderPluginDaemonConfig {
  const credentials = parsePluginDaemonCredentials(
    env.KNOWLEDGE_ANSWER_PLUGIN_CREDENTIALS_JSON,
    "KNOWLEDGE_ANSWER_PLUGIN_CREDENTIALS_JSON",
  );

  return {
    ...(credentials ? { credentials } : {}),
    model: pluginDaemonRequired(
      env.KNOWLEDGE_ANSWER_MODEL,
      "KNOWLEDGE_ANSWER_MODEL",
      "answer generation",
    ),
    pluginId: pluginDaemonRequired(
      env.KNOWLEDGE_ANSWER_PLUGIN_ID,
      "KNOWLEDGE_ANSWER_PLUGIN_ID",
      "answer generation",
    ),
    provider: pluginDaemonRequired(
      env.KNOWLEDGE_ANSWER_PLUGIN_PROVIDER,
      "KNOWLEDGE_ANSWER_PLUGIN_PROVIDER",
      "answer generation",
    ),
  };
}

function answerEnabled(value: string | undefined): boolean {
  const normalized = trimmed(value)?.toLowerCase();

  if (!normalized || normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }

  if (normalized === "plugin-daemon") {
    return true;
  }

  throw new Error("KNOWLEDGE_ANSWER_PROVIDER must be plugin-daemon or off");
}
