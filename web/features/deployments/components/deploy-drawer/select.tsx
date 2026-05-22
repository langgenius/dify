'use client'

import type { Environment } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'
import { environmentHealth, environmentMode, environmentName } from '../../environment'
import { HealthBadge, ModeBadge } from '../status-badge'

type EnvironmentOption = Environment & {
  disabled?: boolean
}

export function Field({ label, hint, children }: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="system-xs-medium-uppercase text-text-tertiary">{label}</div>
        {hint && <span className="system-xs-regular text-text-quaternary">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

type SelectOption = {
  value: string
  label: string
  disabled?: boolean
  disabledReason?: string
}

type SelectProps = {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
}

export function DeploymentSelect({ value, onChange, options, placeholder }: SelectProps) {
  const { t } = useTranslation('deployments')
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
        className={cn(
          'h-8 min-w-0 border border-components-input-border-active px-2 text-left system-sm-medium',
          !selectedOption && 'text-text-quaternary',
        )}
      >
        {selectedOption?.label ?? placeholder ?? t('deployDrawer.defaultSelect')}
      </SelectTrigger>
      <SelectContent popupClassName="w-(--anchor-width)">
        {options.map(opt => (
          <SelectItem
            key={opt.value}
            value={opt.value}
            disabled={opt.disabled}
            title={opt.disabled ? opt.disabledReason : undefined}
          >
            <SelectItemText>{opt.label}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function EnvironmentRow({ env }: { env: EnvironmentOption }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-components-panel-border bg-components-panel-bg-blur px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="system-sm-semibold text-text-primary">{environmentName(env)}</span>
        <ModeBadge mode={environmentMode(env)} />
        <HealthBadge health={environmentHealth(env)} />
      </div>
      <span className="system-xs-regular text-text-tertiary uppercase">{environmentMode(env)}</span>
    </div>
  )
}
