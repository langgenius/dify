'use client'

import type { ReactNode } from 'react'
import type { InstalledApp } from '@/models/explore'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Avatar } from '@langgenius/dify-ui/avatar'
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
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import { Plan } from '@/app/components/billing/type'
import ItemOperation from '@/app/components/explore/item-operation'
import { GOTO_ANYTHING_OPEN_EVENT } from '@/app/components/goto-anything/hooks'
import AccountAbout from '@/app/components/header/account-about'
import AccountDropdown from '@/app/components/header/account-dropdown'
import Compliance from '@/app/components/header/account-dropdown/compliance'
import Support from '@/app/components/header/account-dropdown/support'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import GithubStar from '@/app/components/header/github-star'
import Indicator from '@/app/components/header/indicator'
import PlanBadge from '@/app/components/header/plan-badge'
import { IS_CLOUD_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useWorkspacesContext } from '@/context/workspace-context'
import { env } from '@/env'
import Link from '@/next/link'
import { usePathname, useRouter } from '@/next/navigation'
import { switchWorkspace } from '@/service/common'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useGetInstalledApps, useUninstallApp, useUpdateAppPinStatus } from '@/service/use-explore'
import { basePath } from '@/utils/var'

type MainNavProps = {
  className?: string
}

type MainNavItem = {
  href: string
  label: string
  active: (pathname: string) => boolean
  icon: string
  activeIcon: string
}

const navItemClassName = 'group relative flex h-9 items-center gap-2 rounded-xl p-2 transition-colors'

const activeNavItemClassName = [
  'overflow-hidden border border-transparent',
  'bg-[linear-gradient(98.077deg,var(--color-components-main-nav-glass-surface-first)_0%,var(--color-components-main-nav-glass-surface-middle-1)_17.98%,var(--color-components-main-nav-glass-surface-middle-2)_58.75%,var(--color-components-main-nav-glass-surface-end)_101.09%)]',
  'system-md-semibold text-components-main-nav-text-active backdrop-blur-[5px]',
  'shadow-[0px_4px_8px_0px_var(--color-components-main-nav-glass-shadow-reflection-glow),0px_12px_16px_-4px_var(--color-shadow-shadow-5),0px_4px_6px_-2px_var(--color-shadow-shadow-1),0px_10px_16px_-4px_var(--color-components-main-nav-glass-shadow-reflection)]',
  'main-nav-active-edge',
].join(' ')

const inactiveNavItemClassName = 'system-md-medium bg-components-main-nav-nav-button-bg text-components-main-nav-text hover:bg-state-base-hover hover:text-components-main-nav-text'

const getWorkspaceInitial = (name?: string) => name?.[0]?.toLocaleUpperCase() || '?'

const getRemainingCredits = (total: number, used: number) => Math.max(total - used, 0)

const formatCredits = (value: number) => new Intl.NumberFormat().format(value)

const WorkspaceIcon = ({
  name,
  className,
}: {
  name?: string
  className?: string
}) => (
  <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-components-icon-bg-orange-dark-solid text-white shadow-xs', className)}>
    <span className="system-md-semibold">{getWorkspaceInitial(name)}</span>
  </div>
)

const MenuIcon = ({
  className,
}: {
  className?: string
}) => (
  <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center text-text-tertiary', className)} />
)

const NavIcon = ({
  icon,
  className,
}: {
  icon: string
  className?: string
}) => (
  <span aria-hidden className={cn(icon, 'h-5 w-5 shrink-0', className)} />
)

const WorkspacePlanBadge = ({
  plan,
}: {
  plan: Plan
}) => {
  if (plan !== Plan.sandbox)
    return <PlanBadge plan={plan} />

  return (
    <div className="flex min-w-4 shrink-0 items-center justify-center gap-0.5 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5">
      <span className="min-w-0 text-center system-2xs-medium-uppercase text-text-tertiary">
        {plan}
      </span>
    </div>
  )
}

const WorkspaceMenuItemContent = ({
  icon,
  label,
  trailing,
}: {
  icon: ReactNode
  label: ReactNode
  trailing?: ReactNode
}) => (
  <>
    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-tertiary">{icon}</span>
    <span className="min-w-0 grow truncate text-left system-md-regular text-text-secondary">{label}</span>
    {trailing}
  </>
)

const WorkspaceCard = () => {
  const { t } = useTranslation()
  const { currentWorkspace } = useAppContext()
  const { workspaces } = useWorkspacesContext()
  const { enableBilling, plan } = useProviderContext()
  const { setShowPricingModal, setShowAccountSettingModal } = useModalContext()
  const [open, setOpen] = useState(false)
  const credits = getRemainingCredits(currentWorkspace.trial_credits, currentWorkspace.trial_credits_used)
  const formattedCredits = formatCredits(credits)
  const workspacePlan = (workspaces.find(workspace => workspace.current)?.plan || currentWorkspace.plan || plan.type) as Plan
  const isFreePlan = plan.type === Plan.sandbox

  const handlePlanClick = () => {
    if (isFreePlan)
      setShowPricingModal()
    else
      setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.BILLING })
  }

  const handleSwitchWorkspace = async (tenant_id: string) => {
    try {
      if (currentWorkspace.id === tenant_id)
        return

      await switchWorkspace({ url: '/workspaces/switch', body: { tenant_id } })
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      location.assign(`${location.origin}${basePath}`)
    }
    catch {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
    }
  }

  return (
    <div
      className={cn(
        'relative w-full',
        open && 'z-20',
      )}
    >
      <div
        className={cn(
          'overflow-hidden rounded-xl border border-components-card-border bg-components-card-bg text-left shadow-xs transition-colors',
          open ? 'pointer-events-none invisible' : 'hover:bg-components-card-bg-alt',
        )}
      >
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-1.5 py-1.5 pr-3 pl-1.5 text-left transition-colors',
            open && 'bg-gradient-to-b from-background-section-burn to-background-section',
          )}
          aria-expanded={open}
          aria-label={t('mainNav.workspace.openMenu', { ns: 'common' })}
          onClick={() => setOpen(value => !value)}
        >
          <WorkspaceIcon name={currentWorkspace.name} className="h-6 w-6 rounded-lg" />
          <div className="min-w-0 grow">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="max-w-[120px] truncate system-sm-medium text-text-primary">{currentWorkspace.name}</span>
              <WorkspacePlanBadge plan={workspacePlan} />
            </div>
          </div>
          <span aria-hidden className="i-ri-expand-up-down-line h-4 w-4 shrink-0 text-text-tertiary" />
        </button>
        <div className="flex items-center justify-center gap-1.5 border-t border-divider-subtle py-2 pr-2.5 pl-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-0.5 px-1 text-left text-text-tertiary transition-colors hover:text-text-secondary"
            aria-label={t('mainNav.workspace.credits', { ns: 'common', count: formattedCredits })}
            onClick={(e) => {
              e.stopPropagation()
              setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PROVIDER })
            }}
          >
            <span className="i-custom-vender-main-nav-credits h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate system-xs-medium">{formattedCredits}</span>
            <span className="shrink-0 system-xs-regular">{t('mainNav.workspace.creditsUnit', { ns: 'common' })}</span>
          </button>
          {enableBilling && (
            <button
              type="button"
              className="max-w-[120px] shrink-0 truncate px-1 system-xs-semibold-uppercase text-saas-dify-blue-accessible transition-colors hover:text-saas-dify-blue-static-hover"
              onClick={(e) => {
                e.stopPropagation()
                handlePlanClick()
              }}
            >
              {t('upgradeBtn.encourageShort', { ns: 'billing' })}
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="absolute top-0 right-0 left-0 z-20 flex flex-col overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]">
          <div className="rounded-xl bg-gradient-to-b from-background-section-burn to-background-section pb-2">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-xl p-3 text-left transition-colors hover:bg-state-base-hover"
              aria-expanded={open}
              aria-label={t('mainNav.workspace.openMenu', { ns: 'common' })}
              onClick={() => setOpen(false)}
            >
              <div className="flex min-w-0 grow flex-col items-start justify-center gap-1">
                <div className="max-w-[120px] shrink-0 truncate system-xl-medium leading-5 text-text-primary">{currentWorkspace.name}</div>
                <WorkspacePlanBadge plan={workspacePlan} />
              </div>
              <WorkspaceIcon name={currentWorkspace.name} className="h-9 w-9" />
            </button>
            <button
              type="button"
              className="flex h-8 w-full items-center gap-1 rounded-lg px-2 py-1 text-left transition-colors hover:bg-state-base-hover"
              onClick={() => {
                setOpen(false)
                setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.BILLING })
              }}
            >
              <WorkspaceMenuItemContent icon={<span aria-hidden className="i-custom-vender-main-nav-workspace-settings h-4 w-4" />} label={t('mainNav.workspace.settings', { ns: 'common' })} />
            </button>
            <button
              type="button"
              className="flex h-8 w-full items-center gap-1 rounded-lg px-2 py-1 text-left transition-colors hover:bg-state-base-hover"
              onClick={() => {
                setOpen(false)
                setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.MEMBERS })
              }}
            >
              <WorkspaceMenuItemContent icon={<span aria-hidden className="i-ri-user-add-line h-4 w-4" />} label={t('mainNav.workspace.inviteMembers', { ns: 'common' })} />
            </button>
          </div>
          {workspaces.length > 0 && (
            <div className="mt-1 flex flex-col">
              <div className="px-3 py-1.5 system-xs-medium-uppercase text-text-tertiary">
                {t('mainNav.workspace.switchWorkspace', { ns: 'common' })}
              </div>
              {workspaces.map(workspace => (
                <button
                  type="button"
                  key={workspace.id}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-lg px-3 py-1 text-left transition-colors hover:bg-state-base-hover',
                    workspace.current && 'text-text-secondary',
                  )}
                  onClick={() => {
                    setOpen(false)
                    void handleSwitchWorkspace(workspace.id)
                  }}
                >
                  <WorkspaceMenuItemContent
                    icon={<WorkspaceIcon name={workspace.name} className="h-5 w-5 rounded-md" />}
                    label={workspace.name}
                    trailing={workspace.current ? <span aria-hidden className="i-ri-check-line h-4 w-4 text-text-accent" /> : undefined}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const MainNavLink = ({
  item,
  pathname,
}: {
  item: MainNavItem
  pathname: string
}) => {
  const activated = item.active(pathname)
  return (
    <Link
      href={item.href}
      className={cn(
        navItemClassName,
        activated ? activeNavItemClassName : inactiveNavItemClassName,
      )}
    >
      <NavIcon icon={activated ? item.activeIcon : item.icon} />
      <span className={cn('truncate', activated && 'text-shadow-[0px_0px_8px_var(--color-components-main-nav-glass-text-glow)]')}>{item.label}</span>
    </Link>
  )
}

const MainNavSearchButton = () => {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      aria-label={t('gotoAnything.searchTitle', { ns: 'app' })}
      className="flex h-8 items-center gap-1.5 overflow-hidden rounded-[10px] p-2 text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
      onClick={() => window.dispatchEvent(new Event(GOTO_ANYTHING_OPEN_EVENT))}
    >
      <span aria-hidden className="i-custom-vender-main-nav-quick-search h-4 w-4" />
      <span className="rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">⌘K</span>
    </button>
  )
}

const WebAppItem = ({
  app,
  isSelected,
  onDelete,
  onTogglePin,
}: {
  app: InstalledApp
  isSelected: boolean
  onDelete: (id: string) => void
  onTogglePin: () => void
}) => {
  const router = useRouter()
  const url = `/explore/installed/${app.id}`
  const [isHovering, setIsHovering] = useState(false)

  return (
    <div
      className={cn(
        'group flex h-6 cursor-pointer items-center justify-between rounded-lg pr-0.5 pl-2 system-sm-regular text-components-main-nav-text transition-colors',
        isSelected ? 'bg-state-base-hover text-components-main-nav-text' : 'hover:bg-state-base-hover hover:text-components-main-nav-text',
      )}
      onClick={() => router.push(url)}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      title={app.app.name}
    >
      <div className="flex min-w-0 grow items-center gap-2">
        <AppIcon
          size="tiny"
          iconType={app.app.icon_type}
          icon={app.app.icon}
          background={app.app.icon_background}
          imageUrl={app.app.icon_url}
        />
        <span className="truncate">{app.app.name}</span>
      </div>
      <div className="h-6 shrink-0" onClick={e => e.stopPropagation()}>
        <ItemOperation
          isPinned={app.is_pinned}
          isItemHovering={isHovering}
          togglePin={onTogglePin}
          isShowDelete={!app.uninstallable && !isSelected}
          onDelete={() => onDelete(app.id)}
        />
      </div>
    </div>
  )
}

const WebAppsSection = () => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const { data, isPending } = useGetInstalledApps()
  const installedApps = useMemo(() => data?.installed_apps ?? [], [data?.installed_apps])
  const { mutateAsync: uninstallApp, isPending: isUninstalling } = useUninstallApp()
  const { mutateAsync: updatePinStatus } = useUpdateAppPinStatus()
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [currentId, setCurrentId] = useState('')

  const filteredApps = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase()
    if (!normalizedSearch)
      return installedApps

    return installedApps.filter(item => item.app.name.toLowerCase().includes(normalizedSearch))
  }, [installedApps, searchText])

  const handleDelete = async () => {
    await uninstallApp(currentId)
    setShowConfirm(false)
    toast.success(t('api.remove', { ns: 'common' }))
  }

  const handleUpdatePinStatus = async (id: string, isPinned: boolean) => {
    await updatePinStatus({ appId: id, isPinned })
    toast.success(t('api.success', { ns: 'common' }))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-2 pb-1">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1 text-left system-xs-medium-uppercase text-text-quaternary hover:text-text-tertiary"
          onClick={() => setSearchVisible(value => !value)}
        >
          <span>{t('sidebar.webApps', { ns: 'explore' })}</span>
          <span aria-hidden className="i-ri-arrow-down-s-line h-3.5 w-3.5 shrink-0" />
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('operation.search', { ns: 'common' })}
            className={cn('flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary', searchVisible && 'bg-state-base-hover text-text-secondary')}
            onClick={() => setSearchVisible(value => !value)}
          >
            <span aria-hidden className="i-ri-search-line h-4 w-4" />
          </button>
        </div>
      </div>
      {searchVisible && (
        <div className="px-2 pb-2">
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder={t('mainNav.webApps.searchPlaceholder', { ns: 'common' })}
            className="h-8 w-full rounded-lg border border-transparent bg-components-input-bg-normal px-2 system-sm-regular text-text-secondary outline-none placeholder:text-text-quaternary hover:border-components-input-border-hover focus:border-components-input-border-active"
          />
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-x-hidden overflow-y-auto px-2 pb-2">
        {isPending && (
          <div className="px-2 py-1 system-xs-regular text-components-main-nav-text">{t('loading', { ns: 'common' })}</div>
        )}
        {!isPending && filteredApps.length === 0 && (
          <div className="px-2 py-1 system-xs-regular text-components-main-nav-text">
            {searchText ? t('mainNav.webApps.noResults', { ns: 'common' }) : t('sidebar.noApps.title', { ns: 'explore' })}
          </div>
        )}
        {filteredApps.map(app => (
          <WebAppItem
            key={app.id}
            app={app}
            isSelected={pathname.endsWith(`/installed/${app.id}`)}
            onDelete={(id) => {
              setCurrentId(id)
              setShowConfirm(true)
            }}
            onTogglePin={() => {
              void handleUpdatePinStatus(app.id, !app.is_pinned)
            }}
          />
        ))}
      </div>
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <div className="flex flex-col items-start gap-2 self-stretch pt-6 pr-6 pb-4 pl-6">
            <AlertDialogTitle className="w-full title-2xl-semi-bold text-text-primary">
              {t('sidebar.delete.title', { ns: 'explore' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('sidebar.delete.content', { ns: 'explore' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={isUninstalling}>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={isUninstalling} disabled={isUninstalling} onClick={handleDelete}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const HelpMenu = () => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { langGeniusVersionInfo, isCurrentWorkspaceOwner } = useAppContext()
  const [aboutVisible, setAboutVisible] = useState(false)
  const [open, setOpen] = useState(false)

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          aria-label={t('mainNav.help.openMenu', { ns: 'common' })}
          className={cn(
            'flex items-center justify-center overflow-hidden rounded-full border border-components-card-border bg-components-card-bg p-0.5 text-components-main-nav-text shadow-[0px_0px_0px_1px_var(--color-components-button-button-seam)] transition-colors hover:bg-components-card-bg-alt hover:text-text-accent hover:shadow-[0px_0px_0px_1px_var(--color-components-button-button-seam),0px_1px_2px_0px_var(--color-shadow-shadow-3)]',
            open && 'bg-components-card-bg-alt text-text-accent shadow-[0px_0px_0px_1px_var(--color-components-button-button-seam),0px_1px_2px_0px_var(--color-shadow-shadow-3)]',
          )}
        >
          <span aria-hidden className="i-custom-vender-main-nav-help size-6 shrink-0 rounded-full" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="top-end"
          sideOffset={8}
          popupClassName="w-60 p-1"
        >
          {!systemFeatures.branding.enabled && (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLinkItem href={docLink('/use-dify/getting-started/introduction')} target="_blank" rel="noopener noreferrer" className="gap-2 px-3">
                  <MenuIcon className="i-ri-book-open-line" />
                  <span className="grow system-sm-regular text-text-secondary">{t('userProfile.helpCenter', { ns: 'common' })}</span>
                </DropdownMenuLinkItem>
                <Support closeAccountDropdown={() => setOpen(false)} />
                {IS_CLOUD_EDITION && isCurrentWorkspaceOwner && <Compliance />}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLinkItem href="https://roadmap.dify.ai" target="_blank" rel="noopener noreferrer" className="gap-2 px-3">
                  <MenuIcon className="i-ri-map-2-line" />
                  <span className="grow system-sm-regular text-text-secondary">{t('userProfile.roadmap', { ns: 'common' })}</span>
                </DropdownMenuLinkItem>
                <DropdownMenuLinkItem href="https://github.com/langgenius/dify" target="_blank" rel="noopener noreferrer" className="gap-2 px-3">
                  <MenuIcon className="i-ri-github-line" />
                  <span className="grow system-sm-regular text-text-secondary">{t('userProfile.github', { ns: 'common' })}</span>
                  <div className="flex items-center gap-0.5 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-[5px] py-[3px]">
                    <span aria-hidden className="i-ri-star-line size-3 shrink-0 text-text-tertiary" />
                    <GithubStar className="system-2xs-medium-uppercase text-text-tertiary" />
                  </div>
                </DropdownMenuLinkItem>
                {env.NEXT_PUBLIC_SITE_ABOUT !== 'hide' && (
                  <DropdownMenuItem
                    className="gap-2 px-3"
                    onClick={() => {
                      setAboutVisible(true)
                      setOpen(false)
                    }}
                  >
                    <span aria-hidden className="i-ri-information-2-line h-4 w-4 shrink-0 text-text-tertiary" />
                    <span className="grow system-sm-regular text-text-secondary">{t('userProfile.about', { ns: 'common' })}</span>
                    <div className="flex shrink-0 items-center">
                      <div className="mr-2 system-xs-regular text-text-tertiary">{langGeniusVersionInfo.current_version}</div>
                      <Indicator color={langGeniusVersionInfo.current_version === langGeniusVersionInfo.latest_version ? 'green' : 'orange'} />
                    </div>
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

const MainNav = ({
  className,
}: MainNavProps) => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const { userProfile } = useAppContext()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const navItems = useMemo<MainNavItem[]>(() => [
    {
      href: '/explore/apps',
      label: t('mainNav.home', { ns: 'common' }),
      active: path => path.startsWith('/explore'),
      icon: 'i-custom-vender-main-nav-home',
      activeIcon: 'i-custom-vender-main-nav-home-active',
    },
    {
      href: '/apps',
      label: t('menus.apps', { ns: 'common' }),
      active: path => path.startsWith('/apps') || path.startsWith('/app/'),
      icon: 'i-custom-vender-main-nav-studio',
      activeIcon: 'i-custom-vender-main-nav-studio-active',
    },
    {
      href: '/datasets',
      label: t('menus.datasets', { ns: 'common' }),
      active: path => path.startsWith('/datasets'),
      icon: 'i-custom-vender-main-nav-knowledge',
      activeIcon: 'i-custom-vender-main-nav-knowledge-active',
    },
    {
      href: '/tools',
      label: t('mainNav.integrations', { ns: 'common' }),
      active: path => path.startsWith('/tools'),
      icon: 'i-custom-vender-main-nav-integrations',
      activeIcon: 'i-custom-vender-main-nav-integrations-active',
    },
    {
      href: '/plugins',
      label: t('mainNav.marketplace', { ns: 'common' }),
      active: path => path.startsWith('/plugins'),
      icon: 'i-custom-vender-main-nav-marketplace',
      activeIcon: 'i-custom-vender-main-nav-marketplace-active',
    },
  ], [t])

  const renderLogo = () => (
    <h1 className="min-w-0">
      <Link href="/apps" className="flex h-8 shrink-0 items-center overflow-hidden px-2 indent-[-9999px] whitespace-nowrap">
        {systemFeatures.branding.enabled && systemFeatures.branding.application_title ? systemFeatures.branding.application_title : 'Dify'}
        {systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
          ? (
              <img
                src={systemFeatures.branding.workspace_logo}
                className="block h-[22px] w-auto object-contain"
                alt="logo"
              />
            )
          : <DifyLogo />}
      </Link>
    </h1>
  )

  return (
    <aside className={cn('flex h-full w-[240px] shrink-0 flex-col bg-background-body', className)}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-2 pt-4 pb-2">
          {renderLogo()}
          <MainNavSearchButton />
        </div>
        <div className="p-2">
          <WorkspaceCard />
        </div>
        <nav className="space-y-1 p-2">
          {navItems.map(item => (
            <MainNavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
        <WebAppsSection />
      </div>
      <div className="flex w-[240px] items-center justify-between bg-gradient-to-b from-background-body-transparent to-background-body to-50% py-3 pr-1 pl-3 backdrop-blur-[2px]">
        <AccountDropdown
          trigger={({ isOpen, ariaLabel }) => (
            <button
              type="button"
              aria-label={ariaLabel}
              className={cn('flex shrink-0 items-center gap-3 rounded-full py-1 pr-4 pl-1 text-left text-components-main-nav-text transition-colors hover:bg-state-base-hover', isOpen && 'bg-state-base-hover')}
            >
              <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="md" className="size-7" />
              <span className="system-md-medium whitespace-nowrap">{userProfile.name}</span>
            </button>
          )}
        />
        <HelpMenu />
      </div>
    </aside>
  )
}

export default MainNav
