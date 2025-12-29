import type { MoreLikeThisConfig, PromptConfig, TextToSpeechConfig } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { VisionSettings } from '@/types/app'
import { useEffect, useState } from 'react'
import { changeLanguage } from '@/i18n-config/i18next-config'
import { Resolution, TransferMethod } from '@/types/app'
import { userInputsFormToPromptVariables } from '@/utils/model-config'

type UseShareAppConfigParams = {
  appData: any
  appParams: any
}

type UseShareAppConfigResult = {
  appId: string
  siteInfo: SiteInfo | null
  customConfig: Record<string, any> | null
  promptConfig: PromptConfig | null
  moreLikeThisConfig: MoreLikeThisConfig | null
  textToSpeechConfig: TextToSpeechConfig | null
  visionConfig: VisionSettings
}

export const useShareAppConfig = ({
  appData,
  appParams,
}: UseShareAppConfigParams): UseShareAppConfigResult => {
  const [appId, setAppId] = useState('')
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null)
  const [customConfig, setCustomConfig] = useState<Record<string, any> | null>(null)
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null)
  const [moreLikeThisConfig, setMoreLikeThisConfig] = useState<MoreLikeThisConfig | null>(null)
  const [textToSpeechConfig, setTextToSpeechConfig] = useState<TextToSpeechConfig | null>(null)
  const [visionConfig, setVisionConfig] = useState<VisionSettings>({
    enabled: false,
    number_limits: 2,
    detail: Resolution.low,
    transfer_methods: [TransferMethod.local_file],
  })

  useEffect(() => {
    (async () => {
      if (!appData || !appParams)
        return

      const { app_id: appId, site: siteInfo, custom_config } = appData
      setAppId(appId)
      setSiteInfo(siteInfo as SiteInfo)
      setCustomConfig(custom_config)
      await changeLanguage(siteInfo.default_language)

      const { user_input_form, more_like_this, file_upload, text_to_speech }: any = appParams
      setVisionConfig({
        // legacy of image upload compatible
        ...file_upload,
        transfer_methods: file_upload?.allowed_file_upload_methods || file_upload?.allowed_upload_methods,
        // legacy of image upload compatible
        image_file_size_limit: appParams?.system_parameters.image_file_size_limit,
        fileUploadConfig: appParams?.system_parameters,
      } as VisionSettings)
      const prompt_variables = userInputsFormToPromptVariables(user_input_form)
      setPromptConfig({
        prompt_template: '', // placeholder for future
        prompt_variables,
      } as PromptConfig)
      setMoreLikeThisConfig(more_like_this)
      setTextToSpeechConfig(text_to_speech)
    })()
  }, [appData, appParams])

  return {
    appId,
    siteInfo,
    customConfig,
    promptConfig,
    moreLikeThisConfig,
    textToSpeechConfig,
    visionConfig,
  }
}
