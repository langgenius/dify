'use client'

import type { FileScanProviderResponse } from '@dify/contracts/api/console/file-scan/types.gen'
import type { AlertDialogActions } from '@langgenius/dify-ui/alert-dialog'
import type { ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'
import { ProviderTypeIcon } from './provider-type-icon'
import { isFileScanProviderType, useFileScanProviderTypeLabel } from './provider-types'
import { FileScanProviderDialog } from './scanner-dialog'

type DialogState = { mode: 'create' } | { mode: 'edit'; provider: FileScanProviderResponse } | null

function ScannerItem({
  canManage,
  onEdit,
  provider,
}: {
  canManage: boolean
  onEdit: (provider: FileScanProviderResponse) => void
  provider: FileScanProviderResponse
}) {
  const { t } = useTranslation(['fileScan'])
  const { t: tCommon } = useTranslation(['common'])
  const typeLabel = useFileScanProviderTypeLabel()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const nameId = useId()
  const statusId = useId()
  const testLabelId = useId()
  const editLabelId = useId()
  const deleteLabelId = useId()
  const deleteActionsRef = useRef<AlertDialogActions>(null)
  const testMutation = useMutation(
    consoleQuery.fileScan.providers.byProviderId.test.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const deleteMutation = useMutation(
    consoleQuery.fileScan.providers.byProviderId.delete.mutationOptions({
      context: { silent: true },
    }),
  )
  const hasError = provider.status === 'error'

  return (
    <li className="rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg px-4 py-3 shadow-xs">
      <div className="flex items-center gap-3">
        {isFileScanProviderType(provider.provider_type) && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-background-default-dodge">
            <ProviderTypeIcon type={provider.provider_type} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span id={nameId} className="truncate system-sm-semibold text-text-primary">
              {provider.name}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <StatusDot status={hasError ? 'error' : 'success'} />
              <span
                id={statusId}
                className={
                  hasError
                    ? 'system-xs-medium text-text-destructive'
                    : 'system-xs-medium text-text-success'
                }
              >
                {t(($) => (hasError ? $['scanner.status.error'] : $['scanner.status.active']))}
              </span>
              {hasError && provider.last_error && (
                <Infotip>
                  <InfotipTrigger aria-labelledby={`${statusId} ${nameId}`} />
                  <InfotipContent aria-labelledby={statusId} className="max-w-80">
                    {provider.last_error}
                  </InfotipContent>
                </Infotip>
              )}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 system-xs-regular text-text-tertiary">
            <span>{typeLabel(provider.provider_type)}</span>
            <span aria-hidden>·</span>
            <span>{t(($) => $['scanner.usedBy'], { count: provider.policy_count })}</span>
            <span aria-hidden>·</span>
            <span>
              {provider.last_tested_at
                ? t(($) => $['scanner.lastTested'], {
                    time: formatTimeFromNow(provider.last_tested_at * 1000),
                  })
                : t(($) => $['scanner.neverTested'])}
            </span>
          </div>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              aria-labelledby={`${testLabelId} ${nameId}`}
              size="small"
              loading={testMutation.isPending}
              onClick={() => testMutation.mutate({ params: { provider_id: provider.id } })}
            >
              <span id={testLabelId}>{t(($) => $['scanner.test'])}</span>
            </Button>
            <Button
              aria-labelledby={`${editLabelId} ${nameId}`}
              size="small"
              onClick={() => onEdit(provider)}
            >
              <span id={editLabelId}>{tCommon(($) => $['operation.edit'])}</span>
            </Button>
            <AlertDialog
              actionsRef={deleteActionsRef}
              onOpenChange={(open) => {
                if (!open) deleteMutation.reset()
              }}
            >
              <AlertDialogTrigger
                aria-labelledby={`${deleteLabelId} ${nameId}`}
                render={<Button size="small" />}
              >
                <span id={deleteLabelId}>{tCommon(($) => $['operation.delete'])}</span>
              </AlertDialogTrigger>
              <AlertDialogContent backdropProps={{ forceRender: true }}>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t(($) => $['scanner.deleteTitle'], { name: provider.name })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t(($) => $['scanner.deleteDescription'])}
                  </AlertDialogDescription>
                  {deleteMutation.isError && (
                    <p
                      role="alert"
                      className="rounded-lg bg-state-destructive-hover px-3 py-2 system-xs-regular text-text-destructive"
                    >
                      {getErrorMessage(deleteMutation.error) ?? t(($) => $['scanner.deleteFailed'])}
                    </p>
                  )}
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancelButton>
                    {tCommon(($) => $['operation.cancel'])}
                  </AlertDialogCancelButton>
                  <AlertDialogConfirmButton
                    loading={deleteMutation.isPending}
                    onClick={() =>
                      deleteMutation.mutate(
                        { params: { provider_id: provider.id } },
                        { onSuccess: () => deleteActionsRef.current?.close() },
                      )
                    }
                  >
                    {tCommon(($) => $['operation.delete'])}
                  </AlertDialogConfirmButton>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
      {testMutation.isError && (
        <p role="alert" className="mt-2 system-xs-regular text-text-destructive">
          {getErrorMessage(testMutation.error) ?? t(($) => $['scanner.testFailed'])}
        </p>
      )}
    </li>
  )
}

type FileScanProvidersPageProps = {
  /** The host page places the toolbar in its own header, as the other Integrations sections do. */
  layout: (parts: { body: ReactNode; toolbar: ReactNode }) => ReactNode
}

export function FileScanProvidersPage({ layout }: FileScanProvidersPageProps) {
  const { t } = useTranslation(['fileScan'])
  const { t: tCommon } = useTranslation(['common'])
  const canManage = useAtomValue(isCurrentWorkspaceManagerAtom)
  const providersQuery = useQuery(consoleQuery.fileScan.providers.get.queryOptions())
  const { data: providerTypes } = useQuery(
    consoleQuery.fileScan.providerTypes.get.queryOptions({ enabled: canManage }),
  )
  const [dialogState, setDialogState] = useState<DialogState>(null)
  const providers = providersQuery.data?.data ?? []
  const closeDialog = () => setDialogState(null)

  // Only owners and admins get an action; everyone else sees the read-only notice in the body.
  const toolbar = canManage ? (
    <div className="flex w-full justify-end">
      <Button
        variant="secondary"
        disabled={!providerTypes}
        onClick={() => setDialogState({ mode: 'create' })}
      >
        <span aria-hidden className="i-ri-add-line size-4" />
        {t(($) => $['scanner.add'])}
      </Button>
    </div>
  ) : null

  const body = (
    <div className="flex flex-col gap-3">
      {!canManage && (
        <p className="flex items-center gap-2 rounded-lg border border-components-panel-border bg-background-section px-3 py-2 system-xs-regular text-text-tertiary">
          <span aria-hidden className="i-ri-lock-2-line size-4 shrink-0" />
          {t(($) => $['scanner.readOnly'])}
        </p>
      )}

      {providersQuery.isPending && <LoadingPlaceholder className="py-10" />}
      {providersQuery.isError && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-xl border border-components-panel-border bg-background-section p-4"
        >
          <span aria-hidden className="i-ri-error-warning-line size-5 text-text-destructive" />
          <p className="min-w-0 flex-1 system-sm-regular text-text-secondary">
            {t(($) => $['scanner.loadFailed'])}
          </p>
          <Button onClick={() => void providersQuery.refetch()}>
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      )}
      {providersQuery.isSuccess && !providers.length && (
        <p className="rounded-xl bg-background-section p-6 system-sm-regular text-text-tertiary">
          {t(($) => $['scanner.empty'])}
        </p>
      )}
      {providers.length > 0 && (
        <ul className="flex flex-col gap-2">
          {providers.map((provider) => (
            <ScannerItem
              key={provider.id}
              canManage={canManage}
              provider={provider}
              onEdit={(edited) => setDialogState({ mode: 'edit', provider: edited })}
            />
          ))}
        </ul>
      )}

      {dialogState && providerTypes && (
        <FileScanProviderDialog
          open
          provider={dialogState.mode === 'edit' ? dialogState.provider : undefined}
          providerTypes={providerTypes.data}
          onOpenChange={(open) => {
            if (!open) closeDialog()
          }}
          onSaved={closeDialog}
        />
      )}
    </div>
  )

  return layout({ body, toolbar })
}
