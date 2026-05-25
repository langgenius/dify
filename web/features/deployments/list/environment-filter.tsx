'use client'

import type { Environment } from '@dify/contracts/enterprise/types.gen'
import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useQuery } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { environmentId, environmentName } from '../environment'
import {
  ALL_ENVIRONMENTS_FILTER_VALUE,
  envFilterQueryState,
  environmentIdFromFilterValue,
  NOT_DEPLOYED_FILTER_VALUE,
} from './query-state'

type EnvironmentFilterOption = {
  value: string
  text: string
  icon: ReactNode
}

function hasEnvironmentId(environment?: Environment): environment is Environment & { id: string } {
  return Boolean(environment?.id)
}

function EnvironmentOptionIcon() {
  return <span className="i-ri-server-line size-[14px]" />
}

export function EnvironmentFilter() {
  const { t } = useTranslation('deployments')
  const [open, setOpen] = useState(false)
  const [envFilter, setEnvFilter] = useQueryState('env', envFilterQueryState)
  const environmentsQuery = useQuery(consoleQuery.enterprise.environmentService.listDeployableEnvironments.queryOptions({
    input: {
      query: {},
    },
  }))
  const environmentOptions: EnvironmentFilterOption[] = environmentsQuery.data?.data
    ?.filter(hasEnvironmentId)
    .map(environment => ({
      value: environmentId(environment),
      text: environmentName(environment),
      icon: <EnvironmentOptionIcon />,
    })) ?? []
  const filterOptions: EnvironmentFilterOption[] = [
    {
      value: ALL_ENVIRONMENTS_FILTER_VALUE,
      text: t('filter.allEnvs'),
      icon: <span className="i-ri-apps-2-line size-[14px]" />,
    },
    ...environmentOptions,
    {
      value: NOT_DEPLOYED_FILTER_VALUE,
      text: t('filter.notDeployed'),
      icon: <span className="i-ri-inbox-line size-[14px]" />,
    },
  ]
  const selectedEnvironmentId = environmentIdFromFilterValue(envFilter)
  const selectedOption = filterOptions.find(option => option.value === envFilter)
    ?? (selectedEnvironmentId
      ? {
          value: selectedEnvironmentId,
          text: selectedEnvironmentId,
          icon: <EnvironmentOptionIcon />,
        }
      : filterOptions[0])
  const activeFilter = selectedOption?.value ?? ALL_ENVIRONMENTS_FILTER_VALUE

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          'flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-transparent bg-components-input-bg-normal px-2 text-left select-none',
          open && 'shadow-xs',
        )}
      >
        <div className="p-px text-text-tertiary">
          {selectedOption?.icon}
        </div>
        <div className="max-w-40 min-w-0 truncate system-sm-regular text-text-secondary">
          {selectedOption?.text}
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
                key={option.value}
                onClick={() => {
                  void setEnvFilter(option.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex items-center gap-2 rounded-lg py-1.5 pr-2 pl-3 select-none',
                  'cursor-pointer hover:bg-state-base-hover',
                )}
              >
                <span className="shrink-0 text-text-tertiary">{option.icon}</span>
                <span className="grow truncate text-sm/5 text-text-tertiary">{option.text}</span>
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
