'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLearnDifyHiddenValue, useSetLearnDifyHidden } from '@/app/components/explore/learn-dify/storage'
import AccountAbout from '@/app/components/header/account-about'
import Compliance from '@/app/components/header/account-dropdown/compliance'
import { ExternalLinkIndicator, MenuItemContent } from '@/app/components/header/account-dropdown/menu-item-content'
import GithubStar from '@/app/components/header/github-star'
import { IS_CLOUD_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { env } from '@/env'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import SupportMenu from './support-menu'

type HelpMenuProps = {
  triggerIcon?: ReactNode
  triggerClassName?: string
}

const defaultTriggerIcon = (
  <svg
    aria-hidden
    className="size-6 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
  >
    <path d="M11.9666 16.9985V17.011" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M11.9665 13.2485C11.9665 11.1995 14.4665 11.9134 14.4665 9.49854C14.4665 8.11782 13.3473 6.99854 11.9665 6.99854C11.0412 6.99854 10.2333 7.50129 9.80103 8.24854" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const HelpMenu = ({
  triggerIcon = defaultTriggerIcon,
  triggerClassName,
}: HelpMenuProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { langGeniusVersionInfo, isCurrentWorkspaceOwner } = useAppContext()
  const learnDifyHidden = useLearnDifyHiddenValue()
  const setLearnDifyHidden = useSetLearnDifyHidden()
  const [aboutVisible, setAboutVisible] = useState(false)
  const [open, setOpen] = useState(false)

  if (systemFeatures.branding.enabled)
    return null

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          aria-label={t('mainNav.help.openMenu', { ns: 'common' })}
          data-learn-dify-help-target
          className={cn(
            'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border border-components-card-border bg-components-card-bg p-0 text-text-tertiary shadow-xs transition-colors hover:bg-components-card-bg-alt hover:text-saas-dify-blue-inverted focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
            triggerClassName,
            open && 'bg-components-card-bg-alt text-saas-dify-blue-inverted',
          )}
        >
          {triggerIcon}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="top-end"
          sideOffset={8}
          popupClassName="w-60 overflow-hidden bg-components-panel-bg-blur! p-0! backdrop-blur-[5px]"
        >
          <>
            <DropdownMenuGroup className="p-1">
              <DropdownMenuLinkItem href={docLink('/use-dify/getting-started/introduction')} target="_blank" rel="noopener noreferrer" className="mx-0 h-8 gap-1 px-3 py-1">
                <MenuItemContent
                  iconClassName="i-ri-book-open-line"
                  label={t('mainNav.help.docs', { ns: 'common' })}
                  trailing={<ExternalLinkIndicator />}
                />
              </DropdownMenuLinkItem>
              <DropdownMenuLinkItem href="https://roadmap.dify.ai" target="_blank" rel="noopener noreferrer" className="mx-0 h-8 gap-1 px-3 py-1">
                <MenuItemContent
                  iconClassName="i-ri-map-2-line"
                  label={t('userProfile.roadmap', { ns: 'common' })}
                  trailing={<ExternalLinkIndicator />}
                />
              </DropdownMenuLinkItem>
              <DropdownMenuCheckboxItem
                checked={!learnDifyHidden}
                closeOnClick={false}
                className="mx-0 h-8 gap-1 px-0 py-1 pr-2 pl-3"
                onCheckedChange={checked => setLearnDifyHidden(!checked)}
              >
                <span aria-hidden className="i-custom-vender-workflow-docs-extractor size-4 shrink-0 text-text-tertiary" />
                <span className="min-w-0 flex-1 truncate px-1 py-0.5 system-md-regular text-text-secondary">
                  {t('mainNav.help.learnDify', { ns: 'common' })}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'relative inline-flex h-4 w-7 shrink-0 items-center rounded-[5px] p-0.5 transition-colors',
                    !learnDifyHidden ? 'bg-components-toggle-bg' : 'bg-components-toggle-bg-unchecked',
                  )}
                >
                  <span
                    className={cn(
                      'block h-3 w-2.5 rounded-[3px] bg-components-toggle-knob shadow-sm transition-transform',
                      !learnDifyHidden && 'translate-x-3.5',
                    )}
                  />
                </span>
              </DropdownMenuCheckboxItem>
              {IS_CLOUD_EDITION && isCurrentWorkspaceOwner && <Compliance />}
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="my-0!" />
            <DropdownMenuGroup className="p-1">
              <SupportMenu />
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="my-0!" />
            <DropdownMenuGroup className="p-1">
              <DropdownMenuLinkItem href="https://github.com/langgenius/dify" target="_blank" rel="noopener noreferrer" className="mx-0 h-8 gap-1 px-3 py-1.5">
                <MenuItemContent
                  iconClassName="i-ri-github-line"
                  label={t('userProfile.github', { ns: 'common' })}
                  trailing={(
                    <div className="flex items-center gap-0.5 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-[5px] py-[3px]">
                      <span aria-hidden className="i-ri-star-line size-3 shrink-0 text-text-tertiary" />
                      <GithubStar className="system-2xs-medium-uppercase text-text-tertiary" />
                    </div>
                  )}
                />
              </DropdownMenuLinkItem>
              {env.NEXT_PUBLIC_SITE_ABOUT !== 'hide' && (
                <DropdownMenuItem
                  className="mx-0 h-8 gap-1 px-3 py-1.5"
                  onClick={() => {
                    setAboutVisible(true)
                    setOpen(false)
                  }}
                >
                  <MenuItemContent
                    iconClassName="i-ri-information-2-line"
                    label={t('userProfile.about', { ns: 'common' })}
                    trailing={(
                      <div className="flex shrink-0 items-center">
                        <div className="system-xs-regular text-text-tertiary">{t('about.version', { ns: 'common', version: langGeniusVersionInfo.current_version })}</div>
                      </div>
                    )}
                  />
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </>
        </DropdownMenuContent>
      </DropdownMenu>
      {aboutVisible && <AccountAbout onCancel={() => setAboutVisible(false)} langGeniusVersionInfo={langGeniusVersionInfo} />}
    </>
  )
}

export default HelpMenu
