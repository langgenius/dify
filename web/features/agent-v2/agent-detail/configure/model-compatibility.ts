import type { Model, ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'

const agentIncompatibleModelPatterns: RegExp[] = [
  // openai
  /^chatgpt-/i,
  /^gpt-4/i,
  /^gpt-3/i,
  /^o[34]-mini(?:-|$)/i,

  // anthropic
  /^claude-3/i,

  // gemini
  /^gemini[ .-]2(?![ .-]5[ .-]pro$)/i,
  /^gemini[ .-]1[ .-]5[ .-]flash(?:[ .-]8b)?(?:[ .-]|$)/i,
  /^Nano/i,

  // x
  /^grok-code-/i,
  /^grok-(?:2|3)/i,

  // deepseek
  /^deepseek-(?:chat|coder|reasoner)(?:-|$)/i,

  // minimax
  /^minimax-text-01$/i,
  /^minimax-m1$/i,

  // qwen
  /^qwen2/i,
  /^qwen-flash/i,
  /^qwen-long/i,

  // zhipuai
  /^chatglm-(?:2|3)/i,
  /^glm-4-(?:air|airx|flash)$/i,
  /^glm-z1-(?:air|flash)$/i,
]

const agentSuggestedModelPatterns: RegExp[] = [
  // openai
  /^gpt[ .-]5\.5$/i,
  /^gpt[ .-]5\.5[ .-]pro$/i,

  // anthropic
  /^(?:claude[ .-])?opus[ .-]4\.8$/i,
  /^(?:claude[ .-])?opus[ .-]4\.7$/i,
  /^(?:claude[ .-])?sonnet[ .-]4\.6$/i,

  // gemini
  /^gemini 3\.1 pro preview$/i,

  // x
  /^grok[ .-]4\.3$/i,

  // deepseek
  /^deepseek[ .-]v4[ .-]pro$/i,

  // qwen
  /^qwen[ .-]?3\.7[ .-]max$/i,
  /^qwen[ .-]?3[ .-]coder[ .-]plus$/i,
]

export function isAgentCompatibleModel(_provider: Model, modelItem: ModelItem) {
  return !agentIncompatibleModelPatterns.some(pattern => pattern.test(modelItem.label.en_US))
}

export function isAgentSuggestedModel(_provider: Model, modelItem: ModelItem) {
  return agentSuggestedModelPatterns.some(pattern => pattern.test(modelItem.label.en_US))
}
