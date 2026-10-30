'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import FormStatusCard from '@/features/human-input/form/form-status-card'
import LoadedFormContent from '@/features/human-input/form/loaded-form-content'
import useDocumentTitle from '@/hooks/use-document-title'
import { consoleQuery } from '@/service/console'
import { useLogout } from '@/service/use-common'
import { basePath } from '@/utils/var'
import { normalizeHumanInputV2Error } from '../public/errors'
import { normalizeConsoleFormDefinition } from './definition'

function UnavailableConsoleForm({ formToken }: { formToken: string }) {
  const { t } = useTranslation(['share'])
  const { data } = useQuery(userProfileQueryOptions())
  const profile = data?.profile
  const accountName = profile?.name?.trim() || profile?.email
  const returnPath = `${basePath}/human-input/${encodeURIComponent(formToken)}`
  const logout = useLogout({
    redirectTo: `/signin?redirect_url=${encodeURIComponent(returnPath)}`,
  })

  return (
    <FormStatusCard
      iconClassName="i-ri-information-2-fill text-text-accent"
      title={t(($) => $['humanInput.unavailableTitle'])}
      description={t(($) => $['humanInput.unavailableDescription'])}
    >
      <div className="flex flex-col items-start gap-3">
        {accountName && (
          <p className="system-sm-regular wrap-anywhere text-text-tertiary">
            {t(($) => $['humanInput.currentAccount'], { name: accountName })}
          </p>
        )}
        <Button loading={logout.isPending} onClick={() => logout.mutate()}>
          {t(($) => $['humanInput.switchAccount'])}
        </Button>
      </div>
    </FormStatusCard>
  )
}

export default function ConsoleHumanInputForm({ formToken }: { formToken: string }) {
  const { t } = useTranslation(['workflow', 'share', 'common'])
  useDocumentTitle(t(($) => $['blocks.human-input'], { ns: 'workflow' }))
  const [now, setNow] = useState(Date.now)
  const form = useQuery(
    consoleQuery.form.humanInput.v2.byFormToken.get.queryOptions({
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
  const submission = useMutation(
    consoleQuery.form.humanInput.v2.byFormToken.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const errorKind =
    expiresAt !== undefined && expiresAt <= now
      ? 'form-expired'
      : normalizeHumanInputV2Error(submission.error ?? form.error).category
  const terminal = ['form-expired', 'already-submitted', 'not-found'].includes(errorKind)
  const errorText =
    errorKind === 'form-expired'
      ? t(($) => $['humanInput.expired'], { ns: 'share' })
      : errorKind === 'already-submitted'
        ? t(($) => $['humanInput.completed'], { ns: 'share' })
        : errorKind === 'form-rate-limit'
          ? t(($) => $['humanInput.rateLimitExceeded'], { ns: 'share' })
          : errorKind === 'unavailable'
            ? t(($) => $['humanInputV2.unavailable'], { ns: 'share' })
            : t(($) => $['humanInputV2.unknownError'], { ns: 'share' })

  if (form.isPending) return <LoadingPlaceholder className="h-full" />

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

  if (errorKind === 'already-submitted') {
    return (
      <FormStatusCard
        iconClassName="i-ri-information-2-fill text-text-accent"
        title={t(($) => $['humanInput.sorry'], { ns: 'share' })}
        subtitle={errorText}
        submissionID={formToken}
      />
    )
  }

  if (errorKind === 'not-found') return <UnavailableConsoleForm formToken={formToken} />

  if (form.isError || terminal) {
    return (
      <FormStatusCard
        iconClassName="i-ri-information-2-fill text-text-accent"
        title={errorText}
        subtitle={
          !terminal && (
            <Button onClick={() => form.refetch()} loading={form.isFetching}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          )
        }
      />
    )
  }

  return (
    <div className="h-full">
      <LoadedFormContent
        definition={form.data}
        isSubmitting={submission.isPending}
        verificationContent={
          submission.isError ? (
            <p role="alert" className="system-sm-regular text-text-destructive">
              {errorText}
            </p>
          ) : undefined
        }
        onSubmit={(inputs, action) => {
          if (expiresAt !== undefined && expiresAt <= Date.now()) {
            setNow(Date.now())
            return
          }
          return new Promise<void>((resolve) => {
            submission.mutate(
              { params: { form_token: formToken }, body: { inputs, action } },
              { onSettled: () => resolve() },
            )
          })
        }}
      />
    </div>
  )
}
