'use client'

import type { AllowlistRow } from './allowlist-row'
import type { IpEntryErrorCode } from './validate-ip-entry'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { useTranslation } from 'react-i18next'
import { createAllowlistRow } from './allowlist-row'
import { IP_POLICY_CIDR_MAX_COUNT, isSameIpAddress, validateIpEntry } from './validate-ip-entry'

type AllowlistFieldProps = {
  entries: AllowlistRow[]
  currentIp?: string
  currentIpStatus?: 'loading' | 'error'
  onRetryCurrentIp?: () => void
  onEntriesChange: (entries: AllowlistRow[]) => void
}

export function AllowlistField({
  entries,
  currentIp,
  currentIpStatus,
  onRetryCurrentIp,
  onEntriesChange,
}: AllowlistFieldProps) {
  const { t } = useTranslation()

  const errorMessage = (code: IpEntryErrorCode, max?: 32 | 128) => {
    switch (code) {
      case 'multipleSlashes':
        return t(($) => $['settings.ipPolicyEntryMultipleSlashes'], { ns: 'common' })
      case 'leadingZeros':
        return t(($) => $['settings.ipPolicyEntryLeadingZeros'], { ns: 'common' })
      case 'octetRange':
        return t(($) => $['settings.ipPolicyEntryOctetRange'], { ns: 'common' })
      case 'prefixNotNumber':
        return t(($) => $['settings.ipPolicyEntryPrefixNotNumber'], { ns: 'common' })
      case 'prefixRange':
        return t(($) => $['settings.ipPolicyEntryPrefixRange'], { ns: 'common', max })
      case 'invalidIpv6':
        return t(($) => $['settings.ipPolicyEntryInvalidIpv6'], { ns: 'common' })
      default:
        return t(($) => $['settings.ipPolicyEntryUnsupported'], { ns: 'common' })
    }
  }

  const updateEntry = (id: string, value: string) => {
    onEntriesChange(entries.map((entry) => (entry.id === id ? { ...entry, value } : entry)))
  }

  const removeEntry = (id: string) => {
    if (entries.length === 1) {
      const row = entries[0]
      if (!row) return
      onEntriesChange([{ ...row, value: '' }])
      return
    }
    onEntriesChange(entries.filter((entry) => entry.id !== id))
  }

  const addCurrentIp = () => {
    if (!currentIp) return
    if (entries.some((entry) => isSameIpAddress(entry.value, currentIp))) return
    const emptyRow = entries.find((entry) => entry.value.trim() === '')
    if (emptyRow) {
      updateEntry(emptyRow.id, currentIp)
      return
    }
    if (entries.length < IP_POLICY_CIDR_MAX_COUNT)
      onEntriesChange([...entries, createAllowlistRow(currentIp)])
  }

  return (
    <Field className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-1">
        <FieldLabel>{t(($) => $['settings.ipPolicyAllowlist'], { ns: 'common' })}</FieldLabel>
        <FieldDescription>
          {t(($) => $['settings.ipPolicyAllowlistHelp'], { ns: 'common' })}
        </FieldDescription>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {entries.map((entry) => {
          const result = validateIpEntry(entry.value)
          const invalid = result.kind === 'invalid'

          return (
            <Field key={entry.id} invalid={invalid} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Input
                    value={entry.value}
                    placeholder="10.0.0.0/8"
                    aria-label={t(($) => $['settings.ipPolicyAllowlist'], { ns: 'common' })}
                    className={invalid ? 'pr-8' : undefined}
                    onChange={(event) => updateEntry(entry.id, event.currentTarget.value)}
                  />
                  {invalid && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-e-2.5 top-1/2 i-ri-error-warning-line size-4 -translate-y-1/2 text-text-destructive"
                    />
                  )}
                </div>
                <IconButton
                  type="button"
                  size="lg"
                  aria-label={t(($) => $['settings.ipPolicyRemoveEntry'], { ns: 'common' })}
                  onClick={() => removeEntry(entry.id)}
                >
                  <span aria-hidden className="i-ri-delete-bin-line size-4" />
                </IconButton>
              </div>
              {invalid && (
                <FieldError match className="text-text-destructive-secondary">
                  {errorMessage(result.code, result.max)}
                </FieldError>
              )}
            </Field>
          )
        })}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="small"
        className="shrink-0 self-start"
        disabled={entries.length >= IP_POLICY_CIDR_MAX_COUNT}
        onClick={() => onEntriesChange([...entries, createAllowlistRow()])}
      >
        <span aria-hidden className="i-ri-add-line size-4" />
        {t(($) => $['settings.ipPolicyAddEntry'], { ns: 'common' })}
      </Button>

      {currentIpStatus && (
        <p role="status" className="system-xs-regular text-text-tertiary">
          {currentIpStatus === 'loading'
            ? t(($) => $['settings.ipPolicyCurrentIpLoading'], { ns: 'common' })
            : t(($) => $['settings.ipPolicyCurrentIpError'], { ns: 'common' })}
          {currentIpStatus === 'error' && onRetryCurrentIp && (
            <Button type="button" variant="ghost" size="small" onClick={onRetryCurrentIp}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          )}
        </p>
      )}

      {currentIp && (
        <p className="flex shrink-0 flex-wrap items-center gap-1.5 system-xs-regular text-text-tertiary">
          <span>{t(($) => $['settings.ipPolicyCurrentIp'], { ns: 'common', ip: currentIp })}</span>
          <Button
            type="button"
            variant="ghost-accent"
            size="small"
            disabled={
              entries.some((entry) => isSameIpAddress(entry.value, currentIp)) ||
              (entries.length >= IP_POLICY_CIDR_MAX_COUNT &&
                entries.every((entry) => entry.value.trim() !== ''))
            }
            onClick={addCurrentIp}
          >
            {t(($) => $['settings.ipPolicyAddCurrentIp'], { ns: 'common' })}
          </Button>
        </p>
      )}
    </Field>
  )
}
