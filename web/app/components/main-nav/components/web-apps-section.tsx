'use client'

import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppNavItem from '@/app/components/explore/sidebar/app-nav-item'
import { usePathname } from '@/next/navigation'
import { useGetInstalledApps, useUninstallApp, useUpdateAppPinStatus } from '@/service/use-explore'

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
      <div className="flex items-center justify-between py-1 pr-2.5 pl-2">
        <button
          type="button"
          className="flex min-w-0 items-center rounded-md px-2 py-1 text-left system-xs-medium-uppercase text-text-tertiary hover:text-text-secondary"
          onClick={() => setSearchVisible(value => !value)}
        >
          <span>{t('sidebar.webApps', { ns: 'explore' })}</span>
          <span aria-hidden className="i-ri-arrow-down-s-fill h-4 w-4 shrink-0" />
        </button>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label={t('operation.search', { ns: 'common' })}
            className={cn('flex h-6 w-6 items-center justify-center rounded-md p-0.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary', searchVisible && 'bg-state-base-hover text-text-secondary')}
            onClick={() => setSearchVisible(value => !value)}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              <span aria-hidden className="i-ri-search-line size-3.5" />
            </span>
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
        {filteredApps.map(({ id, is_pinned, uninstallable, app }) => (
          <AppNavItem
            key={id}
            variant="mainNav"
            isMobile={false}
            name={app.name}
            icon_type={app.icon_type}
            icon={app.icon}
            icon_background={app.icon_background}
            icon_url={app.icon_url}
            id={id}
            isSelected={pathname.endsWith(`/installed/${id}`)}
            isPinned={is_pinned}
            togglePin={() => {
              void handleUpdatePinStatus(id, !is_pinned)
            }}
            uninstallable={uninstallable}
            onDelete={(id) => {
              setCurrentId(id)
              setShowConfirm(true)
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

export default WebAppsSection
