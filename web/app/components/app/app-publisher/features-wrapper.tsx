import type { AppPublisherProps } from '@/app/components/app/app-publisher'
import type { ModelAndParameter } from '@/app/components/app/configuration/debug/types'
import type { FileUpload } from '@/app/components/base/features/types'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppPublisher from '@/app/components/app/app-publisher'
import Confirm from '@/app/components/base/confirm'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { Resolution } from '@/types/app'

type Props = Omit<AppPublisherProps, 'onPublish'> & {
  onPublish?: (modelAndParameter?: ModelAndParameter, features?: any) => Promise<any> | any
  publishedConfig?: any
  resetAppConfig?: () => void
}

const FeaturesWrappedAppPublisher = (props: Props) => {
  const { t } = useTranslation()
  const features = useFeatures(s => s.features)
  const featuresStore = useFeaturesStore()
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)
  const { more_like_this, opening_statement, suggested_questions, sensitive_word_avoidance, speech_to_text, text_to_speech, suggested_questions_after_answer, retriever_resource, annotation_reply, file_upload, resetAppConfig } = props.publishedConfig.modelConfig

  const handleConfirm = useCallback(() => {
    resetAppConfig?.()
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()
    const newFeatures = produce(features, (draft) => {
      draft.moreLikeThis = more_like_this || { enabled: false }
      draft.opening = {
        enabled: !!opening_statement,
        opening_statement: opening_statement || '',
        suggested_questions: suggested_questions || [],
      }
      draft.moderation = sensitive_word_avoidance || { enabled: false }
      draft.speech2text = speech_to_text || { enabled: false }
      draft.text2speech = text_to_speech || { enabled: false }
      draft.suggested = suggested_questions_after_answer || { enabled: false }
      draft.citation = retriever_resource || { enabled: false }
      draft.annotationReply = annotation_reply || { enabled: false }
      draft.file = {
        image: {
          detail: file_upload?.image?.detail || Resolution.high,
          enabled: !!file_upload?.image?.enabled,
          number_limits: file_upload?.image?.number_limits || 3,
          transfer_methods: file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
        },
        enabled: !!(file_upload?.enabled || file_upload?.image?.enabled),
        allowed_file_types: file_upload?.allowed_file_types || [SupportUploadFileTypes.image],
        allowed_file_extensions: file_upload?.allowed_file_extensions || FILE_EXTS[SupportUploadFileTypes.image].map(ext => `.${ext}`),
        allowed_file_upload_methods: file_upload?.allowed_file_upload_methods || file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
        number_limits: file_upload?.number_limits || file_upload?.image?.number_limits || 3,
      } as FileUpload
    })
    setFeatures(newFeatures)
    setRestoreConfirmOpen(false)
  }, [featuresStore, props])

  const handlePublish = useCallback((modelAndParameter?: ModelAndParameter) => {
    return props.onPublish?.(modelAndParameter, features)
  }, [features, props])

  return (
    <>
      <AppPublisher {...{
        ...props,
        onPublish: handlePublish,
        onRestore: () => setRestoreConfirmOpen(true),
      }}
      />
      {restoreConfirmOpen && (
        <Confirm
          title={t('resetConfig.title', { ns: 'appDebug' })}
          content={t('resetConfig.message', { ns: 'appDebug' })}
          isShow={restoreConfirmOpen}
          onConfirm={handleConfirm}
          onCancel={() => setRestoreConfirmOpen(false)}
        />
      )}
    </>
  )
}

export default FeaturesWrappedAppPublisher
