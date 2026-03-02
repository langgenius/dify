import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/app/components/base/ui/dropdown-menu'
import { toggleZendeskWindow } from '@/app/components/base/zendesk/utils'
import { Plan } from '@/app/components/billing/type'
import * as config from '@/config'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { cn } from '@/utils/classnames'
import { mailToSupport } from '../utils/util'

const submenuTriggerClassName = '!mx-0 !h-8 !rounded-lg !px-3 data-[highlighted]:!bg-state-base-hover'
const submenuItemClassName = '!mx-0 !h-8 !rounded-lg !px-3 data-[highlighted]:!bg-state-base-hover'
const menuLabelClassName = 'grow px-1 text-text-secondary system-md-regular'
const menuLeadingIconClassName = 'size-4 shrink-0 text-text-tertiary'
const menuTrailingIconClassName = 'size-[14px] shrink-0 text-text-tertiary'

type SupportProps = {
  closeAccountDropdown: () => void
}

type SupportMenuItemContentProps = {
  iconClassName: string
  label: ReactNode
  trailing?: ReactNode
}

function SupportMenuItemContent({
  iconClassName,
  label,
  trailing,
}: SupportMenuItemContentProps) {
  return (
    <>
      <span aria-hidden className={cn(menuLeadingIconClassName, iconClassName)} />
      <div className={menuLabelClassName}>{label}</div>
      {trailing}
    </>
  )
}

function SupportExternalLinkIndicator() {
  return <span aria-hidden className={cn('i-ri-arrow-right-up-line', menuTrailingIconClassName)} />
}

export default function Support({ closeAccountDropdown }: SupportProps) {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const { userProfile, langGeniusVersionInfo } = useAppContext()
  const hasDedicatedChannel = plan.type !== Plan.sandbox
  const zendeskWidgetKey = 'ZENDESK_WIDGET_KEY' in config ? config.ZENDESK_WIDGET_KEY : ''
  const hasZendeskWidget = !!zendeskWidgetKey?.trim()

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={cn(submenuTriggerClassName, 'justify-between')}>
        <SupportMenuItemContent
          iconClassName="i-ri-question-line"
          label={t('userProfile.support', { ns: 'common' })}
          trailing={<span aria-hidden className={cn('i-ri-arrow-right-s-line', menuTrailingIconClassName)} />}
        />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        popupClassName="!w-[216px] !max-h-[70vh] !overflow-y-auto !divide-y !divide-divider-subtle !rounded-xl !bg-components-panel-bg-blur !py-0 !shadow-lg !backdrop-blur-sm"
      >
        <DropdownMenuGroup className="p-1">
          {hasDedicatedChannel && hasZendeskWidget && (
            <DropdownMenuItem
              className={cn(submenuItemClassName, 'justify-between')}
              onClick={() => {
                toggleZendeskWindow(true)
                closeAccountDropdown()
              }}
            >
              <SupportMenuItemContent
                iconClassName="i-ri-chat-smile-2-line"
                label={t('userProfile.contactUs', { ns: 'common' })}
              />
            </DropdownMenuItem>
          )}
          {hasDedicatedChannel && !hasZendeskWidget && (
            <DropdownMenuItem
              className={cn(submenuItemClassName, 'justify-between')}
              render={<a href={mailToSupport(userProfile.email, plan.type, langGeniusVersionInfo?.current_version)} rel="noopener noreferrer" target="_blank" />}
            >
              <SupportMenuItemContent
                iconClassName="i-ri-mail-send-line"
                label={t('userProfile.emailSupport', { ns: 'common' })}
                trailing={<SupportExternalLinkIndicator />}
              />
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className={cn(submenuItemClassName, 'justify-between')}
            render={<a href="https://forum.dify.ai/" rel="noopener noreferrer" target="_blank" />}
          >
            <SupportMenuItemContent
              iconClassName="i-ri-discuss-line"
              label={t('userProfile.forum', { ns: 'common' })}
              trailing={<SupportExternalLinkIndicator />}
            />
          </DropdownMenuItem>
          <DropdownMenuItem
            className={cn(submenuItemClassName, 'justify-between')}
            render={<a href="https://discord.gg/5AEfbxcd9k" rel="noopener noreferrer" target="_blank" />}
          >
            <SupportMenuItemContent
              iconClassName="i-ri-discord-line"
              label={t('userProfile.community', { ns: 'common' })}
              trailing={<SupportExternalLinkIndicator />}
            />
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
