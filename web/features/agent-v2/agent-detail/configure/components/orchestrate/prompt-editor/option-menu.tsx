'use client'

import type { InsertOption } from './options'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from '#i18n'

type AgentPromptOptionMenuProps = {
  label: string
  icon: string
  options: InsertOption[]
  onInsert: (token: string) => void
}

export function AgentPromptOptionMenu({
  label,
  icon,
  options,
  onInsert,
}: AgentPromptOptionMenuProps) {
  const { t } = useTranslation('agentV2')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <button
            type="button"
            className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className={`${icon} size-3.5`} />
            <span className="system-xs-medium">{label}</span>
          </button>
        )}
      />
      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="w-60 p-1"
      >
        {options.map(option => (
          <DropdownMenuItem
            key={option.key}
            className="gap-2"
            onClick={() => onInsert(option.token)}
          >
            <span aria-hidden className={`${option.icon} size-4 text-text-tertiary`} />
            <span className="min-w-0 flex-1 truncate">{t(option.labelKey)}</span>
            <span className="code-xs-regular text-text-quaternary">{option.token}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
