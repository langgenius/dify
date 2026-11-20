'use client'

import type { Ref } from 'react'
import type { DemoUserId } from '../demo-users'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import { demoUsers } from '../demo-users'
import { DemoAvatar } from './demo-avatar'

const members: DemoUserId[] = ['alex', 'sam']

type DemoMembersProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerRef?: Ref<HTMLButtonElement>
}

export function DemoMembers({ open, onOpenChange, triggerRef }: DemoMembersProps) {
  const { t } = useTranslation(['collaborationDemo'])

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        ref={triggerRef}
        aria-label={t(($) => $['members.trigger'])}
        className={cn(
          'flex h-8 cursor-pointer items-center gap-1 rounded-full border-[0.5px] border-components-panel-border bg-components-panel-bg px-1.5 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[10px] hover:bg-state-base-hover',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid',
        )}
      >
        <span className="flex -space-x-1.5">
          {members.map((user) => (
            <DemoAvatar key={user} user={user} />
          ))}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        data-collaboration-demo-members=""
        className="w-60 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[10px]"
      >
        <div className="px-3 pt-1.5 pb-1 system-xs-medium-uppercase text-text-tertiary">
          {t(($) => $['members.label'])}
        </div>
        <ul>
          {members.map((user) => (
            <li key={user} className="flex items-center gap-2 rounded-lg px-3 py-1.5">
              <DemoAvatar user={user} />
              <span className="system-xs-medium text-text-secondary">{demoUsers[user].name}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
