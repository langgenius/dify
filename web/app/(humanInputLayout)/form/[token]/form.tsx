'use client'
import { Button } from '@langgenius/dify-ui/button'
import { ORPCError } from '@orpc/client'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { getProcessedHumanInputFormInputs } from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import {
  FileUploadContext,
  useFileUploadContext,
} from '@/app/components/base/file-uploader/upload-context'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { ENABLE_HITL_IM } from '@/config'
import FormStatusCard from '@/features/human-input/form/form-status-card'
import LoadedFormContent from '@/features/human-input/form/loaded-form-content'
import { normalizeLegacyHumanInputForm } from '@/features/human-input/form/normalize-legacy-definition'
import { createLegacyFormUploadStrategy } from '@/features/human-input/public/legacy-upload'
import useDocumentTitle from '@/hooks/use-document-title'
import { useParams } from '@/next/navigation'
import { getHttpErrorStatus } from '@/service/http-error'
import { humanInputFormQueryOptions } from '@/service/share-queries'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import LegacyLoadedFormContent from './loaded-form-content'
import { useFormSubmit } from './use-form-submit'

const FormContent = () => {
  const { t } = useTranslation(['common', 'share'])

  const { token } = useParams<{ token: string }>()
  const inheritedUploadContext = useFileUploadContext()
  const uploadContext = React.useMemo(
    () => ({
      ...inheritedUploadContext,
      uploadStrategy: createLegacyFormUploadStrategy(token),
    }),
    [inheritedUploadContext, token],
  )

  const formQuery = useQuery(humanInputFormQueryOptions(token))
  const { data: formData, isLoading, error } = formQuery
  // Every failed first load replaces the form with a status card.
  const formLoad = useOwnedQueryError(formQuery)
  const { isSubmitting, submit, success } = useFormSubmit(token)

  const removeWebappBrand = formData?.site?.custom_config?.remove_webapp_brand === true
  const replaceWebappLogo =
    typeof formData?.site?.custom_config?.replace_webapp_logo === 'string'
      ? formData.site.custom_config.replace_webapp_logo
      : null

  const errorCode = error instanceof ORPCError ? error.code : undefined
  const expired = errorCode === 'human_input_form_expired'
  const submitted = errorCode === 'human_input_form_submitted'
  const rateLimitExceeded = errorCode === 'web_form_rate_limit_exceeded'
  // A missing form keeps its "not found" card; any other failed load says why and can retry.
  const loadError = formLoad?.error
  const loadErrorMessage = useRequestErrorMessage(
    (loadError instanceof ORPCError && loadError.code === 'not_found') ||
      getHttpErrorStatus(loadError) === 404
      ? null
      : loadError,
  )
  const documentTitle = isLoading
    ? t(($) => $.loading, { ns: 'common' })
    : success
      ? t(($) => $['humanInput.thanks'], { ns: 'share' })
      : expired
        ? t(($) => $['humanInput.expired'], { ns: 'share' })
        : submitted
          ? t(($) => $['humanInput.completed'], { ns: 'share' })
          : rateLimitExceeded
            ? t(($) => $['humanInput.rateLimitExceeded'], { ns: 'share' })
            : formData?.site.site.title || t(($) => $['humanInput.formNotFound'], { ns: 'share' })
  useDocumentTitle(documentTitle)

  if (isLoading) {
    return <LoadingPlaceholder className="h-full" />
  }

  if (success) {
    return (
      <FormStatusCard
        legacy={!ENABLE_HITL_IM}
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
        legacy={!ENABLE_HITL_IM}
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
        legacy={!ENABLE_HITL_IM}
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
        legacy={!ENABLE_HITL_IM}
        iconClassName="i-ri-error-warning-fill text-text-destructive"
        title={t(($) => $['humanInput.rateLimitExceeded'], { ns: 'share' })}
      />
    )
  }

  if (formLoad && loadErrorMessage) {
    return (
      <FormStatusCard
        legacy={!ENABLE_HITL_IM}
        iconClassName="i-ri-error-warning-fill text-text-destructive"
        title={loadErrorMessage}
      >
        <div>
          <Button loading={formLoad.retrying} onClick={formLoad.retry}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      </FormStatusCard>
    )
  }

  if (!formData) {
    return (
      <FormStatusCard
        legacy={!ENABLE_HITL_IM}
        iconClassName="i-ri-error-warning-fill text-text-destructive"
        title={t(($) => $['humanInput.formNotFound'], { ns: 'share' })}
      />
    )
  }

  return (
    <FileUploadContext value={uploadContext}>
      {!ENABLE_HITL_IM ? (
        <LegacyLoadedFormContent
          key={token}
          formData={formData}
          isSubmitting={isSubmitting}
          removeWebappBrand={removeWebappBrand}
          replaceWebappLogo={replaceWebappLogo}
          onSubmit={(inputs, action, formInputs) =>
            submit(getProcessedHumanInputFormInputs(formInputs, inputs) || {}, action)
          }
        />
      ) : (
        <LoadedFormContent
          key={token}
          definition={normalizeLegacyHumanInputForm(formData)}
          isSubmitting={isSubmitting}
          onSubmit={submit}
        />
      )}
    </FileUploadContext>
  )
}

export default React.memo(FormContent)
