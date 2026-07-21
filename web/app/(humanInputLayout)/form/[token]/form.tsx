'use client'
import type { LegacyHumanInputFormData } from '@/features/human-input-form/types'
import type { HumanInputFormError } from '@/service/use-share'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import FormStatusCard from '@/features/human-input-form/form-status-card'
import LoadedFormContent from '@/features/human-input-form/loaded-form-content'
import { normalizeLegacyHumanInputForm } from '@/features/human-input-form/normalize-legacy-definition'
import useDocumentTitle from '@/hooks/use-document-title'
import { useParams } from '@/next/navigation'
import { useGetHumanInputForm } from '@/service/use-share'
import { useFormSubmit } from './use-form-submit'

export type FormData = LegacyHumanInputFormData

const FormContent = () => {
  const { t } = useTranslation()

  const { token } = useParams<{ token: string }>()
  useDocumentTitle('')

  const { data: formData, isLoading, error } = useGetHumanInputForm(token)
  const { isSubmitting, submit, success } = useFormSubmit(token)

  const removeWebappBrand = formData?.site?.custom_config?.remove_webapp_brand === true
  const replaceWebappLogo =
    typeof formData?.site?.custom_config?.replace_webapp_logo === 'string'
      ? formData.site.custom_config.replace_webapp_logo
      : null

  const expired = (error as HumanInputFormError | null)?.code === 'human_input_form_expired'
  const submitted = (error as HumanInputFormError | null)?.code === 'human_input_form_submitted'
  const rateLimitExceeded =
    (error as HumanInputFormError | null)?.code === 'web_form_rate_limit_exceeded'

  if (isLoading) {
    return <Loading type="app" />
  }

  if (success) {
    return (
      <FormStatusCard
        iconClassName="i-ri-checkbox-circle-fill text-text-success"
        title={t(($) => $['humanInput.thanks'], { ns: 'share' })}
        subtitle={t(($) => $['humanInput.recorded'], { ns: 'share' })}
        submissionID={token}
        removeWebappBrand={removeWebappBrand}
        replaceWebappLogo={replaceWebappLogo}
      />
    )
  }

  if (expired) {
    return (
      <FormStatusCard
        iconClassName="i-ri-information-2-fill text-text-accent"
        title={t(($) => $['humanInput.sorry'], { ns: 'share' })}
        subtitle={t(($) => $['humanInput.expired'], { ns: 'share' })}
        submissionID={token}
      />
    )
  }

  if (submitted) {
    return (
      <FormStatusCard
        iconClassName="i-ri-information-2-fill text-text-accent"
        title={t(($) => $['humanInput.sorry'], { ns: 'share' })}
        subtitle={t(($) => $['humanInput.completed'], { ns: 'share' })}
        submissionID={token}
      />
    )
  }

  if (rateLimitExceeded) {
    return (
      <FormStatusCard
        iconClassName="i-ri-error-warning-fill text-text-destructive"
        title={t(($) => $['humanInput.rateLimitExceeded'], { ns: 'share' })}
      />
    )
  }

  if (!formData) {
    return (
      <FormStatusCard
        iconClassName="i-ri-error-warning-fill text-text-destructive"
        title={t(($) => $['humanInput.formNotFound'], { ns: 'share' })}
      />
    )
  }

  return (
    <LoadedFormContent
      key={token}
      definition={normalizeLegacyHumanInputForm(formData)}
      isSubmitting={isSubmitting}
      onSubmit={submit}
    />
  )
}

export default React.memo(FormContent)
