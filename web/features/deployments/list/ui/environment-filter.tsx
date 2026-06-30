'use client'

import type { DeploymentsListEnvironmentFilterOption } from '../state'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  deploymentsListEnvironmentFilterOptionsAtom,
  deploymentsListSelectedEnvironmentFilterOptionAtom,
  envFilterQueryState,
} from '../state'

function EnvironmentOptionIcon() {
  return <span className="i-ri-server-line size-[14px]" />
}

function EnvironmentFilterOptionIcon({ option }: {
  option: DeploymentsListEnvironmentFilterOption
}) {
  return option.kind === 'all'
    ? <span className="i-ri-apps-2-line size-[14px]" />
    : <EnvironmentOptionIcon />
}

export function EnvironmentFilter({ className }: {
  className?: string
}) {
  const { t } = useTranslation('deployments')
  const [open, setOpen] = useState(false)
  const [_envFilter, setEnvFilter] = useQueryState('env', envFilterQueryState)
  const filterOptions = useAtomValue(deploymentsListEnvironmentFilterOptionsAtom)
  const selectedOption = useAtomValue(deploymentsListSelectedEnvironmentFilterOptionAtom)
  const activeFilter = selectedOption.value

  function optionText(option: DeploymentsListEnvironmentFilterOption) {
    return option.kind === 'all' ? t('filter.allEnvs') : option.displayName ?? option.value ?? ''
  }

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          'flex h-8 max-w-full cursor-pointer items-center gap-1 rounded-lg border border-transparent bg-components-input-bg-normal px-2 text-left select-none',
          open && 'shadow-xs',
          className,
        )}
      >
        <div className="p-px text-text-tertiary">
          <EnvironmentFilterOptionIcon option={selectedOption} />
        </div>
        <div className="max-w-40 min-w-0 truncate system-sm-regular text-text-secondary">
          {optionText(selectedOption)}
        </div>
        <div className="shrink-0 p-px">
          <span className={cn('i-ri-arrow-down-s-line size-3.5 text-text-tertiary transition-transform', open && 'rotate-180')} />
        </div>
      </DropdownMenuTrigger>
      {open && (
        <DropdownMenuContent
          placement="bottom-start"
          sideOffset={4}
          popupClassName="w-60 rounded-lg border border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-xs"
        >
          <div className="max-h-72 overflow-auto p-1">
            {filterOptions.map(option => (
              <DropdownMenuItem
                key={option.value ?? 'all'}
                onClick={() => {
                  void setEnvFilter(option.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex items-center gap-2 rounded-lg py-1.5 pr-2 pl-3 select-none',
                  'cursor-pointer hover:bg-state-base-hover',
                )}
              >
                <span className="shrink-0 text-text-tertiary">
                  <EnvironmentFilterOptionIcon option={option} />
                </span>
                <span className="grow truncate text-sm/5 text-text-tertiary">{optionText(option)}</span>
                {option.value === activeFilter && (
                  <span className="i-custom-vender-line-general-check size-4 shrink-0 text-text-secondary" />
                )}
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}
