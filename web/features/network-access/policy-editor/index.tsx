'use client'

import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { DialogContentProps } from '@langgenius/dify-ui/dialog'
import type { IpPolicyFormSession } from './policy-form-analytics'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { useQuery } from '@tanstack/react-query'
import { Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  canSubmitIpPolicy,
  collectAllowedCidrs,
  IP_POLICY_NAME_MAX_LENGTH,
} from '@/features/network-access/ip-policy'
import { PolicyReferencedApps } from '@/features/network-access/policy-references'
import { consoleQuery } from '@/service/console'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { AllowlistField } from './allowlist-field'
import { createAllowlistRow } from './allowlist-row'
import { recordPolicyValidation } from './policy-form-analytics'

export type IpPolicyDialogSubmit = {
  name: string
  allowed_cidrs: string[]
}

type IpPolicyFormProps = {
  mode: 'create' | 'edit' | 'view'
  currentIp?: string
  initialName?: string
  initialEntries?: readonly string[]
  usedByCount?: number
  referencedApps?: NetworkAccessGroupResponse['apps']
  isPending?: boolean
  dismissDisabled?: boolean
  recoveryError?: boolean
  onRetryRecovery?: () => void
  onValidateEntries?: (entries: readonly string[]) => void
  onSubmit?: (payload: IpPolicyDialogSubmit) => void
}

export function IpPolicyDialog({
  open,
  onOpenChange,
  analyticsSession,
  ...formProps
}: Omit<IpPolicyFormProps, 'onValidateEntries'> & {
  analyticsSession?: IpPolicyFormSession
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <IpPolicyDialogContent>
        <IpPolicyForm
          {...formProps}
          onValidateEntries={(entries) => {
            if (analyticsSession) recordPolicyValidation(analyticsSession, entries)
          }}
        />
      </IpPolicyDialogContent>
    </Dialog>
  )
}

export function IpPolicyDialogContent({
  children,
  finalFocus,
}: Pick<DialogContentProps, 'children' | 'finalFocus'>) {
  return (
    <DialogContent
      backdropProps={{ forceRender: true }}
      className="max-h-[80dvh] w-120"
      finalFocus={finalFocus}
    >
      {children}
    </DialogContent>
  )
}

function RecoveryErrorMessage() {
  const { t } = useTranslation(['deployments'])
  return t(($) => $['common.loadFailed'], { ns: 'deployments' })
}

export function IpPolicyForm({
  mode,
  currentIp,
  initialName = '',
  initialEntries,
  usedByCount = 0,
  referencedApps = [],
  isPending = false,
  dismissDisabled = false,
  recoveryError = false,
  onRetryRecovery,
  onValidateEntries,
  onSubmit,
}: IpPolicyFormProps) {
  const { t } = useTranslation(['common'])
  const currentIpQuery = useQuery(
    consoleQuery.workspaces.current.networkAccessGroups.currentIp.get.queryOptions({
      enabled: mode !== 'view' && currentIp === undefined,
      retry: false,
      meta: { errorToast: false },
    }),
  )
  const currentIpErrorMessage = useRequestErrorMessage(
    currentIpQuery.error,
    t(($) => $['settings.ipPolicyCurrentIpError']),
  )
  const resolvedCurrentIp =
    currentIp ?? (currentIpQuery.isSuccess ? currentIpQuery.data.client_ip : undefined)
  const currentIpStatus =
    currentIp !== undefined || currentIpQuery.isSuccess
      ? undefined
      : currentIpQuery.isError
        ? 'error'
        : 'loading'
  const [name, setName] = useState(initialName)
  const [entries, setEntries] = useState(() =>
    initialEntries && initialEntries.length > 0
      ? initialEntries.map((value) => createAllowlistRow(value))
      : [createAllowlistRow()],
  )

  const entryValues = entries.map((entry) => entry.value)
  const canSubmit = canSubmitIpPolicy(name, entryValues)

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {mode === 'view'
            ? initialName
            : mode === 'edit'
              ? t(($) => $['settings.ipPolicyEditTitle'], { ns: 'common' })
              : t(($) => $['settings.ipPolicyNewTitle'], { ns: 'common' })}
        </DialogTitle>
        <DialogDescription>
          {mode === 'view'
            ? t(($) => $['settings.ipPolicyViewDescription'], { ns: 'common' })
            : t(($) => $['settings.ipPolicyDialogDescription'], { ns: 'common' })}
        </DialogDescription>
        <DialogHeaderCloseButton
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          disabled={dismissDisabled}
        />
      </DialogHeader>

      {mode === 'view' ? (
        <>
          <DialogBody>
            <dl className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <dt className="system-sm-medium text-text-primary">
                  {t(($) => $['settings.ipPolicyAllowlist'], { ns: 'common' })}
                </dt>
                <dd>
                  <ul className="flex flex-col gap-2">
                    {initialEntries?.map((entry) => (
                      <li
                        key={entry}
                        className="system-sm-regular wrap-anywhere text-text-secondary"
                      >
                        <code>{entry}</code>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              {usedByCount > 0 && (
                <div className="flex flex-col gap-3">
                  <dt className="system-sm-medium text-text-primary">
                    {t(($) => $['settings.ipPolicyUsedByLabel'], { ns: 'common' })}
                  </dt>
                  <dd>
                    <PolicyReferencedApps apps={referencedApps} usedByCount={usedByCount} />
                  </dd>
                </div>
              )}
            </dl>
          </DialogBody>
          <DialogFooter>
            <DialogClose disabled={dismissDisabled} render={<Button variant="secondary" />}>
              {t(($) => $['operation.close'], { ns: 'common' })}
            </DialogClose>
          </DialogFooter>
        </>
      ) : (
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canSubmit || isPending || recoveryError) return
            onSubmit?.({
              name: name.trim(),
              allowed_cidrs: collectAllowedCidrs(entryValues),
            })
          }}
        >
          <DialogBody>
            <div className="flex flex-col gap-6">
              <Field className="flex shrink-0 flex-col gap-3">
                <FieldLabel>{t(($) => $['settings.ipPolicyName'], { ns: 'common' })}</FieldLabel>
                <Input
                  value={name}
                  maxLength={IP_POLICY_NAME_MAX_LENGTH}
                  placeholder={t(($) => $['settings.ipPolicyNamePlaceholder'], { ns: 'common' })}
                  onChange={(event) => setName(event.currentTarget.value)}
                />
              </Field>

              <AllowlistField
                entries={entries}
                currentIp={resolvedCurrentIp}
                currentIpStatus={currentIpStatus}
                currentIpErrorMessage={currentIpErrorMessage}
                isRetryingCurrentIp={
                  currentIpStatus !== undefined &&
                  currentIpQuery.isFetched &&
                  (currentIpQuery.isFetching || currentIpQuery.isPaused)
                }
                onRetryCurrentIp={() => {
                  void currentIpQuery.refetch()
                }}
                onEntriesChange={(nextEntries) => {
                  onValidateEntries?.(nextEntries.map((entry) => entry.value))
                  setEntries(nextEntries)
                }}
              />

              {mode === 'edit' && usedByCount > 0 && (
                <Field className="flex shrink-0 flex-col gap-3">
                  <FieldLabel>
                    {t(($) => $['settings.ipPolicyUsedByLabel'], { ns: 'common' })}
                  </FieldLabel>
                  <p className="system-xs-regular text-text-tertiary">
                    {t(($) => $['settings.ipPolicyEditUsedBy'], { ns: 'common' })}
                  </p>
                  <PolicyReferencedApps apps={referencedApps} usedByCount={usedByCount} />
                </Field>
              )}

              {recoveryError && (
                <div role="alert" className="flex shrink-0 items-center justify-between gap-3">
                  <p className="system-sm-regular text-text-destructive">
                    <Suspense fallback={null}>
                      <RecoveryErrorMessage />
                    </Suspense>
                  </p>
                  <Button type="button" variant="secondary" onClick={onRetryRecovery}>
                    {t(($) => $['errorBoundary.tryAgain'], { ns: 'common' })}
                  </Button>
                </div>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose
              disabled={dismissDisabled}
              render={<Button type="button" variant="secondary" />}
            >
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
            <Button
              type="submit"
              variant="primary"
              disabled={!canSubmit || isPending || recoveryError}
              loading={isPending}
            >
              {mode === 'edit'
                ? t(($) => $['operation.save'], { ns: 'common' })
                : t(($) => $['settings.ipPolicyCreate'], { ns: 'common' })}
            </Button>
          </DialogFooter>
        </form>
      )}
    </>
  )
}
