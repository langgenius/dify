'use client'

import type { DemoUserId } from '../demo-users'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import { demoUsers } from '../demo-users'
import { DemoAvatar } from './demo-avatar'

const members: DemoUserId[] = ['alex', 'sam']

const pillClassName =
  'flex h-8 items-center gap-1 rounded-full border-[0.5px] border-components-panel-border bg-components-panel-bg px-1.5 py-1 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[10px]'
const listClassName =
  'flex max-h-50 w-60 flex-col overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[10px]'

function PillContent() {
  return (
    <>
      <span aria-hidden className="flex h-6 items-center">
        {members.map((user, index) => (
          <span
            key={user}
            data-stacked={index > 0 || undefined}
            className="relative flex size-6 items-center justify-center data-stacked:-ms-1.5"
            style={{ zIndex: members.length - index }}
          >
            <DemoAvatar user={user} />
          </span>
        ))}
      </span>
      <span aria-hidden className="i-ri-arrow-down-s-line size-3 text-text-tertiary" />
    </>
  )
}

function MemberList() {
  return (
    <ul className="flex flex-col">
      {members.map((user) => (
        <li key={user} className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5">
          <DemoAvatar user={user} />
          <span className="system-xs-medium text-text-secondary">{demoUsers[user].name}</span>
        </li>
      ))}
    </ul>
  )
}

type DemoMembersProps = {
  guide?: 'listed' | 'collapsed'
  pillRef?: (element: HTMLElement | null) => void
}

export function DemoMembers({ guide, pillRef }: DemoMembersProps) {
  const { t } = useTranslation(['collaborationDemo'])

  if (guide)
    return (
      <div className="relative">
        <div ref={pillRef} className={pillClassName}>
          <PillContent />
        </div>
        {guide === 'listed' && (
          <div
            data-collaboration-demo-members
            className={cn('absolute inset-e-0 top-full mt-2.5', listClassName)}
          >
            <MemberList />
          </div>
        )}
      </div>
    )

  return (
    <Popover>
      <PopoverTrigger
        ref={pillRef}
        aria-label={t(($) => $['members.trigger'], { count: members.length })}
        className={cn(
          pillClassName,
          'cursor-pointer hover:bg-state-base-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid',
        )}
      >
        <PillContent />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={10}
        initialFocus={false}
        className={listClassName}
      >
        <MemberList />
      </PopoverContent>
    </Popover>
  )
}
