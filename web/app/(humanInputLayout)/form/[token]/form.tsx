'use client'
import type { FormInputItem, UserAction } from '@/app/components/workflow/nodes/human-input/types'
import type { SiteInfo } from '@/models/share'
import type { HumanInputFormError } from '@/service/use-share'
import type { HumanInputResolvedValue } from '@/types/workflow'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import useDocumentTitle from '@/hooks/use-document-title'
import { useParams } from '@/next/navigation'
import { useGetHumanInputForm } from '@/service/use-share'
import FormStatusCard from './form-status-card'
import LoadedFormContent from './loaded-form-content'
import { useFormSubmit } from './use-form-submit'

export type FormData = {
  site: { site: SiteInfo }
  form_content: string
  inputs: FormInputItem[]
  resolved_default_values: Record<string, HumanInputResolvedValue>
  user_actions: UserAction[]
  expiration_time: number
}

const FormContent = () => {
  const { t } = useTranslation()

  const { token } = useParams<{ token: string }>()
  useDocumentTitle('')

  const { data: formData, isLoading, error } = useGetHumanInputForm(token)
  const { isSubmitting, submit, success } = useFormSubmit(token)

  const expired = (error as HumanInputFormError | null)?.code === 'human_input_form_expired'
  const submitted = (error as HumanInputFormError | null)?.code === 'human_input_form_submitted'
  const rateLimitExceeded = (error as HumanInputFormError | null)?.code === 'web_form_rate_limit_exceeded'

  if (isLoading) {
    return (
      <Loading type="app" />
    )
  }

  if (success) {
    return (
      <FormStatusCard
        iconClassName="i-ri-checkbox-circle-fill text-text-success"
        title={t('humanInput.thanks', { ns: 'share' })}
        subtitle={t('humanInput.recorded', { ns: 'share' })}
        submissionID={token}
      />
    )
  }

  if (expired) {
    return (
      <FormStatusCard
        iconClassName="i-ri-information-2-fill text-text-accent"
        title={t('humanInput.sorry', { ns: 'share' })}
        subtitle={t('humanInput.expired', { ns: 'share' })}
        submissionID={token}
      />
    )
  }

  if (submitted) {
    return (
      <FormStatusCard
        iconClassName="i-ri-information-2-fill text-text-accent"
        title={t('humanInput.sorry', { ns: 'share' })}
        subtitle={t('humanInput.completed', { ns: 'share' })}
        submissionID={token}
      />
    )
  }

  if (rateLimitExceeded) {
    return (
      <FormStatusCard
        iconClassName="i-ri-error-warning-fill text-text-destructive"
        title={t('humanInput.rateLimitExceeded', { ns: 'share' })}
      />
    )
  }

  if (!formData) {
    return (
      <FormStatusCard
        iconClassName="i-ri-error-warning-fill text-text-destructive"
        title={t('humanInput.formNotFound', { ns: 'share' })}
      />
    )
  }

  return (
    <LoadedFormContent
      key={token}
      formData={formData}
      isSubmitting={isSubmitting}
      onSubmit={submit}
    />
  )
}

export default React.memo(FormContent)
