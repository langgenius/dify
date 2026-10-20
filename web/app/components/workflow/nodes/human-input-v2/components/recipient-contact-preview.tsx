import type { ReactElement } from 'react'
import type { ContactRecipientOption } from '../contact-provider'
import { Button } from '@langgenius/dify-ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContactChannelIcon } from '@/features/contacts/management/channel-icon'
import { RecipientAvatar } from './recipient-avatar'

type RecipientContactPreviewProps = {
  contact: ContactRecipientOption
  children: ReactElement
  onEdit?: () => void
  conflictingContact?: ContactRecipientOption
  onReplace?: () => void
}

export function RecipientContactPreview({
  contact,
  children,
  onEdit,
  conflictingContact,
  onReplace,
}: RecipientContactPreviewProps) {
  const { t } = useTranslation(['workflow', 'contacts'])
  const [open, setOpen] = useState(false)
  const sourceLabel = (source: ContactRecipientOption['source']) =>
    source === 'organization'
      ? t(($) => $['type.platform'], { ns: 'contacts' })
      : t(($) => $[`nodes.humanInputV2.recipients.contactSource.${source}`], { ns: 'workflow' })

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (onEdit && details.reason === 'trigger-press') {
          details.cancel()
          setOpen(false)
          onEdit()
          return
        }
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger render={children} openOnHover delay={300} closeDelay={150} />
      <PopoverContent
        placement="left-start"
        sideOffset={4}
        className="flex w-60 flex-col gap-2 bg-components-tooltip-bg p-4 backdrop-blur-[5px]"
      >
        <div
          aria-hidden="true"
          className="size-10 shrink-0 rounded-full border-2 border-components-panel-bg"
        >
          <RecipientAvatar
            identity={contact.id}
            avatar={contact.avatar ?? null}
            name={contact.name}
            size="xl"
            className="size-full inset-ring-[0.5px] inset-ring-divider-regular"
          />
        </div>
        <div className="flex w-full flex-col gap-px">
          <div className="flex items-start gap-1">
            <PopoverTitle className="min-w-0 system-md-medium wrap-anywhere text-text-primary">
              {contact.name}
            </PopoverTitle>
            <span className="mt-0.5 shrink-0 rounded-[5px] bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary inset-ring-1 inset-ring-divider-deep">
              {sourceLabel(contact.source)}
            </span>
          </div>
          {contact.email && (
            <div className="flex items-center gap-0.5">
              <p className="system-xs-regular wrap-anywhere text-text-tertiary">{contact.email}</p>
              {conflictingContact && (
                <span className="i-ri-lock-line size-3 shrink-0 text-text-tertiary" aria-hidden />
              )}
            </div>
          )}
        </div>
        {contact.email && (
          <div className="flex size-5 items-center justify-center rounded-[5px] border border-divider-regular bg-components-panel-on-panel-item-bg">
            <ContactChannelIcon provider="email" className="size-3.5" />
          </div>
        )}
        {conflictingContact && (
          <>
            <div className="my-2 h-px w-full bg-divider-subtle" />
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5 system-xs-regular">
                <p className="system-xs-medium text-text-secondary">
                  {t(($) => $['nodes.humanInputV2.recipients.duplicateSource'], {
                    ns: 'workflow',
                    name: conflictingContact.name,
                    source: sourceLabel(conflictingContact.source),
                  })}
                </p>
                <p className="text-text-tertiary">
                  {t(($) => $['nodes.humanInputV2.recipients.emailAlreadySelected'], {
                    ns: 'workflow',
                  })}
                </p>
              </div>
              {onReplace && (
                <Button
                  size="small"
                  className="self-start"
                  onClick={() => {
                    setOpen(false)
                    onReplace()
                  }}
                >
                  {t(($) => $['nodes.humanInputV2.recipients.useThisInstead'], { ns: 'workflow' })}
                </Button>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
