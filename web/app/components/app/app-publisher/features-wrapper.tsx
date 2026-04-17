import type { AppPublisherProps } from '@/app/components/app/app-publisher'
import type { ModelAndParameter } from '@/app/components/app/configuration/debug/types'
import type { FileUpload } from '@/app/components/base/features/types'
import type { PublishWorkflowParams } from '@/types/workflow'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppPublisher from '@/app/components/app/app-publisher'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { Resolution } from '@/types/app'

type Props = Omit<AppPublisherProps, 'onPublish'> & {
  onPublish?: (params?: ModelAndParameter | PublishWorkflowParams, features?: any) => Promise<any> | any
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
        allowed_file_extensions: file_upload?.allowed_file_extensions || FILE_EXTS[SupportUploadFileTypes.image]!.map(ext => `.${ext}`),
        allowed_file_upload_methods: file_upload?.allowed_file_upload_methods || file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
        number_limits: file_upload?.number_limits || file_upload?.image?.number_limits || 3,
      } as FileUpload
    })
    setFeatures(newFeatures)
    setRestoreConfirmOpen(false)
  }, [featuresStore, props])

  const handlePublish = useCallback((params?: ModelAndParameter | PublishWorkflowParams) => {
    return props.onPublish?.(params, features)
  }, [features, props])

  return (
    <>
      <AppPublisher {...{
        ...props,
        onPublish: handlePublish,
        onRestore: () => setRestoreConfirmOpen(true),
      }}
      />
      <AlertDialog open={restoreConfirmOpen} onOpenChange={open => !open && setRestoreConfirmOpen(false)}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('resetConfig.title', { ns: 'appDebug' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('resetConfig.message', { ns: 'appDebug' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={handleConfirm}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default FeaturesWrappedAppPublisher
