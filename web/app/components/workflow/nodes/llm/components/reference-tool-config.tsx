'use client'
import type { FC } from 'react'
import { RiArrowDownSLine } from '@remixicon/react'
import * as React from 'react'
import { DefaultToolIcon } from '@/app/components/base/icons/src/public/other'
import Switch from '@/app/components/base/switch'
import { cn } from '@/utils/classnames'

type ToolPermissionAction = {
  id: string
  label: string
  defaultEnabled: boolean
}

type ToolPermissionProvider = {
  id: string
  label: string
  actions?: ToolPermissionAction[]
}

type ReferenceToolConfigProps = {
  readonly: boolean
  enabled: boolean
}

const ReferenceToolConfig: FC<ReferenceToolConfigProps> = ({
  readonly,
  enabled,
}) => {
  const isDisabled = readonly || !enabled
  const providers: ToolPermissionProvider[] = [
    {
      id: 'duckduckgo',
      label: 'DuckDuckGo',
      actions: [
        {
          id: 'duckduckgo-ai-chat',
          label: 'DuckDuckGo AI Chat',
          defaultEnabled: true,
        },
        {
          id: 'duckduckgo-image-search',
          label: 'DuckDuckGo Image Search',
          defaultEnabled: true,
        },
        {
          id: 'duckduckgo-search',
          label: 'DuckDuckGo Search',
          defaultEnabled: true,
        },
        {
          id: 'duckduckgo-translate',
          label: 'DuckDuckGo Translate',
          defaultEnabled: false,
        },
      ],
    },
    {
      id: 'web-search',
      label: 'Web Search',
    },
    {
      id: 'stability',
      label: 'Stability',
    },
  ]

  return (
    <div className={cn('flex flex-col gap-2', isDisabled && 'opacity-50')}>
      {providers.map(provider => (
        <div
          key={provider.id}
          className="flex flex-col gap-1 rounded-lg border border-components-panel-border-subtle bg-components-panel-bg p-1 shadow-xs"
        >
          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md border border-divider-subtle bg-background-default">
                <DefaultToolIcon className="h-4 w-4 text-text-primary" />
              </div>
              <div className="system-sm-medium truncate text-text-primary">
                {provider.label}
              </div>
              <RiArrowDownSLine className="h-4 w-4 text-text-tertiary" />
            </div>
          </div>
          {provider.actions?.map(action => (
            <div
              key={action.id}
              className="relative flex items-center gap-2 rounded-md px-2 py-1"
            >
              <div className="absolute left-3 top-0 h-full w-px bg-divider-subtle" />
              <div className="flex min-w-0 flex-1 items-center pl-5">
                <span className="system-sm-regular truncate text-text-secondary">
                  {action.label}
                </span>
              </div>
              <Switch
                size="md"
                disabled={isDisabled}
                defaultValue={action.defaultEnabled}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default React.memo(ReferenceToolConfig)
