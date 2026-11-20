'use client'

import type { DemoUserId } from '../demo-users'
import { useTranslation } from 'react-i18next'
import { demoUsers } from '../demo-users'
import { DemoAvatar } from './demo-avatar'

const members: DemoUserId[] = ['alex', 'sam']

type DemoMembersProps = {
  listed: boolean
  pillRef: (element: HTMLElement | null) => void
}

export function DemoMembers({ listed, pillRef }: DemoMembersProps) {
  const { t } = useTranslation(['collaborationDemo'])

  return (
    <div className="relative">
      <div
        ref={pillRef}
        role="img"
        aria-label={t(($) => $['members.label'], {
          names: members.map((user) => demoUsers[user].name).join(', '),
        })}
        className="flex h-8 items-center gap-1 rounded-full border-[0.5px] border-components-panel-border bg-components-panel-bg px-1.5 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[10px]"
      >
        <span className="flex items-center">
          {members.map((user, index) => (
            <DemoAvatar
              key={user}
              user={user}
              className="relative data-stacked:-ms-1.5"
              stacked={index > 0}
              style={{ zIndex: members.length - index }}
            />
          ))}
        </span>
        <span aria-hidden className="i-ri-arrow-down-s-line size-3 text-text-tertiary" />
      </div>
      {listed && (
        <ul
          data-collaboration-demo-members
          className="absolute inset-e-0 top-full mt-1.5 flex w-60 flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[10px]"
        >
          {members.map((user) => (
            <li key={user} className="flex items-center gap-2 rounded-lg py-1 ps-2 pe-3">
              <DemoAvatar user={user} />
              <span className="system-sm-regular text-text-primary">{demoUsers[user].name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
