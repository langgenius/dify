import type { HumanInputV2NodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import HumanInputNodeBranches from '@/app/components/workflow/nodes/human-input/shared/node-branches'
import { ENABLE_HITL_IM } from '@/config'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import { getContactRecipientQueryOptions } from './contact-queries'
import { HumanInputV2Disabled } from './disabled'
import { deriveRecipientSummary } from './recipient-utils'

const HumanInputV2NodeContent = (props: NodeProps<HumanInputV2NodeType>) => {
  const { t } = useTranslation(['workflow'])
  const { data } = props
  const workspaceId = useAtomValue(currentWorkspaceIdAtom)
  const contactIds = useMemo(
    () => [
      ...new Set(
        data.recipients_spec
          .filter((recipient) => recipient.type === 'contact')
          .map((recipient) => recipient.contact_id),
      ),
    ],
    [data.recipients_spec],
  )

  const contacts = useQuery(getContactRecipientQueryOptions(workspaceId, contactIds))
  const summary = deriveRecipientSummary(
    data.recipients_spec,
    contacts.isSuccess
      ? new Map(contacts.data.data.map((contact) => [contact.id, contact.name]))
      : undefined,
  )

  const summaryLabel = (() => {
    if (summary.state === 'empty')
      return t(($) => $['nodes.humanInputV2.card.empty'], { ns: 'workflow' })
    if (summary.state === 'invalid')
      return t(($) => $['nodes.humanInputV2.card.invalid'], { ns: 'workflow' })
    if (summary.hasAllWorkspaceContacts && data.recipients_spec.length === 1)
      return t(($) => $['nodes.humanInputV2.recipients.allWorkspaceContacts'], { ns: 'workflow' })
    if (
      !summary.hasAllWorkspaceContacts &&
      summary.hasInitiator &&
      !summary.contactCount &&
      !summary.dynamicEmailCount &&
      !summary.onetimeEmailCount
    )
      return t(($) => $['nodes.humanInputV2.card.initiatorOnly'], { ns: 'workflow' })
    if (
      !summary.hasAllWorkspaceContacts &&
      summary.contactCount &&
      !summary.hasInitiator &&
      !summary.dynamicEmailCount &&
      !summary.onetimeEmailCount
    )
      return t(($) => $['nodes.humanInputV2.card.contactsOnly'], {
        ns: 'workflow',
        count: summary.contactCount,
      })
    if (
      !summary.hasAllWorkspaceContacts &&
      summary.contactCount &&
      summary.hasInitiator &&
      !summary.dynamicEmailCount &&
      !summary.onetimeEmailCount
    )
      return t(($) => $['nodes.humanInputV2.card.initiatorAndContacts'], {
        ns: 'workflow',
        count: summary.contactCount,
      })
    return t(($) => $['nodes.humanInputV2.card.configured'], {
      ns: 'workflow',
      count: data.recipients_spec.length,
      overflow: summary.overflowCount,
    })
  })()

  return (
    <>
      <div className="space-y-0.5 py-1" aria-busy={contactIds.length > 0 && contacts.isPending}>
        {summary.state !== 'empty' && (
          <div className="px-2.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
            {t(($) => $['nodes.humanInputV2.recipients.title'], { ns: 'workflow' })}
          </div>
        )}
        <div className="px-2.5">
          <div
            data-state={summary.state}
            className="flex min-h-6 items-center gap-1 rounded-md px-1.5 py-1 system-xs-regular data-[state=configured]:bg-workflow-block-parma-bg data-[state=configured]:text-text-secondary data-[state=empty]:bg-state-warning-hover data-[state=empty]:px-2 data-[state=empty]:text-text-warning data-[state=empty]:ring-[0.5px] data-[state=empty]:ring-state-warning-active data-[state=invalid]:bg-state-destructive-hover data-[state=invalid]:text-text-destructive-secondary data-[state=overflow]:bg-workflow-block-parma-bg data-[state=overflow]:text-text-secondary"
          >
            {summary.state === 'invalid' && (
              <span className="i-ri-alert-line size-4 shrink-0" aria-hidden />
            )}
            <span className="truncate">{summaryLabel}</span>
          </div>
        </div>
      </div>
      <HumanInputNodeBranches {...props} />
    </>
  )
}

export const HumanInputV2Node = (props: NodeProps<HumanInputV2NodeType>) => {
  if (!ENABLE_HITL_IM) {
    return (
      <>
        <HumanInputV2Disabled className="mx-2.5 my-1" />
        <HumanInputNodeBranches {...props} />
      </>
    )
  }

  return <HumanInputV2NodeContent {...props} />
}
