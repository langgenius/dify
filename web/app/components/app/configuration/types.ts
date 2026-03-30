import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ModelConfig } from '@/models/debug'

export type PublishConfig = {
  modelConfig: ModelConfig
  completionParams: FormValue
}
