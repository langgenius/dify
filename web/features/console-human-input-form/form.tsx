'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import FormStatusCard from '@/features/human-input-form/form-status-card'
import LoadedFormContent from '@/features/human-input-form/loaded-form-content'
import useDocumentTitle from '@/hooks/use-document-title'
import { consoleQuery } from '@/service/client'
import { submitHumanInputForm } from '@/service/workflow'
import { normalizeConsoleFormDefinition } from './definition'

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const getErrorKind = (error: unknown) => {
  const record = asRecord(error)
  const data = asRecord(record.data)
  const code = asRecord(data.body).code ?? data.code ?? record.code
  if (code === 'human_input_form_expired') return 'expired'
  if (code === 'human_input_form_submitted') return 'submitted'
  if (record.status === 404 || code === 'human_input_form_not_found') return 'not-found'
  if (record.status === 429) return 'rate-limited'
  return 'unknown'
}

export default function ConsoleHumanInputForm({ formToken }: { formToken: string }) {
  const { t } = useTranslation()
  useDocumentTitle(t(($) => $['blocks.human-input'], { ns: 'workflow' }))
  const [submitError, setSubmitError] = useState<unknown>()
  const [now, setNow] = useState(Date.now)
  const form = useQuery(
    consoleQuery.form.humanInput.byFormToken.get.queryOptions({
      input: { params: { form_token: formToken } },
      context: { silent: true },
      select: normalizeConsoleFormDefinition,
      retry: false,
      staleTime: 0,
      gcTime: 0,
      refetchOnWindowFocus: false,
    }),
  )
  const expiresAt =
    form.data?.expirationTime === undefined ? undefined : form.data.expirationTime * 1000
  useEffect(() => {
    if (expiresAt === undefined || expiresAt <= now) return
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(0, expiresAt - Date.now()), 2_147_483_647),
    )
    return () => window.clearTimeout(timer)
  }, [expiresAt, now])
  // Reuse the working Console submit path. Its generated contract still requires
  // the obsolete form_inputs field; the actual API uses inputs and action.
  const submission = useMutation({
    mutationFn: (payload: Parameters<typeof submitHumanInputForm>[1]) =>
      submitHumanInputForm(formToken, payload),
  })
  const errorKind =
    expiresAt !== undefined && expiresAt <= now
      ? 'expired'
      : getErrorKind(submitError ?? form.error)
  const terminal = ['expired', 'submitted', 'not-found'].includes(errorKind)
  const errorText =
    errorKind === 'expired'
      ? t(($) => $['humanInput.expired'], { ns: 'share' })
      : errorKind === 'submitted'
        ? t(($) => $['humanInput.completed'], { ns: 'share' })
        : errorKind === 'not-found'
          ? t(($) => $['humanInput.formNotFound'], { ns: 'share' })
          : errorKind === 'rate-limited'
            ? t(($) => $['humanInput.rateLimitExceeded'], { ns: 'share' })
            : t(($) => $['humanInputV2.unknownError'], { ns: 'share' })

  if (form.isPending) return <Loading type="app" />

  if (submission.isSuccess) {
    return (
      <FormStatusCard
        iconClassName="i-ri-checkbox-circle-fill text-text-success"
        title={t(($) => $['humanInput.thanks'], { ns: 'share' })}
        subtitle={t(($) => $['humanInput.recorded'], { ns: 'share' })}
        submissionID={formToken}
      />
    )
  }

  if (form.isError || terminal) {
    return (
      <FormStatusCard
        iconClassName="i-ri-information-2-fill text-text-accent"
        title={errorText}
        subtitle={
          !terminal && (
            <Button onClick={() => form.refetch()} disabled={form.isFetching}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          )
        }
      />
    )
  }

  return (
    <form className="h-full" onSubmit={(event) => event.preventDefault()}>
      <LoadedFormContent
        definition={form.data}
        isSubmitting={submission.isPending}
        verificationContent={
          submitError ? (
            <p role="alert" className="system-sm-regular text-text-destructive">
              {errorText}
            </p>
          ) : undefined
        }
        onSubmit={async (inputs, action) => {
          if (expiresAt !== undefined && expiresAt <= Date.now()) {
            setNow(Date.now())
            return
          }
          setSubmitError(undefined)
          try {
            await submission.mutateAsync({ inputs, action })
          } catch (error) {
            const detail: unknown =
              error instanceof Response
                ? {
                    status: error.status,
                    data: await error
                      .clone()
                      .json()
                      .catch(() => ({})),
                  }
                : error
            setSubmitError(detail)
          }
        }}
      />
    </form>
  )
}
