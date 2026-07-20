import type { FormInputItem, UserAction } from '@/app/components/workflow/nodes/human-input/types'
import type { CustomConfigValueType, SiteInfo } from '@/models/share'
import type { HumanInputResolvedValue } from '@/types/workflow'

export type HumanInputFormBranding = {
  site: SiteInfo
  customConfig?: Record<string, CustomConfigValueType> | null
}

export type HumanInputFormDefinition = {
  branding?: HumanInputFormBranding
  formContent: string
  inputs: FormInputItem[]
  resolvedDefaultValues: Record<string, HumanInputResolvedValue>
  actions: UserAction[]
  expirationTime: number
}

export type LegacyHumanInputFormData = {
  site: {
    site: SiteInfo
    custom_config?: Record<string, CustomConfigValueType> | null
  }
  form_content: string
  inputs: FormInputItem[]
  resolved_default_values: Record<string, HumanInputResolvedValue>
  user_actions: UserAction[]
  expiration_time: number
}
