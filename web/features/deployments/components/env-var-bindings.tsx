'use client'

import type { EnvVarSlot } from '@dify/contracts/enterprise/types.gen'
import type { EnvVarValues } from './env-var-bindings-utils'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import {
  envVarSlotKey,
  hasMissingRequiredEnvVarValue,
} from './env-var-bindings-utils'

type EnvVarBindingsPanelProps = {
  slots: EnvVarSlot[]
  values: EnvVarValues
  title: string
  hint: string
  requiredLabel: string
  envVarPlaceholder: string
  envVarCountLabel?: string
  missingRequiredLabel?: string
  showMissingRequired?: boolean
  onChange: (key: string, value: string) => void
  className?: string
  listClassName?: string
}

function envVarInputId(index: number, key: string) {
  const safeKey = key.replace(/[^\w-]/g, '-')

  return `env-var-binding-${index}-${safeKey}`
}

export function EnvVarBindingsPanel({
  slots,
  values,
  title,
  hint,
  requiredLabel,
  envVarPlaceholder,
  envVarCountLabel,
  missingRequiredLabel,
  showMissingRequired = false,
  onChange,
  className,
  listClassName,
}: EnvVarBindingsPanelProps) {
  if (slots.length === 0)
    return null

  return (
    <div className={cn('overflow-hidden rounded-xl border border-divider-subtle bg-background-default-subtle', className)}>
      <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="system-xs-medium-uppercase text-text-tertiary">{title}</div>
          <span className="shrink-0 rounded-md bg-background-default px-1.5 py-0.5 system-2xs-medium text-text-quaternary">
            {envVarCountLabel ?? slots.length}
          </span>
        </div>
        <span className="system-xs-regular text-text-quaternary">{hint}</span>
      </div>
      <div className={cn('max-h-[min(360px,34dvh)] overflow-y-auto border-t border-divider-subtle', listClassName)}>
        {slots.map((slot, index) => {
          const key = envVarSlotKey(slot)
          const inputId = envVarInputId(index, key)
          const missing = showMissingRequired && hasMissingRequiredEnvVarValue(slot, values)

          return (
            <div key={key} className="flex min-w-0 flex-col gap-2 border-b border-divider-subtle px-3 py-3 last:border-b-0">
              <div className="flex min-w-0 flex-col gap-2.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <label className="truncate font-mono system-sm-semibold text-text-primary" htmlFor={inputId} title={key}>
                    {key}
                  </label>
                  <span className="shrink-0 rounded-md bg-background-default px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
                    {requiredLabel}
                  </span>
                </div>
                <Input
                  id={inputId}
                  value={values[key] ?? ''}
                  onChange={event => onChange(key, event.target.value)}
                  placeholder={envVarPlaceholder}
                  autoComplete="off"
                  required
                  className="h-8"
                />
              </div>
              {missing && missingRequiredLabel && (
                <div className="system-xs-regular text-text-destructive">
                  {missingRequiredLabel}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
