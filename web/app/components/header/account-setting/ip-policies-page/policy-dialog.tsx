'use client'

import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AllowlistField } from './allowlist-field'
import { createAllowlistRow } from './allowlist-row'
import { PolicyReferencedApps } from './referenced-apps'
import {
  canSubmitIpPolicy,
  collectAllowedCidrs,
  IP_POLICY_NAME_MAX_LENGTH,
} from './validate-ip-entry'

export type IpPolicyDialogSubmit = {
  name: string
  allowed_cidrs: string[]
}

type IpPolicyDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  currentIp?: string
  initialName?: string
  initialEntries?: readonly string[]
  usedByCount?: number
  referencedApps?: NetworkAccessGroupResponse['apps']
  isPending?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit?: (payload: IpPolicyDialogSubmit) => void
}

export function IpPolicyDialog({
  open,
  mode,
  currentIp,
  initialName = '',
  initialEntries,
  usedByCount = 0,
  referencedApps = [],
  isPending = false,
  onOpenChange,
  onSubmit,
}: IpPolicyDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const [entries, setEntries] = useState(() =>
    initialEntries && initialEntries.length > 0
      ? initialEntries.map((value) => createAllowlistRow(value))
      : [createAllowlistRow()],
  )

  const entryValues = entries.map((entry) => entry.value)
  const canSubmit = canSubmitIpPolicy(name, entryValues)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        backdropProps={{ forceRender: true }}
        className="flex max-h-[80dvh] w-120 flex-col gap-6 overflow-hidden"
      >
        <div className="flex shrink-0 items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {mode === 'edit'
                ? t(($) => $['settings.ipPolicyEditTitle'], { ns: 'common' })
                : t(($) => $['settings.ipPolicyNewTitle'], { ns: 'common' })}
            </DialogTitle>
            <DialogDescription className="system-sm-regular text-text-tertiary">
              {t(($) => $['settings.ipPolicyDialogDescription'], { ns: 'common' })}
            </DialogDescription>
            {mode === 'edit' && usedByCount > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="system-xs-regular text-text-warning">
                  {t(($) => $['settings.ipPolicyEditUsedBy'], {
                    ns: 'common',
                    count: usedByCount,
                  })}
                </p>
                <PolicyReferencedApps apps={referencedApps} usedByCount={usedByCount} />
              </div>
            )}
          </div>
          <DialogClose
            render={
              <IconButton
                type="button"
                size="lg"
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canSubmit) return
            onSubmit?.({
              name: name.trim(),
              allowed_cidrs: collectAllowedCidrs(entryValues),
            })
          }}
        >
          <Field className="flex shrink-0 flex-col gap-3">
            <FieldLabel>{t(($) => $['settings.ipPolicyName'], { ns: 'common' })}</FieldLabel>
            <Input
              value={name}
              maxLength={IP_POLICY_NAME_MAX_LENGTH}
              placeholder={t(($) => $['settings.ipPolicyNamePlaceholder'], { ns: 'common' })}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </Field>

          <AllowlistField entries={entries} currentIp={currentIp} onEntriesChange={setEntries} />

          <div className="flex shrink-0 items-center justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!canSubmit || isPending}
              loading={isPending}
            >
              {mode === 'edit'
                ? t(($) => $['operation.save'], { ns: 'common' })
                : t(($) => $['settings.ipPolicyCreate'], { ns: 'common' })}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
