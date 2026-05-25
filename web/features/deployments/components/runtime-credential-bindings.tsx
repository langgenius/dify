'use client'

import type {
  CredentialSlot,
} from '@dify/contracts/enterprise/types.gen'
import type {
  RuntimeCredentialBindingSelections,
  RuntimeCredentialSelectOption,
} from './runtime-credential-bindings-utils'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialCandidateOptions,
  runtimeCredentialSlotKey,
} from './runtime-credential-bindings-utils'

type RuntimeCredentialBindingsPanelProps = {
  slots: CredentialSlot[]
  selections: RuntimeCredentialBindingSelections
  title: string
  hint: string
  requiredLabel: string
  noBindingRequiredLabel: string
  noCredentialCandidatesLabel: string
  selectCredentialLabel: string
  missingRequiredLabel: string
  onChange: (slotKey: string, value: string) => void
  className?: string
  listClassName?: string
}

function RuntimeCredentialSelect({
  ariaLabel,
  value,
  options,
  placeholder,
  onChange,
}: {
  ariaLabel: string
  value: string
  options: RuntimeCredentialSelectOption[]
  placeholder: string
  onChange: (value: string) => void
}) {
  const selectedOption = options.find(option => option.value === value)

  return (
    <Select
      value={value || null}
      onValueChange={(next) => {
        if (!next)
          return
        onChange(next)
      }}
      disabled={options.length === 0}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          'h-8 min-w-0 border border-components-input-border-active px-2 text-left system-sm-medium',
          !selectedOption && 'text-text-quaternary',
        )}
      >
        {selectedOption?.label ?? placeholder}
      </SelectTrigger>
      <SelectContent popupClassName="w-(--anchor-width)">
        {options.map(option => (
          <SelectItem key={option.value} value={option.value} title={option.label}>
            <SelectItemText>{option.label}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function RuntimeCredentialBindingsPanel({
  slots,
  selections,
  title,
  hint,
  requiredLabel,
  noBindingRequiredLabel,
  noCredentialCandidatesLabel,
  selectCredentialLabel,
  missingRequiredLabel,
  onChange,
  className,
  listClassName,
}: RuntimeCredentialBindingsPanelProps) {
  const { t } = useTranslation('plugin')

  return (
    <div className={cn('overflow-hidden rounded-xl border border-divider-subtle bg-background-default-subtle', className)}>
      <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="system-xs-medium-uppercase text-text-tertiary">{title}</div>
          {slots.length > 0 && (
            <span className="shrink-0 rounded-md bg-background-default px-1.5 py-0.5 system-2xs-medium text-text-quaternary">
              {slots.length}
            </span>
          )}
        </div>
        <span className="system-xs-regular text-text-quaternary">{hint}</span>
      </div>
      {slots.length === 0
        ? (
            <div className="border-t border-divider-subtle px-3 py-3 system-sm-regular text-text-quaternary">
              {noBindingRequiredLabel}
            </div>
          )
        : (
            <div className={cn('max-h-[min(360px,34dvh)] overflow-y-auto border-t border-divider-subtle', listClassName)}>
              {slots.map((slot) => {
                const slotKey = runtimeCredentialSlotKey(slot)
                const candidates = runtimeCredentialCandidateOptions(slot)
                const selectedValue = selections[slotKey] ?? ''
                const missing = hasMissingRequiredRuntimeCredentialBinding(slot, selectedValue)
                const slotName = slot.providerId || slotKey
                const categoryLabel = slot.category === 'PLUGIN_CATEGORY_MODEL'
                  ? t('categorySingle.model')
                  : slot.category === 'PLUGIN_CATEGORY_TOOL'
                    ? t('categorySingle.tool')
                    : undefined

                return (
                  <div key={slotKey} className="flex flex-col gap-2 border-b border-divider-subtle px-3 py-3 last:border-b-0">
                    <div className="flex min-w-0 flex-col gap-2.5">
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-mono system-xs-semibold text-text-primary" title={slotName}>
                            {slotName}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {categoryLabel && (
                            <span className="shrink-0 rounded-md bg-util-colors-blue-light-blue-light-50 px-1.5 py-0.5 system-2xs-medium-uppercase text-util-colors-blue-blue-600">
                              {categoryLabel}
                            </span>
                          )}
                          <span className="shrink-0 rounded-md bg-background-default px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
                            {requiredLabel}
                          </span>
                        </div>
                      </div>
                      {candidates.length === 0
                        ? (
                            <div className="rounded-lg border border-divider-subtle bg-background-default px-2 py-1.5 system-sm-regular text-text-quaternary">
                              {noCredentialCandidatesLabel}
                            </div>
                          )
                        : (
                            <RuntimeCredentialSelect
                              ariaLabel={slotName}
                              value={selectedValue}
                              onChange={value => onChange(slotKey, value)}
                              options={candidates}
                              placeholder={selectCredentialLabel}
                            />
                          )}
                    </div>
                    {missing && (
                      <div className="system-xs-regular text-text-destructive">
                        {missingRequiredLabel}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
    </div>
  )
}
