'use client'

import type {
  AgentSoulAppFeaturesConfig,
  FileTransferMethod,
  FileType,
} from '@dify/contracts/api/console/agent/types.gen'
import type { Features } from '@/app/components/base/features/types'
import { produce } from 'immer'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FeaturesProvider } from '@/app/components/base/features'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import NewFeaturePanel from '@/app/components/base/features/new-feature-panel'
import { Infotip } from '@/app/components/base/infotip'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { useSetAppFeatures } from '@/features/agent-v2/agent-composer/store-modules/app-features'
import { Resolution, TransferMethod } from '@/types/app'

type AgentChatFeaturesPanelProps = {
  appFeatures?: AgentSoulAppFeaturesConfig
  disabled?: boolean
  show: boolean
  supportsVision: boolean | undefined
  onClose: () => void
}

type AgentVisionSettingsProps = {
  disabled?: boolean
  onChange: () => void
  supportsVision: boolean | undefined
}

const defaultFeatureState: Features = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false },
  suggested: { enabled: false },
  text2speech: { enabled: false },
  speech2text: { enabled: false },
  citation: { enabled: false },
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
    moderation:
      (appFeatures?.sensitive_word_avoidance as Features['moderation'] | undefined) ??
      defaultFeatureState.moderation,
    file: (appFeatures?.file_upload as Features['file'] | undefined) ?? defaultFeatureState.file,
    annotationReply:
      (appFeatures?.annotation_reply as Features['annotationReply'] | undefined) ??
      defaultFeatureState.annotationReply,
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
    sensitive_word_avoidance:
      features.moderation as AgentSoulAppFeaturesConfig['sensitive_word_avoidance'],
    file_upload: toAgentFileUploadFeatureConfig(features.file),
    annotation_reply: features.annotationReply,
  }
}

function isImageUploadConfigured(file: Features['file']) {
  if (!file?.enabled) return false

  return file.allowed_file_types !== undefined
    ? file.allowed_file_types.includes(SupportUploadFileTypes.image)
    : !!file.image?.enabled
}

function AgentVisionSettings({ disabled, onChange, supportsVision }: AgentVisionSettingsProps) {
  const { t } = useTranslation()
  const file = useFeatures((state) => state.features.file)
  const featuresStore = useFeaturesStore()
  const imageUploadConfigured = isImageUploadConfigured(file)

  const handleResolutionChange = useCallback(
    (detail: Resolution) => {
      if (disabled || !featuresStore) return

      const { features, setFeatures } = featuresStore.getState()
      const nextFeatures = produce(features, (draft) => {
        if (!draft.file) return

        draft.file.image = {
          ...draft.file.image,
          detail,
        }
      })

      setFeatures(nextFeatures)
      onChange()
    },
    [disabled, featuresStore, onChange],
  )

  if (!imageUploadConfigured || supportsVision === undefined) return null

  if (!supportsVision) {
    return (
      <div
        role="status"
        className="mt-1 flex items-start gap-2 rounded-lg border-[0.5px] border-components-badge-status-light-warning-halo bg-state-warning-hover px-3 py-2.5"
      >
        <span
          aria-hidden="true"
          className="mt-0.5 i-ri-alert-fill size-4 shrink-0 text-text-warning-secondary"
        />
        <div className="system-xs-regular text-text-warning">
          {t(($) => $['vision.onlySupportVisionModelTip'], { ns: 'appDebug' })}
        </div>
      </div>
    )
  }

  const resolution = file?.image?.detail ?? Resolution.high

  return (
    <div className="mt-1 rounded-xl border-t-[0.5px] border-l-[0.5px] border-effects-highlight bg-background-section-burn p-2">
      <div className="mb-2 flex items-center gap-1">
        <div className="system-xs-medium-uppercase text-text-tertiary">
          {t(($) => $['vision.visionSettings.resolution'], { ns: 'appDebug' })}
        </div>
        <Infotip
          aria-label={t(($) => $['vision.visionSettings.resolutionTooltip'], {
            ns: 'appDebug',
          })}
          popupClassName="w-[180px]"
        >
          {t(($) => $['vision.visionSettings.resolutionTooltip'], { ns: 'appDebug' })
            .split('\n')
            .map((item) => (
              <div key={item}>{item}</div>
            ))}
        </Infotip>
      </div>
      <div
        aria-label={t(($) => $['vision.visionSettings.resolution'], { ns: 'appDebug' })}
        className="flex items-center gap-1"
        role="radiogroup"
      >
        {[
          {
            detail: Resolution.high,
            title: t(($) => $['vision.visionSettings.high'], { ns: 'appDebug' }),
          },
          {
            detail: Resolution.low,
            title: t(($) => $['vision.visionSettings.low'], { ns: 'appDebug' }),
          },
        ].map(({ detail, title }) => (
          <div
            key={detail}
            aria-checked={resolution === detail}
            aria-disabled={disabled}
            className="grow outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              if (resolution === detail) return
              handleResolutionChange(detail)
            }}
            role="radio"
            tabIndex={disabled ? -1 : 0}
          >
            <OptionCard
              className="w-full"
              title={title}
              selected={resolution === detail}
              disabled={disabled}
              onSelect={() => handleResolutionChange(detail)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function AgentChatFeaturesPanelContent({
  appFeatures,
  disabled,
  show,
  supportsVision,
  onClose,
}: AgentChatFeaturesPanelProps) {
  const { t } = useTranslation('agentV2')
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

  return (
    <NewFeaturePanel
      show={show}
      isChatMode
      disabled={!!disabled}
      inWorkflow={false}
      showModeration={false}
      showAnnotationReply={false}
      drawerClassName="bg-components-panel-bg! data-[swipe-direction=right]:top-1! data-[swipe-direction=right]:right-0! data-[swipe-direction=right]:bottom-1! data-[swipe-direction=right]:rounded-r-none!"
      title={t(($) => $['agentDetail.configure.chatFeatures.title'])}
      description={t(($) => $['agentDetail.configure.chatFeatures.description'])}
      onChange={handleChange}
      onClose={onClose}
      fileUploadExtraContent={
        <AgentVisionSettings
          disabled={disabled}
          onChange={handleChange}
          supportsVision={supportsVision}
        />
      }
    />
  )
}

export function AgentChatFeaturesPanel({ appFeatures, ...props }: AgentChatFeaturesPanelProps) {
  const features = useMemo(() => toPanelFeatures(appFeatures), [appFeatures])
  const featuresKey = useMemo(() => JSON.stringify(appFeatures ?? {}), [appFeatures])

  return (
    <FeaturesProvider key={featuresKey} features={features}>
      <AgentChatFeaturesPanelContent appFeatures={appFeatures} {...props} />
    </FeaturesProvider>
  )
}
