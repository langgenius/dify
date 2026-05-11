'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Switch } from '@langgenius/dify-ui/switch'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLearnDifyHiddenState } from '@/app/components/explore/learn-dify/storage'
import AccountAbout from '@/app/components/header/account-about'
import Compliance from '@/app/components/header/account-dropdown/compliance'
import { ExternalLinkIndicator, MenuItemContent } from '@/app/components/header/account-dropdown/menu-item-content'
import Support from '@/app/components/header/account-dropdown/support'
import GithubStar from '@/app/components/header/github-star'
import Indicator from '@/app/components/header/indicator'
import { IS_CLOUD_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { env } from '@/env'
import { systemFeaturesQueryOptions } from '@/service/system-features'

const HelpMenu = () => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { langGeniusVersionInfo, isCurrentWorkspaceOwner } = useAppContext()
  const [learnDifyHidden, setLearnDifyHidden] = useLearnDifyHiddenState()
  const [aboutVisible, setAboutVisible] = useState(false)
  const [open, setOpen] = useState(false)

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          aria-label={t('mainNav.help.openMenu', { ns: 'common' })}
          data-learn-dify-help-target
          className={cn(
            'text-components-main-nav-text flex items-center justify-center overflow-hidden rounded-full border border-components-card-border bg-components-card-bg p-0.5 shadow-[0px_0px_0px_1px_var(--color-components-button-button-seam)] transition-colors hover:bg-components-card-bg-alt hover:text-text-accent hover:shadow-[0px_0px_0px_1px_var(--color-components-button-button-seam),0px_1px_2px_0px_var(--color-shadow-shadow-3)]',
            open && 'bg-components-card-bg-alt text-text-accent shadow-[0px_0px_0px_1px_var(--color-components-button-button-seam),0px_1px_2px_0px_var(--color-shadow-shadow-3)]',
          )}
        >
          <span aria-hidden className="i-custom-vender-main-nav-help size-6 shrink-0 rounded-full" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="top-end"
          sideOffset={8}
          popupClassName="w-60 overflow-hidden bg-components-panel-bg-blur! p-0! backdrop-blur-[5px]"
        >
          {!systemFeatures.branding.enabled && (
            <>
              <DropdownMenuGroup className="p-1">
                <DropdownMenuLinkItem href={docLink('/use-dify/getting-started/introduction')} target="_blank" rel="noopener noreferrer" className="mx-0 h-8 gap-1 px-3 py-1">
                  <MenuItemContent
                    iconClassName="i-ri-book-open-line"
                    label={t('mainNav.help.docs', { ns: 'common' })}
                    trailing={<ExternalLinkIndicator />}
                  />
                </DropdownMenuLinkItem>
                <div className="mx-0 flex h-8 items-center gap-1 rounded-lg py-1 pr-2 pl-3">
                  <span aria-hidden className="i-custom-vender-workflow-docs-extractor size-4 shrink-0 text-text-tertiary" />
                  <span className="min-w-0 flex-1 truncate px-1 py-0.5 system-md-regular text-text-secondary">
                    {t('mainNav.help.learnDify', { ns: 'common' })}
                  </span>
                  <Switch
                    size="md"
                    checked={!learnDifyHidden}
                    aria-label={t('mainNav.help.learnDify', { ns: 'common' })}
                    onClick={event => event.stopPropagation()}
                    onCheckedChange={checked => setLearnDifyHidden(!checked)}
                  />
                </div>
                <Support closeAccountDropdown={() => setOpen(false)} />
                {IS_CLOUD_EDITION && isCurrentWorkspaceOwner && <Compliance />}
              </DropdownMenuGroup>
              <DropdownMenuSeparator className="my-0!" />
              <DropdownMenuGroup className="p-1">
                <DropdownMenuLinkItem href="https://roadmap.dify.ai" target="_blank" rel="noopener noreferrer" className="mx-0 h-8 gap-1 px-3 py-1.5">
                  <MenuItemContent
                    iconClassName="i-ri-map-2-line"
                    label={t('userProfile.roadmap', { ns: 'common' })}
                    trailing={<ExternalLinkIndicator />}
                  />
                </DropdownMenuLinkItem>
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
                          <div className="mr-2 system-xs-regular text-text-tertiary">{t('about.version', { ns: 'common', version: langGeniusVersionInfo.current_version })}</div>
                          <Indicator color={langGeniusVersionInfo.current_version === langGeniusVersionInfo.latest_version ? 'green' : 'orange'} />
                        </div>
                      )}
                    />
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {aboutVisible && <AccountAbout onCancel={() => setAboutVisible(false)} langGeniusVersionInfo={langGeniusVersionInfo} />}
    </>
  )
}

export default HelpMenu
