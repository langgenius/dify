import type { AccessMode } from '@/models/access-control'
import type {
  MoreLikeThisConfig,
  PromptConfig,
  TextToSpeechConfig,
} from '@/models/debug'
import type { CustomConfigValueType, SiteInfo } from '@/models/share'
import type { VisionSettings } from '@/types/app'
import { useEffect, useMemo } from 'react'
import { useWebAppStore } from '@/context/web-app-context'
import { changeLanguage } from '@/i18n-config/client'
import { Resolution, TransferMethod } from '@/types/app'
import { userInputsFormToPromptVariables } from '@/utils/model-config'

const DEFAULT_VISION_CONFIG: VisionSettings = {
  enabled: false,
  number_limits: 2,
  detail: Resolution.low,
  transfer_methods: [TransferMethod.local_file],
}

export type AppConfig = {
  appId: string
  siteInfo: SiteInfo | null
  customConfig: Record<string, CustomConfigValueType> | null
  promptConfig: PromptConfig | null
  moreLikeThisConfig: MoreLikeThisConfig | null
  textToSpeechConfig: TextToSpeechConfig | null
  visionConfig: VisionSettings
  accessMode: AccessMode
  isReady: boolean
}

export function useAppConfig(): AppConfig {
  const appData = useWebAppStore(s => s.appInfo)
  const appParams = useWebAppStore(s => s.appParams)
  const accessMode = useWebAppStore(s => s.webAppAccessMode)

  const appId = appData?.app_id ?? ''
  const siteInfo = (appData?.site as SiteInfo) ?? null
  const customConfig = appData?.custom_config ?? null

  const promptConfig = useMemo<PromptConfig | null>(() => {
    if (!appParams)
      return null
    const prompt_variables = userInputsFormToPromptVariables(appParams.user_input_form)
    return { prompt_template: '', prompt_variables } as PromptConfig
  }, [appParams])

  const moreLikeThisConfig: MoreLikeThisConfig | null = appParams?.more_like_this ?? null
  const textToSpeechConfig: TextToSpeechConfig | null = appParams?.text_to_speech ?? null

  const visionConfig = useMemo<VisionSettings>(() => {
    if (!appParams)
      return DEFAULT_VISION_CONFIG
    const { file_upload, system_parameters } = appParams
    return {
      ...file_upload,
      transfer_methods: file_upload?.allowed_file_upload_methods || file_upload?.allowed_upload_methods || [],
      image_file_size_limit: system_parameters?.image_file_size_limit,
      fileUploadConfig: system_parameters,
    } as unknown as VisionSettings
  }, [appParams])

  // Sync language when site info changes
  useEffect(() => {
    if (siteInfo?.default_language)
      changeLanguage(siteInfo.default_language)
  }, [siteInfo?.default_language])

  const isReady = !!(appId && siteInfo && promptConfig)

  return {
    appId,
    siteInfo,
    customConfig,
    promptConfig,
    moreLikeThisConfig,
    textToSpeechConfig,
    visionConfig,
    accessMode,
    isReady,
  }
}
