'use client'

import type { ReactNode } from 'react'
import type { StepByStepTourPersistentState } from '@/app/components/step-by-step-tour/types'
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
import { Switch } from '@langgenius/dify-ui/switch'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLearnDifyHiddenValue, useSetLearnDifyHidden } from '@/app/components/explore/learn-dify/storage'
import AccountAbout from '@/app/components/header/account-about'
import Compliance from '@/app/components/header/account-dropdown/compliance'
import { ExternalLinkIndicator, MenuItemContent } from '@/app/components/header/account-dropdown/menu-item-content'
import GithubStar from '@/app/components/header/github-star'
import {
  buildStepByStepTourScopedWorkspaceProperties,
  STEP_BY_STEP_TOUR_ANALYTICS_EVENTS,
  trackStepByStepTourEvent,
} from '@/app/components/step-by-step-tour/analytics'
import { useSetStepByStepTourSkipRecoveryVisible, useStepByStepTourSkipRecoveryVisible } from '@/app/components/step-by-step-tour/atoms'
import { useSetStepByStepTourShellMode } from '@/app/components/step-by-step-tour/shell-storage'
import {
  getStepByStepTourEnabledForCurrentWorkspace,
  useStepByStepTourAccountStateValue,
  useStepByStepTourStateActions,
} from '@/app/components/step-by-step-tour/storage'
import { IS_CLOUD_EDITION } from '@/config'
import {
  currentWorkspaceIdAtom,
  currentWorkspaceLoadingAtom,
  isCurrentWorkspaceOwnerAtom,
  langGeniusVersionInfoAtom,
} from '@/context/app-context-state'
import { useDocLink } from '@/context/i18n'
import { env } from '@/env'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import styles from './help-menu.module.css'
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

const MenuSwitchIndicator = ({
  checked,
}: {
  checked: boolean
}) => (
  <Switch
    checked={checked}
    readOnly
    aria-hidden="true"
    tabIndex={-1}
    className="pointer-events-none"
  />
)

const HelpMenu = ({
  triggerIcon = defaultTriggerIcon,
  triggerClassName,
}: HelpMenuProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isCurrentWorkspaceOwner = useAtomValue(isCurrentWorkspaceOwnerAtom)
  const langGeniusVersionInfo = useAtomValue(langGeniusVersionInfoAtom)
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const isLoadingCurrentWorkspace = useAtomValue(currentWorkspaceLoadingAtom)
  const learnDifyHidden = useLearnDifyHiddenValue()
  const setLearnDifyHidden = useSetLearnDifyHidden()
  // eslint-disable-next-line react/use-state -- Step-by-step tour storage hooks are not React useState calls.
  const stepByStepTourAccountState = useStepByStepTourAccountStateValue()
  // eslint-disable-next-line react/use-state -- Step-by-step tour state actions are not React useState calls.
  const stepByStepTourActions = useStepByStepTourStateActions()
  const skipRecoveryVisible = useStepByStepTourSkipRecoveryVisible()
  const setSkipRecoveryVisible = useSetStepByStepTourSkipRecoveryVisible()
  const setStepByStepTourShellMode = useSetStepByStepTourShellMode()
  const [aboutVisible, setAboutVisible] = useState(false)
  const [open, setOpen] = useState(false)
  const shouldShowLearnDifySwitch = systemFeatures.enable_learn_app
  const shouldShowStepByStepTourSwitch = systemFeatures.enable_step_by_step_tour
  const canToggleStepByStepTour = Boolean(currentWorkspaceId) && !isLoadingCurrentWorkspace
  const stepByStepTourEnabled = getStepByStepTourEnabledForCurrentWorkspace(
    stepByStepTourAccountState,
    currentWorkspaceId,
  )

  const handleStepByStepTourCheckedChange = (checked: boolean) => {
    if (!canToggleStepByStepTour)
      return

    setSkipRecoveryVisible(false)
    const wasSkipped = stepByStepTourAccountState.skipped
    const trackVisibilityToggled = (state: StepByStepTourPersistentState) => {
      trackStepByStepTourEvent(STEP_BY_STEP_TOUR_ANALYTICS_EVENTS.visibilityToggled, {
        ...buildStepByStepTourScopedWorkspaceProperties({
          accountState: state,
          currentWorkspaceId,
        }),
        source: 'help_menu',
        to_state: checked ? 'on' : 'off',
        was_skipped: wasSkipped,
      })
    }

    if (checked) {
      setStepByStepTourShellMode('expanded')
      stepByStepTourActions.enableCurrentWorkspace(currentWorkspaceId, { onSuccess: trackVisibilityToggled })
    }
    else {
      stepByStepTourActions.disableCurrentWorkspace(currentWorkspaceId, { onSuccess: trackVisibilityToggled })
    }

    if (checked)
      setOpen(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)

    if (nextOpen)
      setSkipRecoveryVisible(false)
  }

  if (systemFeatures.branding.enabled)
    return null

  return (
    <>
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger
          aria-label={t('mainNav.help.openMenu', { ns: 'common' })}
          data-learn-dify-help-target
          className={cn(
            'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border border-components-card-border bg-components-card-bg p-0 text-text-tertiary shadow-xs transition-colors hover:bg-components-card-bg-alt hover:text-saas-dify-blue-inverted focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
            triggerClassName,
            open && 'bg-components-card-bg-alt text-saas-dify-blue-inverted',
            skipRecoveryVisible && styles.stepByStepTourRecoveryPulse,
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
              {shouldShowLearnDifySwitch && (
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
                  <MenuSwitchIndicator checked={!learnDifyHidden} />
                </DropdownMenuCheckboxItem>
              )}
              {IS_CLOUD_EDITION && shouldShowStepByStepTourSwitch && (
                <DropdownMenuCheckboxItem
                  checked={stepByStepTourEnabled}
                  closeOnClick={false}
                  className="mx-0 h-8 gap-1 px-0 py-1 pr-2 pl-3"
                  disabled={!canToggleStepByStepTour}
                  onCheckedChange={handleStepByStepTourCheckedChange}
                >
                  <span aria-hidden className="i-custom-vender-line-education-book-open-01 size-4 shrink-0 text-text-tertiary" />
                  <span className="min-w-0 flex-1 truncate px-1 py-0.5 system-md-regular text-text-secondary">
                    {t('mainNav.help.stepByStepTour', { ns: 'common' })}
                  </span>
                  <MenuSwitchIndicator checked={stepByStepTourEnabled} />
                </DropdownMenuCheckboxItem>
              )}
              {IS_CLOUD_EDITION && isCurrentWorkspaceOwner && <Compliance />}
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="my-0!" />
            <DropdownMenuGroup className="p-1">
              <SupportMenu onContactUsClick={() => setOpen(false)} />
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
