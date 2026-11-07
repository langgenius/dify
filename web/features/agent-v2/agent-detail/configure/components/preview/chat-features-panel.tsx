'use client'

import type {
  AgentSoulAppFeaturesConfig,
  FileTransferMethod,
  FileType,
} from '@dify/contracts/api/console/agent/types.gen'
import type { AnnotationSettingResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { Features } from '@/app/components/base/features/types'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FeaturesProvider } from '@/app/components/base/features'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import NewFeaturePanel from '@/app/components/base/features/new-feature-panel'
import {
  useAppFeatures,
  useSetAppFeatures,
} from '@/features/agent-v2/agent-composer/store-modules/app-features'
import { consoleQuery } from '@/service/console'
import { Resolution, TransferMethod } from '@/types/app'

type AgentChatFeaturesPanelProps = {
  appFeatures?: AgentSoulAppFeaturesConfig
  /**
   * Backing app whose annotation reply setting answers matching questions before
   * the Agent runs. The setting is not part of the Agent Soul and applies immediately.
   */
  annotationReplyAppId?: string
  disabled?: boolean
  show: boolean
  onClose: () => void
}

const defaultFeatureState: Features = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false },
  suggested: { enabled: false },
  text2speech: { enabled: false },
  speech2text: { enabled: false },
  citation: { enabled: false },
  showThoughts: { enabled: false },
  moderation: { enabled: false },
  file: {
    enabled: false,
    image: {
      enabled: false,
      detail: Resolution.high,
      number_limits: 3,
      transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
    },
  },
  annotationReply: { enabled: false },
}

const agentFileTypes = new Set<string>(['audio', 'custom', 'document', 'image', 'video'])
const agentFileTransferMethods = new Set<string>([
  'datasource_file',
  'local_file',
  'remote_url',
  'tool_file',
])

function isAgentFileType(value: string): value is FileType {
  return agentFileTypes.has(value)
}

function isAgentFileTransferMethod(value: string): value is FileTransferMethod {
  return agentFileTransferMethods.has(value)
}

function toAgentFileTransferMethods(values?: readonly string[]): FileTransferMethod[] | undefined {
  return values?.filter(isAgentFileTransferMethod)
}

function toAgentFileUploadFeatureConfig(
  file: Features['file'],
): AgentSoulAppFeaturesConfig['file_upload'] {
  if (!file) return undefined

  const { allowed_file_types, allowed_file_upload_methods } = file
  const fileUpload: Record<string, unknown> = { ...file }
  delete fileUpload.allowed_file_types
  delete fileUpload.allowed_file_upload_methods

  return {
    ...fileUpload,
    ...(allowed_file_types
      ? { allowed_file_types: allowed_file_types.filter(isAgentFileType) }
      : {}),
    ...(allowed_file_upload_methods
      ? { allowed_file_upload_methods: toAgentFileTransferMethods(allowed_file_upload_methods) }
      : {}),
  }
}

function toPanelFeatures(appFeatures?: AgentSoulAppFeaturesConfig): Features {
  return {
    ...defaultFeatureState,
    opening: {
      enabled: !!(appFeatures?.opening_statement || appFeatures?.suggested_questions?.length),
      opening_statement: appFeatures?.opening_statement ?? '',
      suggested_questions: appFeatures?.suggested_questions ?? [],
    },
    suggested:
      (appFeatures?.suggested_questions_after_answer as Features['suggested'] | undefined) ??
      defaultFeatureState.suggested,
    text2speech:
      (appFeatures?.text_to_speech as Features['text2speech'] | undefined) ??
      defaultFeatureState.text2speech,
    speech2text: appFeatures?.speech_to_text ?? defaultFeatureState.speech2text,
    citation: appFeatures?.retriever_resource ?? defaultFeatureState.citation,
    showThoughts: appFeatures?.show_thoughts ?? defaultFeatureState.showThoughts,
    moderation:
      (appFeatures?.sensitive_word_avoidance as Features['moderation'] | undefined) ??
      defaultFeatureState.moderation,
    file: (appFeatures?.file_upload as Features['file'] | undefined) ?? defaultFeatureState.file,
    annotationReply:
      (appFeatures?.annotation_reply as Features['annotationReply'] | undefined) ??
      defaultFeatureState.annotationReply,
  }
}

function toAnnotationReplyFeature(setting: AnnotationSettingResponse): Features['annotationReply'] {
  const { embedding_model: embeddingModel } = setting
  return {
    enabled: setting.enabled,
    id: setting.id ?? undefined,
    score_threshold: setting.score_threshold ?? undefined,
    embedding_model: embeddingModel
      ? {
          embedding_provider_name: embeddingModel.embedding_provider_name ?? '',
          embedding_model_name: embeddingModel.embedding_model_name ?? '',
        }
      : undefined,
  }
}

function toAppFeatures(
  features: Features,
  appFeatures?: AgentSoulAppFeaturesConfig,
): AgentSoulAppFeaturesConfig {
  return {
    ...appFeatures,
    opening_statement: features.opening?.enabled ? (features.opening.opening_statement ?? '') : '',
    suggested_questions: features.opening?.enabled
      ? (features.opening.suggested_questions ?? [])
      : [],
    suggested_questions_after_answer:
      features.suggested as AgentSoulAppFeaturesConfig['suggested_questions_after_answer'],
    text_to_speech: features.text2speech as AgentSoulAppFeaturesConfig['text_to_speech'],
    speech_to_text: features.speech2text,
    retriever_resource: features.citation,
    show_thoughts: features.showThoughts,
    file_upload: toAgentFileUploadFeatureConfig(features.file),
  }
}

function AgentChatFeaturesPanelContent({
  appFeatures,
  annotationReplyAppId,
  disabled,
  show,
  onClose,
}: AgentChatFeaturesPanelProps) {
  const { t } = useTranslation(['agentV2'])
  const queryClient = useQueryClient()
  const featuresStore = useFeaturesStore()
  const setAppFeatures = useSetAppFeatures()
  const handleChange = useCallback(() => {
    if (disabled) return

    const features = featuresStore?.getState().features
    if (!features) return

    setAppFeatures((currentAppFeatures) =>
      toAppFeatures(features, currentAppFeatures ?? appFeatures),
    )
  }, [appFeatures, disabled, featuresStore, setAppFeatures])
  // The annotation setting is already saved on the backing app, not in the Agent
  // Soul draft; refresh its cached copy so a remounted panel shows the new state.
  const handleAnnotationReplyChange = useCallback(() => {
    if (!annotationReplyAppId) return

    void queryClient.invalidateQueries({
      queryKey: consoleQuery.apps.byAppId.annotationSetting.get.queryKey({
        input: { params: { app_id: annotationReplyAppId } },
      }),
    })
  }, [annotationReplyAppId, queryClient])

  return (
    <NewFeaturePanel
      show={show}
      isChatMode
      disabled={!!disabled}
      inWorkflow={false}
      showThoughtsToggle
      showModeration={false}
      showAnnotationReply={!!annotationReplyAppId}
      annotationReplyAppId={annotationReplyAppId}
      onAnnotationReplyChange={handleAnnotationReplyChange}
      drawerClassName="bg-components-panel-bg! data-[swipe-direction=right]:top-1! data-[swipe-direction=right]:right-0! data-[swipe-direction=right]:bottom-1! data-[swipe-direction=right]:rounded-r-none!"
      title={t(($) => $['agentDetail.configure.chatFeatures.title'])}
      description={t(($) => $['agentDetail.configure.chatFeatures.description'])}
      onChange={handleChange}
      onClose={onClose}
    />
  )
}

export function AgentChatFeaturesPanel({
  appFeatures: snapshotAppFeatures,
  annotationReplyAppId,
  ...props
}: AgentChatFeaturesPanelProps) {
  const draftAppFeatures = useAppFeatures()
  const appFeatures = props.disabled ? snapshotAppFeatures : draftAppFeatures
  // Loaded as soon as the backing app is known, not when the panel opens, so the
  // annotation card is usually ready before the panel is first shown.
  const { data: annotationSetting } = useQuery(
    consoleQuery.apps.byAppId.annotationSetting.get.queryOptions({
      input: annotationReplyAppId ? { params: { app_id: annotationReplyAppId } } : skipToken,
      context: { silent: true },
    }),
  )
  const features = useMemo(
    () => ({
      ...toPanelFeatures(appFeatures),
      ...(annotationSetting && { annotationReply: toAnnotationReplyFeature(annotationSetting) }),
    }),
    [annotationSetting, appFeatures],
  )
  // Keep transient feature switches while editing, including an empty opener
  // that has been enabled but has not had its statement saved yet. The panel does
  // not wait for the annotation setting; once it arrives, the provider restarts
  // once from it and the annotation card appears. It stays out if loading fails.
  const featuresKey = `${props.disabled ? JSON.stringify(appFeatures ?? {}) : 'draft'}:${annotationSetting ? 'annotation' : 'none'}`

  return (
    <FeaturesProvider key={featuresKey} features={features}>
      <AgentChatFeaturesPanelContent
        appFeatures={appFeatures}
        annotationReplyAppId={annotationSetting ? annotationReplyAppId : undefined}
        {...props}
      />
    </FeaturesProvider>
  )
}
