'use client'

import type { Environment, EnvironmentStatus } from '@dify/contracts/enterprise/types.gen'
import { EnvironmentStatus as EnvironmentStatusEnum } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { TitleTooltip } from '../../components/title-tooltip'
import { ModeBadge } from './status-badge'

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
  value?: string
  label: string
  disabled?: boolean
  disabledReason?: string
}

type SelectProps = {
  value?: string
  onChange: (value: string) => void
  options: SelectOption[]
  ariaLabel?: string
  placeholder?: string
}

export function DeploymentSelect({ value, onChange, options, ariaLabel, placeholder }: SelectProps) {
  const { t } = useTranslation('deployments')
  const selectedOption = options.find(option => option.value === value)

  return (
    <Select
      value={value ?? null}
      onValueChange={(next) => {
        if (!next)
          return
        onChange(next)
      }}
      disabled={options.length === 0}
    >
      <SelectTrigger
        aria-label={ariaLabel ?? placeholder ?? t('deployDrawer.defaultSelect')}
        className={cn(
          'h-8 min-w-0 px-2 text-left system-sm-medium',
          !selectedOption && 'text-text-quaternary',
        )}
      >
        {selectedOption?.label ?? placeholder ?? t('deployDrawer.defaultSelect')}
      </SelectTrigger>
      <SelectContent popupClassName="w-(--anchor-width)">
        {options.map(opt => opt.value
          ? (
              <SelectItem
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
              >
                <TitleTooltip content={opt.disabled ? opt.disabledReason : undefined}>
                  <SelectItemText>{opt.label}</SelectItemText>
                </TitleTooltip>
                <SelectItemIndicator />
              </SelectItem>
            )
          : null)}
      </SelectContent>
    </Select>
  )
}

function EnvironmentHealthDot({ status }: {
  status: EnvironmentStatus
}) {
  const { t } = useTranslation('deployments')
  const label = t(`health.${status}`)
  const isReady = status === EnvironmentStatusEnum.ENVIRONMENT_STATUS_READY

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <span
            aria-label={label}
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded-full',
              isReady ? 'bg-util-colors-green-green-50' : 'bg-util-colors-warning-warning-50',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'size-1.5 rounded-full',
                isReady ? 'bg-util-colors-green-green-500' : 'bg-util-colors-warning-warning-500',
              )}
            />
          </span>
        )}
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function EnvironmentRow({ env }: { env: Environment }) {
  const { t } = useTranslation('deployments')
  const summary = env.description.trim() || t(`backend.${env.backend}`)

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-components-panel-border bg-components-panel-bg-blur px-3 py-2">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <EnvironmentHealthDot status={env.status} />
          <span className="truncate system-sm-semibold text-text-primary">{env.displayName}</span>
          <ModeBadge mode={env.mode} />
        </div>
        <span className="line-clamp-1 system-xs-regular text-text-tertiary">{summary}</span>
      </div>
    </div>
  )
}
