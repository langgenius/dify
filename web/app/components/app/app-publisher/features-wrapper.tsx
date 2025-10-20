import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { produce } from 'immer'
import type { AppPublisherProps } from '@/app/components/app/app-publisher'
import Confirm from '@/app/components/base/confirm'
import AppPublisher from '@/app/components/app/app-publisher'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import type { ModelAndParameter } from '@/app/components/app/configuration/debug/types'
import type { FileUpload } from '@/app/components/base/features/types'
import { Resolution } from '@/types/app'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'

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
  const handleConfirm = useCallback(() => {
    props.resetAppConfig?.()
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()
    const newFeatures = produce(features, (draft) => {
      draft.moreLikeThis = props.publishedConfig.modelConfig.more_like_this || { enabled: false }
      draft.opening = {
        enabled: !!props.publishedConfig.modelConfig.opening_statement,
        opening_statement: props.publishedConfig.modelConfig.opening_statement || '',
        suggested_questions: props.publishedConfig.modelConfig.suggested_questions || [],
      }
      draft.moderation = props.publishedConfig.modelConfig.sensitive_word_avoidance || { enabled: false }
      draft.speech2text = props.publishedConfig.modelConfig.speech_to_text || { enabled: false }
      draft.text2speech = props.publishedConfig.modelConfig.text_to_speech || { enabled: false }
      draft.suggested = props.publishedConfig.modelConfig.suggested_questions_after_answer || { enabled: false }
      draft.citation = props.publishedConfig.modelConfig.retriever_resource || { enabled: false }
      draft.annotationReply = props.publishedConfig.modelConfig.annotation_reply || { enabled: false }
      draft.file = {
        image: {
          detail: props.publishedConfig.modelConfig.file_upload?.image?.detail || Resolution.high,
          enabled: !!props.publishedConfig.modelConfig.file_upload?.image?.enabled,
          number_limits: props.publishedConfig.modelConfig.file_upload?.image?.number_limits || 3,
          transfer_methods: props.publishedConfig.modelConfig.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
        },
        enabled: !!(props.publishedConfig.modelConfig.file_upload?.enabled || props.publishedConfig.modelConfig.file_upload?.image?.enabled),
        allowed_file_types: props.publishedConfig.modelConfig.file_upload?.allowed_file_types || [SupportUploadFileTypes.image],
        allowed_file_extensions: props.publishedConfig.modelConfig.file_upload?.allowed_file_extensions || FILE_EXTS[SupportUploadFileTypes.image].map(ext => `.${ext}`),
        allowed_file_upload_methods: props.publishedConfig.modelConfig.file_upload?.allowed_file_upload_methods || props.publishedConfig.modelConfig.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
        number_limits: props.publishedConfig.modelConfig.file_upload?.number_limits || props.publishedConfig.modelConfig.file_upload?.image?.number_limits || 3,
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
      }}/>
      {restoreConfirmOpen && (
        <Confirm
          title={t('appDebug.resetConfig.title')}
          content={t('appDebug.resetConfig.message')}
          isShow={restoreConfirmOpen}
          onConfirm={handleConfirm}
          onCancel={() => setRestoreConfirmOpen(false)}
        />
      )}
    </>
  )
}

export default FeaturesWrappedAppPublisher
