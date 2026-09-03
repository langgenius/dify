'use client'

import type { IconButtonProps } from '@langgenius/dify-ui/icon-button'
import type { ReactElement, Ref } from 'react'
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
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Switch } from '@langgenius/dify-ui/switch'
import { skipToken, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useLearnDifyHiddenValue,
  useSetLearnDifyHidden,
} from '@/app/components/explore/learn-dify/storage'
import Compliance from '@/app/components/header/account-dropdown/compliance'
import {
  ExternalLinkIndicator,
  MenuItemContent,
} from '@/app/components/header/account-dropdown/menu-item-content'
import GithubStar from '@/app/components/header/github-star'
import { trackStepByStepTourEvent } from '@/app/components/step-by-step-tour/analytics'
import {
  disableStepByStepTourForCurrentWorkspaceAtom,
  enableStepByStepTourForCurrentWorkspaceAtom,
  stepByStepTourEnabledForCurrentWorkspaceAtom,
  stepByStepTourSkipRecoveryVisibleAtom,
  stepByStepTourStateUpdatingAtom,
} from '@/app/components/step-by-step-tour/state'
import { useSetStepByStepTourShellMode } from '@/app/components/step-by-step-tour/storage'
import { getLangGeniusVersionInfo } from '@/context/app-context-normalizers'
import { useDocLink } from '@/context/i18n'
import {
  currentWorkspaceIdAtom,
  currentWorkspaceLoadingAtom,
  isCurrentWorkspaceOwnerAtom,
} from '@/context/workspace-state'
import { env } from '@/env'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/client'
import styles from './help-menu.module.css'
import AccountAboutDialog from './help-menu/account-about-dialog'
import SupportMenu from './support-menu'

type HelpMenuProps = {
  triggerIcon?: ReactElement
  triggerClassName?: string
  triggerRef?: Ref<HTMLButtonElement>
  triggerSize?: IconButtonProps['size']
}

const defaultTriggerIcon = (
  <svg aria-hidden className="size-6 shrink-0" viewBox="0 0 24 24" fill="none">
    <path
      d="M11.9666 16.9985V17.011"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M11.9665 13.2485C11.9665 11.1995 14.4665 11.9134 14.4665 9.49854C14.4665 8.11782 13.3473 6.99854 11.9665 6.99854C11.0412 6.99854 10.2333 7.50129 9.80103 8.24854"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const MenuSwitchIndicator = ({ checked }: { checked: boolean }) => (
  <Switch
    checked={checked}
    readOnly
    aria-hidden="true"
    tabIndex={-1}
    className="pointer-events-none"
  />
)

const HelpMenu = ({ triggerIcon, triggerClassName, triggerRef, triggerSize }: HelpMenuProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: profileMeta } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.meta,
  })
  const { data: versionData } = useQuery(
    consoleQuery.version.get.queryOptions({
      input: profileMeta.currentVersion
        ? { query: { current_version: profileMeta.currentVersion } }
        : skipToken,
      enabled: !systemFeatures.branding.enabled,
    }),
  )
  const isCurrentWorkspaceOwner = useAtomValue(isCurrentWorkspaceOwnerAtom)
  const langGeniusVersionInfo = getLangGeniusVersionInfo({ meta: profileMeta, versionData })
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const isLoadingCurrentWorkspace = useAtomValue(currentWorkspaceLoadingAtom)
  const learnDifyHidden = useLearnDifyHiddenValue()
  const setLearnDifyHidden = useSetLearnDifyHidden()
  const stepByStepTourEnabled = useAtomValue(stepByStepTourEnabledForCurrentWorkspaceAtom)
  const stepByStepTourStateUpdating = useAtomValue(stepByStepTourStateUpdatingAtom)
  const skipRecoveryVisible = useAtomValue(stepByStepTourSkipRecoveryVisibleAtom)
  const setSkipRecoveryVisible = useSetAtom(stepByStepTourSkipRecoveryVisibleAtom)
  const enableStepByStepTour = useSetAtom(enableStepByStepTourForCurrentWorkspaceAtom)
  const disableStepByStepTour = useSetAtom(disableStepByStepTourForCurrentWorkspaceAtom)
  const setStepByStepTourShellMode = useSetStepByStepTourShellMode()
  const [aboutOpen, setAboutOpen] = useState(false)
  const usesDefaultTrigger = !triggerIcon
  const shouldShowLearnDifySwitch = systemFeatures.enable_learn_app
  const shouldShowStepByStepTourSwitch = systemFeatures.enable_step_by_step_tour
  const canToggleStepByStepTour =
    Boolean(currentWorkspaceId) && !isLoadingCurrentWorkspace && !stepByStepTourStateUpdating

  const handleStepByStepTourCheckedChange = (checked: boolean) => {
    if (!canToggleStepByStepTour) return

    setSkipRecoveryVisible(false)
    const trackVisibilityToggled = () =>
      trackStepByStepTourEvent({ action: checked ? 'tour_enabled' : 'tour_disabled' })

    if (checked) {
      setStepByStepTourShellMode('expanded')
      enableStepByStepTour({
        onSuccess: trackVisibilityToggled,
      })
    } else {
      disableStepByStepTour({
        onSuccess: trackVisibilityToggled,
      })
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) setSkipRecoveryVisible(false)
  }

  if (systemFeatures.branding.enabled) return null

  return (
    <>
      <DropdownMenu onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger
          ref={triggerRef}
          data-learn-dify-help-target
          render={
            <IconButton
              size={triggerSize ?? 'lg'}
              aria-label={t(($) => $['mainNav.help.openMenu'], { ns: 'common' })}
              className={cn(
                'focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-state-accent-solid focus-visible:outline-solid',
                usesDefaultTrigger && [
                  'rounded-full border border-components-card-border bg-components-card-bg text-text-tertiary shadow-xs transition-colors hover:bg-components-card-bg-alt hover:text-saas-dify-blue-inverted',
                  !triggerSize && 'size-7 p-0',
                  'data-popup-open:bg-components-card-bg-alt data-popup-open:text-saas-dify-blue-inverted',
                ],
                !usesDefaultTrigger &&
                  'data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary',
                triggerClassName,
                skipRecoveryVisible && styles.stepByStepTourRecoveryPulse,
              )}
            >
              {triggerIcon ?? defaultTriggerIcon}
            </IconButton>
          }
        />
        <DropdownMenuContent
          placement="top-end"
          sideOffset={8}
          className="w-60 overflow-hidden bg-components-panel-bg-blur! p-0! backdrop-blur-[5px]"
        >
          <>
            <DropdownMenuGroup className="p-1">
              <DropdownMenuLinkItem
                href={docLink('/use-dify/getting-started/introduction')}
                target="_blank"
                rel="noopener noreferrer"
                className="mx-0 h-8 gap-1 px-3 py-1"
              >
                <MenuItemContent
                  iconClassName="i-ri-book-open-line"
                  label={t(($) => $['mainNav.help.docs'], { ns: 'common' })}
                  trailing={<ExternalLinkIndicator />}
                />
              </DropdownMenuLinkItem>
              <DropdownMenuLinkItem
                href="https://roadmap.dify.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="mx-0 h-8 gap-1 px-3 py-1"
              >
                <MenuItemContent
                  iconClassName="i-ri-map-2-line"
                  label={t(($) => $['userProfile.roadmap'], { ns: 'common' })}
                  trailing={<ExternalLinkIndicator />}
                />
              </DropdownMenuLinkItem>
              {shouldShowLearnDifySwitch && (
                <DropdownMenuCheckboxItem
                  checked={!learnDifyHidden}
                  closeOnClick={false}
                  className="mx-0 h-8 gap-1 px-0 py-1 pr-2 pl-3"
                  onCheckedChange={(checked) => setLearnDifyHidden(!checked)}
                >
                  <span
                    aria-hidden
                    className="i-custom-vender-workflow-docs-extractor size-4 shrink-0 text-text-tertiary"
                  />
                  <span className="min-w-0 flex-1 truncate px-1 py-0.5 system-md-regular text-text-secondary">
                    {t(($) => $['mainNav.help.learnDify'], { ns: 'common' })}
                  </span>
                  <MenuSwitchIndicator checked={!learnDifyHidden} />
                </DropdownMenuCheckboxItem>
              )}
              {systemFeatures.deployment_edition === 'CLOUD' && shouldShowStepByStepTourSwitch && (
                <DropdownMenuCheckboxItem
                  checked={stepByStepTourEnabled}
                  closeOnClick={!stepByStepTourEnabled}
                  className="mx-0 h-8 gap-1 px-0 py-1 pr-2 pl-3"
                  disabled={!canToggleStepByStepTour}
                  onCheckedChange={handleStepByStepTourCheckedChange}
                >
                  <span
                    aria-hidden
                    className="i-custom-vender-line-education-book-open-01 size-4 shrink-0 text-text-tertiary"
                  />
                  <span className="min-w-0 flex-1 truncate px-1 py-0.5 system-md-regular text-text-secondary">
                    {t(($) => $['mainNav.help.stepByStepTour'], { ns: 'common' })}
                  </span>
                  <MenuSwitchIndicator checked={stepByStepTourEnabled} />
                </DropdownMenuCheckboxItem>
              )}
              {systemFeatures.deployment_edition === 'CLOUD' && isCurrentWorkspaceOwner && (
                <Compliance />
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="my-0!" />
            <DropdownMenuGroup className="p-1">
              <SupportMenu />
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="my-0!" />
            <DropdownMenuGroup className="p-1">
              <DropdownMenuLinkItem
                href="https://github.com/langgenius/dify"
                target="_blank"
                rel="noopener noreferrer"
                className="mx-0 h-8 gap-1 px-3 py-1.5"
              >
                <MenuItemContent
                  iconClassName="i-ri-github-line"
                  label={t(($) => $['userProfile.github'], { ns: 'common' })}
                  trailing={
                    <div className="flex items-center gap-0.5 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1.25 py-0.75">
                      <span
                        aria-hidden
                        className="i-ri-star-line size-3 shrink-0 text-text-tertiary"
                      />
                      <GithubStar className="system-2xs-medium-uppercase text-text-tertiary" />
                    </div>
                  }
                />
              </DropdownMenuLinkItem>
              {env.NEXT_PUBLIC_SITE_ABOUT !== 'hide' && (
                <DropdownMenuItem
                  className="mx-0 h-8 gap-1 px-3 py-1.5"
                  onClick={() => setAboutOpen(true)}
                >
                  <MenuItemContent
                    iconClassName="i-ri-information-2-line"
                    label={t(($) => $['userProfile.about'], { ns: 'common' })}
                    trailing={
                      <div className="flex shrink-0 items-center">
                        <div className="system-xs-regular text-text-tertiary">
                          {t(($) => $['about.version'], {
                            ns: 'common',
                            version: langGeniusVersionInfo.current_version,
                          })}
                        </div>
                      </div>
                    }
                  />
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </>
        </DropdownMenuContent>
      </DropdownMenu>
      <AccountAboutDialog
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        langGeniusVersionInfo={langGeniusVersionInfo}
        deploymentEdition={systemFeatures.deployment_edition}
      />
    </>
  )
}

export default HelpMenu
