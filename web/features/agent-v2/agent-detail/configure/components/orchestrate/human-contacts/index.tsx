'use client'

import { Avatar } from '@langgenius/dify-ui/avatar'
import { useAtomValue, useSetAtom } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getAgentHumanContactId } from '@/features/agent-v2/agent-composer/human-contacts'
import {
  agentComposerHumanContactsAtom,
  removeHumanContactAtom,
} from '@/features/agent-v2/agent-composer/store-modules/human-contacts'
import { useMembers } from '@/service/use-common'
import { ConfigureSection } from '../common/section'
import { useAgentOrchestrateReadOnly } from '../read-only-context'

export function AgentHumanContacts() {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()
  const contacts = useAtomValue(agentComposerHumanContactsAtom)
  const removeContact = useSetAtom(removeHumanContactAtom)
  const { data: members } = useMembers()
  const accounts = members?.accounts ?? []
  const memberById = useMemo(
    () => new Map(accounts.map((member) => [member.id, member])),
    [accounts],
  )

  return (
    <ConfigureSection
      label={t(($) => $['agentDetail.configure.humanContacts.label'])}
      labelId="agent-configure-human-contacts-label"
      description={t(($) => $['agentDetail.configure.humanContacts.description'])}
    >
      {contacts.length === 0 ? (
        <div className="rounded-lg border-[0.5px] border-dashed border-divider-subtle px-3 py-2 system-xs-regular text-text-tertiary">
          {t(($) => $['agentDetail.configure.humanContacts.empty'])}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {contacts.map((contact) => {
            const contactId = getAgentHumanContactId(contact)
            const member = memberById.get(contactId)
            const label = contact.name || member?.name || contact.email || contactId
            const email = contact.email || member?.email || ''

            return (
              <div
                key={contactId || email}
                className="flex min-h-9 items-center gap-2 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg px-2 py-1.5"
              >
                <Avatar avatar={member?.avatar_url} size="sm" name={label} />
                <div className="min-w-0 flex-1">
                  <div className="truncate system-sm-medium text-text-secondary">{label}</div>
                  {email && (
                    <div className="truncate system-xs-regular text-text-tertiary">{email}</div>
                  )}
                </div>
                {!readOnly && contactId && (
                  <button
                    type="button"
                    aria-label={t(($) => $['agentDetail.configure.humanContacts.remove'], {
                      name: label,
                    })}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                    onClick={() => removeContact(contactId)}
                  >
                    <span aria-hidden className="i-ri-close-line size-4" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </ConfigureSection>
  )
}
