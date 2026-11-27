'use client'

import { useTranslation } from 'react-i18next'
import { CollaboratorAvatar } from '@/app/components/workflow/collaboration/components/collaborator-avatar'
import { CollaboratorPill } from '@/app/components/workflow/collaboration/components/collaborator-pill'
import { demoUsers } from '../demo-users'

const members = [demoUsers.alex, demoUsers.sam]

type DemoMembersProps = {
  listed: boolean
  pillRef: (element: HTMLElement | null) => void
}

export function DemoMembers({ listed, pillRef }: DemoMembersProps) {
  const { t, i18n } = useTranslation(['collaborationDemo'])

  return (
    <div className="relative">
      <CollaboratorPill
        ref={pillRef}
        role="img"
        aria-label={t(($) => $['members.label'], {
          names: new Intl.ListFormat(i18n.language).format(members.map(({ name }) => name)),
        })}
      >
        {members.map((member) => (
          <CollaboratorAvatar key={member.id} collaborator={member} />
        ))}
      </CollaboratorPill>
      {listed && (
        <ul
          data-collaboration-demo-members
          className="absolute inset-e-0 top-full mt-1 flex w-60 flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[10px]"
        >
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-2 rounded-lg py-1 ps-2 pe-3">
              <CollaboratorAvatar size="sm" collaborator={member} />
              <span className="system-sm-regular text-text-primary">{member.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
