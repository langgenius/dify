import type { Model, ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'

const agentIncompatibleModelPatterns: RegExp[] = [
  // openai
  /^chatgpt-/i,
  /^gpt-5(?:$|-|\.1$|\.2$)/i,
  /^gpt.*(?:min|chat)/i,
  /^gpt.*nano/i,
  /^gpt-4/i,
  /^gpt-3/i,
  /^o[134](?:-|$)/i,

  // anthropic
  /^claude-3/i,

  // gemini
  /^gemini.*flash[ .-]lite/i,
  /^gemini[ .-]2(?![ .-]5[ .-]pro$)/i,
  /^gemini[ .-]1[ .-]5[ .-]flash(?:[ .-]8b)?(?:[ .-]|$)/i,
  /^Nano/i,

  // x
  /^grok-code-/i,
  /^grok.*beta/i,
  /^grok-(?:2|3)/i,

  // deepseek
  /^deepseek-(?:chat|coder|reasoner)(?:-|$)/i,
  /^deepseek-r1$/i,
  /^deepseek-r1-distill-/i,
  /^deepseek-v3/i,

  // qwen
  /^qvq-/i,
  /^qwq-/i,
  /^qwen-/i,
  /^qwen2/i,
  /^qwen3-/i,
  /^qwen3\.5/i,
  /^qwen.*flash/i,
  /^farui-plus$/i,

  // zhipu ai
  /^chatglm-(?:2|3)/i,
  /^glm-3/i,
  /^glm-4/i,
  /^glm-z/i,

  // moonshot
  /^kimi-k2-/i,
  /^moonshot-v1/i,

  // minimax
  /^abab/i,
  /^minimax-text-01$/i,
  /^minimax-m1$/i,
  /^minimax-m2(?:-|$)/i,
]

const agentSuggestedModelPatterns: RegExp[] = [
  // openai
  /^gpt[ .-]5\.5$/i,
  /^gpt[ .-]5\.5[ .-]pro$/i,

  // anthropic
  /^(?:claude[ .-])?opus[ .-]4\.8$/i,
  /^(?:claude[ .-])?opus[ .-]4\.7$/i,
  /^(?:claude[ .-])?sonnet[ .-]4\.6$/i,

  // The Gemini model plugin quality is not strong enough yet, so do not recommend it for now.
  // /^gemini 3\.1 pro preview$/i,

  // x
  /^grok[ .-]4\.3$/i,

  // deepseek
  /^deepseek[ .-]v4[ .-]pro$/i,

  // qwen
  /^qwen[ .-]?3\.7[ .-]max$/i,
  /^qwen[ .-]?3[ .-]coder[ .-]plus$/i,

  // moonshot
  /^kimi[ .-]k2\.6$/i,

  // minimax
  /^minimax[ .-]m3$/i,

  // zhipuai
  /^glm[ .-]5\.1$/i,
]

export function isAgentCompatibleModel(_provider: Model, modelItem: ModelItem) {
  return !agentIncompatibleModelPatterns.some(pattern => pattern.test(modelItem.label.en_US))
}

export function isAgentSuggestedModel(_provider: Model, modelItem: ModelItem) {
  return agentSuggestedModelPatterns.some(pattern => pattern.test(modelItem.label.en_US))
}
