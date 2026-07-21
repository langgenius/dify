import type { ContactRecipientOption } from './contact-provider'
import type { HumanInputV2NodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import HumanInputNodeBranches from '@/app/components/workflow/nodes/human-input/shared/node-branches'
import { mockContactRecipientOptionProvider } from './contact-provider'
import { deriveRecipientSummary } from './recipient-utils'

export const HumanInputV2Node = (props: NodeProps<HumanInputV2NodeType>) => {
  const { t } = useTranslation()
  const { data } = props
  const [contacts, setContacts] = useState<ContactRecipientOption[]>([])
  const contactIds = useMemo(
    () =>
      data.recipients_spec
        .filter((recipient) => recipient.type === 'contact')
        .map((recipient) => recipient.contact_id),
    [data.recipients_spec],
  )

  useEffect(() => {
    if (!contactIds.length) return

    let active = true
    void mockContactRecipientOptionProvider.resolve(contactIds).then((options) => {
      if (active) {
        setContacts((current) =>
          current.length === options.length &&
          current.every((contact, index) => contact.id === options[index]?.id)
            ? current
            : options,
        )
      }
    })
    return () => {
      active = false
    }
  }, [contactIds])

  const summary = deriveRecipientSummary(
    data.recipients_spec,
    new Map(contacts.map((contact) => [contact.id, contact.name])),
  )

  const summaryLabel = (() => {
    if (summary.state === 'empty')
      return t(($) => $['nodes.humanInputV2.card.empty'], { ns: 'workflow' })
    if (summary.state === 'invalid')
      return t(($) => $['nodes.humanInputV2.card.invalid'], { ns: 'workflow' })
    if (
      summary.hasInitiator &&
      !summary.contactCount &&
      !summary.dynamicEmailCount &&
      !summary.onetimeEmailCount
    )
      return t(($) => $['nodes.humanInputV2.card.initiatorOnly'], { ns: 'workflow' })
    if (
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
      <div className="space-y-0.5 py-1">
        {summary.state !== 'empty' && (
          <div className="px-2.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
            {t(($) => $['nodes.humanInputV2.recipients.title'], { ns: 'workflow' })}
          </div>
        )}
        <div className="px-2.5">
          <div
            className={cn(
              'flex min-h-8 items-center gap-1.5 rounded-lg px-2 py-1 system-xs-regular',
              summary.state === 'empty' && 'bg-state-warning-hover text-text-warning-secondary',
              summary.state === 'invalid' &&
                'bg-state-destructive-hover text-text-destructive-secondary',
              (summary.state === 'configured' || summary.state === 'overflow') &&
                'bg-workflow-block-parma-bg text-text-secondary',
            )}
          >
            {summary.state === 'empty' || summary.state === 'invalid' ? (
              <span className="i-ri-alert-line size-4 shrink-0" aria-hidden />
            ) : summary.hasInitiator && data.recipients_spec.length === 1 ? (
              <span className="i-ri-user-line size-4 shrink-0" aria-hidden />
            ) : (
              <span className="i-ri-group-line size-4 shrink-0" aria-hidden />
            )}
            <span className="truncate">{summaryLabel}</span>
          </div>
        </div>
      </div>
      <HumanInputNodeBranches {...props} />
    </>
  )
}

export default React.memo(HumanInputV2Node)
