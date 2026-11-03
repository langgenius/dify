import type { Model } from '@/types/app'

/**
 * `/rule-generate` and `/instruction-generate` validate `model_config.mode` as
 * `LLMMode` (`chat` or `completion`). An Agent app's app mode is `agent-chat`,
 * which is not a model mode; send the equivalent chat mode instead (#38539).
 */
export const normalizeRuleGenerateModelConfig = (modelConfig: Model): Model => {
  if ((modelConfig.mode as string) !== 'agent-chat') return modelConfig
  return { ...modelConfig, mode: 'chat' }
}
