'use client'

import type { AgentSoulAppFeaturesConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { Features } from '@/app/components/base/features/types'
import { useCallback, useMemo } from 'react'
import { useTranslation } from '#i18n'
import { FeaturesProvider } from '@/app/components/base/features'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import NewFeaturePanel from '@/app/components/base/features/new-feature-panel'
import { useSetAppFeatures } from '@/features/agent-v2/agent-composer/store-modules/app-features'
import { Resolution, TransferMethod } from '@/types/app'

type AgentChatFeaturesPanelProps = {
  appFeatures?: AgentSoulAppFeaturesConfig
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

function toPanelFeatures(appFeatures?: AgentSoulAppFeaturesConfig): Features {
  return {
    ...defaultFeatureState,
    opening: {
      enabled: !!(appFeatures?.opening_statement || appFeatures?.suggested_questions?.length),
      opening_statement: appFeatures?.opening_statement ?? '',
      suggested_questions: appFeatures?.suggested_questions ?? [],
    },
    suggested: (appFeatures?.suggested_questions_after_answer as Features['suggested'] | undefined) ?? defaultFeatureState.suggested,
    text2speech: (appFeatures?.text_to_speech as Features['text2speech'] | undefined) ?? defaultFeatureState.text2speech,
    speech2text: appFeatures?.speech_to_text ?? defaultFeatureState.speech2text,
    citation: appFeatures?.retriever_resource ?? defaultFeatureState.citation,
    moderation: (appFeatures?.sensitive_word_avoidance as Features['moderation'] | undefined) ?? defaultFeatureState.moderation,
    file: (appFeatures?.file_upload as Features['file'] | undefined) ?? defaultFeatureState.file,
    annotationReply: (appFeatures?.annotation_reply as Features['annotationReply'] | undefined) ?? defaultFeatureState.annotationReply,
  }
}

function toAppFeatures(features: Features, appFeatures?: AgentSoulAppFeaturesConfig): AgentSoulAppFeaturesConfig {
  return {
    ...appFeatures,
    opening_statement: features.opening?.enabled ? (features.opening.opening_statement ?? '') : '',
    suggested_questions: features.opening?.enabled ? (features.opening.suggested_questions ?? []) : [],
    suggested_questions_after_answer: features.suggested as AgentSoulAppFeaturesConfig['suggested_questions_after_answer'],
    text_to_speech: features.text2speech as AgentSoulAppFeaturesConfig['text_to_speech'],
    speech_to_text: features.speech2text,
    retriever_resource: features.citation,
    sensitive_word_avoidance: features.moderation as AgentSoulAppFeaturesConfig['sensitive_word_avoidance'],
    file_upload: features.file,
    annotation_reply: features.annotationReply,
  }
}

function AgentChatFeaturesPanelContent({
  appFeatures,
  disabled,
  show,
  onClose,
}: AgentChatFeaturesPanelProps) {
  const { t } = useTranslation('agentV2')
  const featuresStore = useFeaturesStore()
  const setAppFeatures = useSetAppFeatures()
  const handleChange = useCallback(() => {
    const features = featuresStore?.getState().features
    if (!features)
      return

    setAppFeatures(currentAppFeatures => toAppFeatures(features, currentAppFeatures ?? appFeatures))
  }, [appFeatures, featuresStore, setAppFeatures])

  return (
    <NewFeaturePanel
      show={show}
      isChatMode
      disabled={!!disabled}
      inWorkflow={false}
      showModeration={false}
      showAnnotationReply={false}
      drawerClassName="bg-components-panel-bg! data-[swipe-direction=right]:top-1! data-[swipe-direction=right]:right-0! data-[swipe-direction=right]:bottom-1! data-[swipe-direction=right]:rounded-r-none!"
      title={t('agentDetail.configure.chatFeatures.title')}
      description={t('agentDetail.configure.chatFeatures.description')}
      onChange={handleChange}
      onClose={onClose}
    />
  )
}

export function AgentChatFeaturesPanel({
  appFeatures,
  ...props
}: AgentChatFeaturesPanelProps) {
  const features = useMemo(() => toPanelFeatures(appFeatures), [appFeatures])
  const featuresKey = useMemo(() => JSON.stringify(appFeatures ?? {}), [appFeatures])

  return (
    <FeaturesProvider key={featuresKey} features={features}>
      <AgentChatFeaturesPanelContent appFeatures={appFeatures} {...props} />
    </FeaturesProvider>
  )
}
