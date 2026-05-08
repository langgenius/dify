import type { TextGenerationCustomConfig } from '../types'
import type { MoreLikeThisConfig, PromptConfig, SavedMessage, TextToSpeechConfig } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { VisionSettings } from '@/types/app'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getRawInputsFromUrlParams } from '@/app/components/base/chat/utils'
import { useWebAppStore } from '@/context/web-app-context'
import { useAppFavicon } from '@/hooks/use-app-favicon'
import useDocumentTitle from '@/hooks/use-document-title'
import { changeLanguage } from '@/i18n-config/client'
import { AppSourceType, fetchSavedMessage as doFetchSavedMessage, removeMessage, saveMessage } from '@/service/share'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { Resolution, TransferMethod } from '@/types/app'
import { userInputsFormToPromptVariables } from '@/utils/model-config'

type UseTextGenerationAppStateOptions = {
  isInstalledApp: boolean
  isWorkflow: boolean
}
type ShareAppParams = {
  user_input_form: Parameters<typeof userInputsFormToPromptVariables>[0]
  more_like_this: MoreLikeThisConfig | null
  file_upload: VisionSettings & {
    allowed_file_upload_methods?: TransferMethod[]
    allowed_upload_methods?: TransferMethod[]
  }
  text_to_speech: TextToSpeechConfig | null
  system_parameters?: Record<string, unknown> & {
    image_file_size_limit?: number
  }
}

const coerceWorkflowUrlDefault = (
  promptVariable: NonNullable<PromptConfig['prompt_variables']>[number],
  rawValue: unknown,
) => {
  if (rawValue === undefined || rawValue === null)
    return undefined

  if (promptVariable.type === 'checkbox') {
    if (typeof rawValue === 'boolean')
      return rawValue

    const normalized = String(rawValue).toLowerCase()
    if (normalized === 'true')
      return true
    if (normalized === 'false')
      return false

    return undefined
  }

  if (promptVariable.type === 'number') {
    const numericValue = Number(rawValue)
    return Number.isNaN(numericValue) ? undefined : numericValue
  }

  if (typeof rawValue !== 'string')
    return undefined

  if (promptVariable.type === 'select')
    return promptVariable.options?.includes(rawValue) ? rawValue : undefined

  if (promptVariable.max_length)
    return rawValue.slice(0, promptVariable.max_length)

  return rawValue
}

export const useTextGenerationAppState = ({ isInstalledApp, isWorkflow }: UseTextGenerationAppStateOptions) => {
  const { t } = useTranslation()
  const appSourceType = isInstalledApp ? AppSourceType.installedApp : AppSourceType.webApp
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const appData = useWebAppStore(s => s.appInfo)
  const appParams = useWebAppStore(s => s.appParams)
  const accessMode = useWebAppStore(s => s.webAppAccessMode)
  const [appId, setAppId] = useState('')
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null)
  const [customConfig, setCustomConfig] = useState<TextGenerationCustomConfig | null>(null)
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null)
  const [moreLikeThisConfig, setMoreLikeThisConfig] = useState<MoreLikeThisConfig | null>(null)
  const [textToSpeechConfig, setTextToSpeechConfig] = useState<TextToSpeechConfig | null>(null)
  const [savedMessages, setSavedMessages] = useState<SavedMessage[]>([])
  const [visionConfig, setVisionConfig] = useState<VisionSettings>({
    enabled: false,
    number_limits: 2,
    detail: Resolution.low,
    transfer_methods: [TransferMethod.local_file],
  })
  const fetchSavedMessages = useCallback(async (targetAppId = appId) => {
    if (!targetAppId)
      return
    const res = await doFetchSavedMessage(appSourceType, targetAppId) as {
      data: SavedMessage[]
    }
    setSavedMessages(res.data)
  }, [appId, appSourceType])
  const handleSaveMessage = useCallback(async (messageId: string) => {
    if (!appId)
      return
    await saveMessage(messageId, appSourceType, appId)
    toast.success(t('api.saved', { ns: 'common' }))
    await fetchSavedMessages(appId)
  }, [appId, appSourceType, fetchSavedMessages, t])
  const handleRemoveSavedMessage = useCallback(async (messageId: string) => {
    if (!appId)
      return
    await removeMessage(messageId, appSourceType, appId)
    toast.success(t('api.remove', { ns: 'common' }))
    await fetchSavedMessages(appId)
  }, [appId, appSourceType, fetchSavedMessages, t])
  useEffect(() => {
    let cancelled = false
    const initialize = async () => {
      if (!appData || !appParams)
        return
      const { app_id: nextAppId, site, custom_config } = appData
      setAppId(nextAppId)
      setSiteInfo(site as SiteInfo)
      setCustomConfig((custom_config || null) as TextGenerationCustomConfig | null)
      await changeLanguage(site.default_language)
      const { user_input_form, more_like_this, file_upload, text_to_speech } = appParams as unknown as ShareAppParams
      const promptVariables = userInputsFormToPromptVariables(user_input_form)
      if (isWorkflow && !isInstalledApp) {
        const workflowUrlInputs = await getRawInputsFromUrlParams()
        promptVariables.forEach((promptVariable) => {
          const workflowDefault = coerceWorkflowUrlDefault(promptVariable, workflowUrlInputs[promptVariable.key])
          if (workflowDefault !== undefined)
            promptVariable.default = workflowDefault
        })
      }
      if (cancelled)
        return
      setVisionConfig({
        ...file_upload,
        transfer_methods: file_upload?.allowed_file_upload_methods || file_upload?.allowed_upload_methods,
        image_file_size_limit: appParams?.system_parameters.image_file_size_limit,
        fileUploadConfig: appParams?.system_parameters,
      } as VisionSettings)
      setPromptConfig({
        prompt_template: '',
        prompt_variables: promptVariables,
      } as PromptConfig)
      setMoreLikeThisConfig(more_like_this)
      setTextToSpeechConfig(text_to_speech)
      if (!isWorkflow)
        await fetchSavedMessages(nextAppId)
    }
    void initialize()
    return () => {
      cancelled = true
    }
  }, [appData, appParams, fetchSavedMessages, isInstalledApp, isWorkflow])
  useDocumentTitle(siteInfo?.title || t('generation.title', { ns: 'share' }))
  useAppFavicon({
    enable: !isInstalledApp,
    icon_type: siteInfo?.icon_type,
    icon: siteInfo?.icon,
    icon_background: siteInfo?.icon_background,
    icon_url: siteInfo?.icon_url,
  })
  return {
    accessMode,
    appId,
    appSourceType,
    customConfig,
    fetchSavedMessages,
    handleRemoveSavedMessage,
    handleSaveMessage,
    moreLikeThisConfig,
    promptConfig,
    savedMessages,
    siteInfo,
    systemFeatures,
    textToSpeechConfig,
    visionConfig,
    setVisionConfig,
  }
}
