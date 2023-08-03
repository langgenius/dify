import anthropicConfig from './anthropic.config'
import openaiConfig from './openai.config'
import huggingfaceConfig from './huggingface.config'
import minimaxConfig from './minimax.config'
import tongyiConfig from './tongyi.config'
import chatglmConfig from './chatglm.config'
import replicateConfig from './replicate.config'
import azure_openaiConfig from './azure_openai.config'

export default {
  anthropic: anthropicConfig,
  openai: openaiConfig,
  huggingface_hub: huggingfaceConfig,
  minimax: minimaxConfig,
  tongyi: tongyiConfig,
  chatglm: chatglmConfig,
  replicate: replicateConfig,
  azure_openai: azure_openaiConfig,
}
