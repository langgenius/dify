'use client'

import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import type { Tag } from '@/app/components/base/tag-management/constant'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import type { WorkflowOnlineUser } from '@/models/app'
import type { App } from '@/types/app'
import * as React from 'react'
import { useCallback, useMemo, useState, useTransition } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import TagSelector from '@/app/components/base/tag-management/selector'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import { toast } from '@/app/components/base/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { UserAvatarList } from '@/app/components/base/user-avatar-list'
import CornerMark from '@/app/components/plugins/card/base/corner-mark'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useProviderContext } from '@/context/provider-context'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { AccessMode } from '@/models/access-control'
import dynamic from '@/next/dynamic'
import { useRouter } from '@/next/navigation'
import { useGetUserCanAccessApp } from '@/service/access-control'
import { copyApp, exportAppBundle, exportAppConfig, updateAppInfo, upgradeAppRuntime } from '@/service/apps'
import { fetchInstalledAppList } from '@/service/explore'
import { useDeleteAppMutation } from '@/service/use-apps'
import { fetchWorkflowDraft } from '@/service/workflow'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import { cn } from '@/utils/classnames'
import { downloadBlob } from '@/utils/download'
import { formatTime } from '@/utils/time'
import { basePath } from '@/utils/var'

const EditAppModal = dynamic(() => import('@/app/components/explore/create-app-modal'), {
  ssr: false,
})
const DuplicateAppModal = dynamic(() => import('@/app/components/app/duplicate-modal'), {
  ssr: false,
})
const SwitchAppModal = dynamic(() => import('@/app/components/app/switch-app-modal'), {
  ssr: false,
})
const DSLExportConfirmModal = dynamic(() => import('@/app/components/workflow/dsl-export-confirm-modal'), {
  ssr: false,
})
const AccessControl = dynamic(() => import('@/app/components/app/app-access-control'), {
  ssr: false,
})

type AppCardOperationsProps = {
  app: App
  open: boolean
  webappAuthEnabled: boolean
  isCurrentWorkspaceEditor: boolean
  exporting: boolean
  secretEnvListLength: number
  isUpgradingRuntime: boolean
  popupClassName: string
  onOpenChange: (open: boolean) => void
  onEdit: () => void
  onDuplicate: () => void
  onExport: () => void
  onSwitch: () => void
  onDelete: () => void
  onAccessControl: () => void
  onInstalledApp: () => void
  onUpgradeRuntime: () => void
}

const AppCardOperations = ({
  app,
  open,
  webappAuthEnabled,
  isCurrentWorkspaceEditor,
  exporting,
  secretEnvListLength,
  isUpgradingRuntime,
  popupClassName,
  onOpenChange,
  onEdit,
  onDuplicate,
  onExport,
  onSwitch,
  onDelete,
  onAccessControl,
  onInstalledApp,
  onUpgradeRuntime,
}: AppCardOperationsProps) => {
  const { t } = useTranslation()
  const { data: userCanAccessApp, isLoading: isGettingUserCanAccessApp } = useGetUserCanAccessApp({
    appId: app.id,
    enabled: !!open && webappAuthEnabled,
  })

  const onClickInstalledApp = async () => {
    onInstalledApp()
  }

  const onClickUpgradeRuntime = async () => {
    onUpgradeRuntime()
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        type="button"
        aria-label={t('operation.more', { ns: 'common' })}
        className={cn(
          'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-state-base-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-components-input-border-active',
          open && 'bg-state-base-hover shadow-none',
        )}
      >
        <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName={cn(
          'w-fit min-w-[130px]',
          popupClassName,
        )}
      >
        <div className="flex w-full flex-col">
          <DropdownMenuItem className="gap-2 px-3" onClick={onEdit}>
            <span className="text-text-secondary system-sm-regular">{t('editApp', { ns: 'app' })}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 px-3" onClick={onDuplicate}>
            <span className="text-text-secondary system-sm-regular">{t('duplicate', { ns: 'app' })}</span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={exporting || secretEnvListLength > 0} className="gap-2 px-3" onClick={onExport}>
            <span className="text-text-secondary system-sm-regular">{t('export', { ns: 'app' })}</span>
          </DropdownMenuItem>
          {(app.mode === AppModeEnum.COMPLETION || app.mode === AppModeEnum.CHAT) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="px-3" onClick={onSwitch}>
                <span className="text-sm leading-5 text-text-secondary">{t('switch', { ns: 'app' })}</span>
              </DropdownMenuItem>
            </>
          )}
          {
            !app.has_draft_trigger && (
              (!webappAuthEnabled)
                ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="gap-2 px-3" onClick={onClickInstalledApp}>
                        <span className="text-text-secondary system-sm-regular">{t('openInExplore', { ns: 'app' })}</span>
                      </DropdownMenuItem>
                    </>
                  )
                : !(isGettingUserCanAccessApp || !userCanAccessApp?.result) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="gap-2 px-3" onClick={onClickInstalledApp}>
                        <span className="text-text-secondary system-sm-regular">{t('openInExplore', { ns: 'app' })}</span>
                      </DropdownMenuItem>
                    </>
                  )
            )
          }
          <DropdownMenuSeparator />
          {
            webappAuthEnabled && isCurrentWorkspaceEditor && (
              <>
                <DropdownMenuItem className="px-3" onClick={onAccessControl}>
                  <span className="text-sm leading-5 text-text-secondary">{t('accessControl', { ns: 'app' })}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )
          }
          {app.runtime_type !== 'sandboxed'
            && (app.mode === AppModeEnum.WORKFLOW || app.mode === AppModeEnum.ADVANCED_CHAT)
            && (
              <DropdownMenuItem
                disabled={isUpgradingRuntime}
                className="gap-2 px-3"
                onClick={onClickUpgradeRuntime}
              >
                <span className="text-text-accent system-sm-regular">
                  {t('upgradeRuntime', { ns: 'app' })}
                </span>
              </DropdownMenuItem>
            )}
          <DropdownMenuItem className="group gap-2 px-3 py-[6px] data-[highlighted]:bg-state-destructive-hover" destructive onClick={onDelete}>
            <span className="system-sm-regular">
              {t('operation.delete', { ns: 'common' })}
            </span>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export type AppCardProps = {
  app: App
  onRefresh?: () => void
  onlineUsers?: WorkflowOnlineUser[]
}

const AppCard = ({ app, onRefresh, onlineUsers = [] }: AppCardProps) => {
  const { t } = useTranslation()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { onPlanInfoChanged } = useProviderContext()
  const { push } = useRouter()
  const openAsyncWindow = useAsyncWindowOpen()

  const [showEditModal, setShowEditModal] = useState(false)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [showSwitchModal, setShowSwitchModal] = useState<boolean>(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [confirmDeleteInput, setConfirmDeleteInput] = useState('')
  const [showAccessControl, setShowAccessControl] = useState(false)
  const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariable[]>([])
  const [isOperationsOpen, setIsOperationsOpen] = useState(false)
  const [exporting, startExport] = useTransition()
  const { mutateAsync: mutateDeleteApp, isPending: isDeleting } = useDeleteAppMutation()

  const onConfirmDelete = useCallback(async () => {
    try {
      await mutateDeleteApp(app.id)
      toast.success(t('appDeleted', { ns: 'app' }))
      onPlanInfoChanged()
    }
    catch (e: unknown) {
      toast.error(`${t('appDeleteFailed', { ns: 'app' })}${e instanceof Error ? `: ${e.message}` : ''}`)
    }
    finally {
      setShowConfirmDelete(false)
      setConfirmDeleteInput('')
    }
  }, [app.id, mutateDeleteApp, onPlanInfoChanged, t])

  const onDeleteDialogOpenChange = useCallback((open: boolean) => {
    if (isDeleting)
      return

    setShowConfirmDelete(open)
    if (!open)
      setConfirmDeleteInput('')
  }, [isDeleting])

  const onEdit: CreateAppModalProps['onConfirm'] = useCallback(async ({
    name,
    icon_type,
    icon,
    icon_background,
    description,
    use_icon_as_answer_icon,
    max_active_requests,
  }) => {
    try {
      await updateAppInfo({
        appID: app.id,
        name,
        icon_type,
        icon,
        icon_background,
        description,
        use_icon_as_answer_icon,
        max_active_requests,
      })
      setShowEditModal(false)
      toast.success(t('editDone', { ns: 'app' }))
      if (onRefresh)
        onRefresh()
    }
    catch (e: unknown) {
      toast.error((e instanceof Error ? e.message : '') || t('editFailed', { ns: 'app' }))
    }
  }, [app.id, onRefresh, t])

  const onCopy: DuplicateAppModalProps['onConfirm'] = async ({ name, icon_type, icon, icon_background }) => {
    try {
      const newApp = await copyApp({
        appID: app.id,
        name,
        icon_type,
        icon,
        icon_background,
        mode: app.mode,
      })
      setShowDuplicateModal(false)
      toast.success(t('newApp.appCreated', { ns: 'app' }))
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      if (onRefresh)
        onRefresh()
      onPlanInfoChanged()
      getRedirection(isCurrentWorkspaceEditor, newApp, push)
    }
    catch {
      toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
    }
  }

  const onExport = async (include = false) => {
    try {
      const isDownLoadBundle = app.runtime_type === 'sandboxed'
      if (isDownLoadBundle) {
        await exportAppBundle({
          appID: app.id,
          include,
        })
        return
      }
      const { data } = await exportAppConfig({
        appID: app.id,
        include,
      })
      const file = new Blob([data], { type: 'application/yaml' })
      downloadBlob({ data: file, fileName: `${app.name}.yml` })
    }
    catch {
      toast.error(t('exportFailed', { ns: 'app' }))
    }
  }

  const exportCheck = async () => {
    if (app.mode !== AppModeEnum.WORKFLOW && app.mode !== AppModeEnum.ADVANCED_CHAT) {
      await onExport()
      return
    }
    try {
      const workflowDraft = await fetchWorkflowDraft(`/apps/${app.id}/workflows/draft`)
      const list = (workflowDraft.environment_variables || []).filter(env => env.value_type === 'secret')
      if (list.length === 0) {
        await onExport()
        return
      }
      setSecretEnvList(list)
    }
    catch {
      toast.error(t('exportFailed', { ns: 'app' }))
    }
  }

  const [isUpgradingRuntime, startUpgradeRuntime] = useTransition()

  const onSwitch = () => {
    if (onRefresh)
      onRefresh()
    setShowSwitchModal(false)
  }

  const onUpdateAccessControl = useCallback(() => {
    if (onRefresh)
      onRefresh()
    setShowAccessControl(false)
  }, [onRefresh, setShowAccessControl])

  const handleOpenEditModal = useCallback(() => setShowEditModal(true), [])
  const handleOpenDuplicateModal = useCallback(() => setShowDuplicateModal(true), [])
  const handleOpenSwitchModal = useCallback(() => setShowSwitchModal(true), [])
  const handleOpenDeleteModal = useCallback(() => setShowConfirmDelete(true), [])
  const handleOpenAccessControl = useCallback(() => setShowAccessControl(true), [])
  const handleExport = useCallback(() => {
    startExport(async () => {
      await exportCheck()
    })
  }, [exportCheck, startExport])
  const handleInstalledApp = useCallback(async () => {
    try {
      await openAsyncWindow(async () => {
        const { installed_apps } = (await fetchInstalledAppList(app.id) || {}) as { installed_apps?: { id: string }[] }
        if (installed_apps && installed_apps.length > 0)
          return `${basePath}/explore/installed/${installed_apps[0].id}`
        throw new Error('No app found in Explore')
      }, {
        onError: (err) => {
          toast.error(`${err.message || err}`)
        },
      })
    }
    catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }, [app.id, openAsyncWindow])
  const handleUpgradeRuntime = useCallback(() => {
    startUpgradeRuntime(async () => {
      try {
        const res = await upgradeAppRuntime(app.id)
        if (res.result === 'success' && res.new_app_id) {
          toast.success(t('sandboxMigrationModal.upgrade', { ns: 'workflow' }))
          const params = new URLSearchParams({
            upgraded_from: app.id,
            upgraded_from_name: app.name,
          })
          push(`/app/${res.new_app_id}/workflow?${params.toString()}`)
        }
      }
      catch (e: unknown) {
        toast.error((e instanceof Error ? e.message : '') || 'Upgrade failed')
      }
    })
  }, [app.id, app.name, push, startUpgradeRuntime, t])

  const [tags, setTags] = useState<Tag[]>(() => app.tags)

  const EditTimeText = useMemo(() => {
    const timeText = formatTime({
      date: (app.updated_at || app.created_at) * 1000,
      dateFormat: `${t('segment.dateTimeFormat', { ns: 'datasetDocuments' })}`,
    })
    return `${t('segment.editedAt', { ns: 'datasetDocuments' })} ${timeText}`
  }, [app.updated_at, app.created_at, t])

  const onlineUserAvatars = useMemo(() => {
    if (!onlineUsers.length)
      return []

    return onlineUsers
      .map(user => ({
        id: user.user_id || user.sid || '',
        name: user.username || 'User',
        avatar_url: user.avatar || undefined,
      }))
      .filter(user => !!user.id)
  }, [onlineUsers])

  const isSandboxApp = app.runtime_type === 'sandboxed'

  return (
    <>
      <div
        className="group relative col-span-1 inline-flex h-[160px] flex-col rounded-xl border-[1px] border-solid border-components-card-border bg-components-card-bg shadow-sm transition-all duration-200 ease-in-out hover:shadow-lg"
      >
        {isSandboxApp && (
          <div className="pointer-events-none">
            <CornerMark text={t('sandboxBadge', { ns: 'app' })} />
          </div>
        )}
        <button
          type="button"
          onClick={() => getRedirection(isCurrentWorkspaceEditor, app, push)}
          className={cn(
            'flex min-h-0 flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
            isCurrentWorkspaceEditor && 'pb-[42px]',
          )}
        >
          <div className="flex h-[66px] shrink-0 grow-0 items-center gap-3 px-[14px] pb-3 pt-[14px]">
            <div className="relative shrink-0">
              <AppIcon
                size="large"
                iconType={app.icon_type}
                icon={app.icon}
                background={app.icon_background}
                imageUrl={app.icon_url}
              />
              <AppTypeIcon type={app.mode} wrapperClassName="absolute -bottom-0.5 -right-0.5 w-4 h-4 shadow-sm" className="h-3 w-3" />
            </div>
            <div className="w-0 grow py-[1px]">
              <div className="flex items-center text-sm font-semibold leading-5 text-text-secondary">
                <div className="truncate" title={app.name}>{app.name}</div>
              </div>
              <div className="flex items-center gap-1 text-[10px] font-medium leading-[18px] text-text-tertiary">
                <div className="truncate" title={app.author_name}>{app.author_name}</div>
                <div>·</div>
                <div className="truncate" title={EditTimeText}>{EditTimeText}</div>
              </div>
            </div>
            <div className="flex h-5 w-5 shrink-0 items-center justify-center">
              {app.access_mode === AccessMode.PUBLIC && (
                <Tooltip>
                  <TooltipTrigger render={<span className="i-ri-global-line h-4 w-4 text-text-quaternary" />} />
                  <TooltipContent>{t('accessItemsDescription.anyone', { ns: 'app' })}</TooltipContent>
                </Tooltip>
              )}
              {app.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS && (
                <Tooltip>
                  <TooltipTrigger render={<span className="i-ri-lock-line h-4 w-4 text-text-quaternary" />} />
                  <TooltipContent>{t('accessItemsDescription.specific', { ns: 'app' })}</TooltipContent>
                </Tooltip>
              )}
              {app.access_mode === AccessMode.ORGANIZATION && (
                <Tooltip>
                  <TooltipTrigger render={<span className="i-ri-building-line h-4 w-4 text-text-quaternary" />} />
                  <TooltipContent>{t('accessItemsDescription.organization', { ns: 'app' })}</TooltipContent>
                </Tooltip>
              )}
              {app.access_mode === AccessMode.EXTERNAL_MEMBERS && (
                <Tooltip>
                  <TooltipTrigger render={<span className="i-ri-verified-badge-line h-4 w-4 text-text-quaternary" />} />
                  <TooltipContent>{t('accessItemsDescription.external', { ns: 'app' })}</TooltipContent>
                </Tooltip>
              )}
            </div>
            <div>
              {onlineUserAvatars.length > 0 ? <UserAvatarList users={onlineUserAvatars} maxVisible={3} size={20} /> : null}
            </div>
          </div>
          <div className="min-h-0 flex-1 px-[14px] text-xs leading-normal text-text-tertiary">
            <div
              className="line-clamp-2"
              title={app.description}
            >
              {app.description}
            </div>
          </div>
        </button>
        <div className="absolute bottom-1 left-0 right-0 flex h-[42px] shrink-0 items-center pb-[6px] pl-[14px] pr-[6px] pt-1">
          {isCurrentWorkspaceEditor && (
            <>
              <div className={cn('flex w-0 grow items-center gap-1')}>
                <div className={cn('mr-[41px] w-full grow group-hover:!mr-0', isOperationsOpen && '!mr-0')}>
                  <TagSelector
                    position="bl"
                    type="app"
                    targetID={app.id}
                    value={tags.map(tag => tag.id)}
                    selectedTags={tags}
                    onCacheUpdate={setTags}
                    onChange={onRefresh}
                  />
                </div>
              </div>
              <div
                className={cn(
                  'pointer-events-none invisible mx-1 h-[14px] w-[1px] shrink-0 bg-divider-regular opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100',
                  isOperationsOpen && 'pointer-events-auto visible opacity-100',
                )}
              />
              <div
                className={cn(
                  'pointer-events-none invisible shrink-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100',
                  isOperationsOpen && 'pointer-events-auto visible opacity-100',
                )}
              >
                <AppCardOperations
                  app={app}
                  open={isOperationsOpen}
                  webappAuthEnabled={systemFeatures.webapp_auth.enabled}
                  isCurrentWorkspaceEditor={isCurrentWorkspaceEditor}
                  exporting={exporting}
                  secretEnvListLength={secretEnvList.length}
                  isUpgradingRuntime={isUpgradingRuntime}
                  popupClassName={
                    (app.mode === AppModeEnum.COMPLETION || app.mode === AppModeEnum.CHAT)
                      ? 'w-[256px]'
                      : 'w-[216px]'
                  }
                  onOpenChange={setIsOperationsOpen}
                  onEdit={handleOpenEditModal}
                  onDuplicate={handleOpenDuplicateModal}
                  onExport={handleExport}
                  onSwitch={handleOpenSwitchModal}
                  onDelete={handleOpenDeleteModal}
                  onAccessControl={handleOpenAccessControl}
                  onInstalledApp={handleInstalledApp}
                  onUpgradeRuntime={handleUpgradeRuntime}
                />
              </div>
            </>
          )}
        </div>
      </div>
      {showEditModal && (
        <EditAppModal
          isEditModal
          appName={app.name}
          appIconType={app.icon_type}
          appIcon={app.icon}
          appIconBackground={app.icon_background}
          appIconUrl={app.icon_url}
          appDescription={app.description}
          appMode={app.mode}
          appUseIconAsAnswerIcon={app.use_icon_as_answer_icon}
          max_active_requests={app.max_active_requests ?? null}
          show={showEditModal}
          onConfirm={onEdit}
          onHide={() => setShowEditModal(false)}
        />
      )}
      {showDuplicateModal && (
        <DuplicateAppModal
          appName={app.name}
          icon_type={app.icon_type}
          icon={app.icon}
          icon_background={app.icon_background}
          icon_url={app.icon_url}
          show={showDuplicateModal}
          onConfirm={onCopy}
          onHide={() => setShowDuplicateModal(false)}
        />
      )}
      {showSwitchModal && (
        <SwitchAppModal
          show={showSwitchModal}
          appDetail={app}
          onClose={() => setShowSwitchModal(false)}
          onSuccess={onSwitch}
        />
      )}
      <AlertDialog open={showConfirmDelete} onOpenChange={onDeleteDialogOpenChange}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pb-4 pt-6">
            <AlertDialogTitle className="text-text-primary title-2xl-semi-bold">
              {t('deleteAppConfirmTitle', { ns: 'app' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full whitespace-pre-wrap break-words text-text-tertiary system-md-regular">
              {t('deleteAppConfirmContent', { ns: 'app' })}
            </AlertDialogDescription>
            <div className="mt-2">
              <label className="mb-1 block text-text-secondary system-sm-regular">
                {t('deleteAppConfirmInputLabel', { ns: 'app', appName: app.name })}
              </label>
              <input
                type="text"
                className="border-components-input-border bg-components-input-bg focus:border-components-input-border-focus focus:ring-components-input-border-focus h-9 w-full rounded-lg border px-3 text-sm text-text-primary placeholder:text-text-quaternary focus:outline-none focus:ring-1"
                placeholder={t('deleteAppConfirmInputPlaceholder', { ns: 'app' })}
                value={confirmDeleteInput}
                onChange={e => setConfirmDeleteInput(e.target.value)}
              />
            </div>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={isDeleting}>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={isDeleting}
              disabled={isDeleting || confirmDeleteInput !== app.name}
              onClick={onConfirmDelete}
            >
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
      {secretEnvList.length > 0 && (
        <DSLExportConfirmModal
          envList={secretEnvList}
          onConfirm={onExport}
          onClose={() => setSecretEnvList([])}
        />
      )}
      {showAccessControl && (
        <AccessControl app={app} onConfirm={onUpdateAccessControl} onClose={() => setShowAccessControl(false)} />
      )}
    </>
  )
}

export default React.memo(AppCard)
