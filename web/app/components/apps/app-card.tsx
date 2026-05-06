'use client'

import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import type { WorkflowOnlineUser } from '@/models/app'
import type { App } from '@/types/app'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@langgenius/dify-ui/tooltip'
import { useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useId, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import Input from '@/app/components/base/input'
import { UserAvatarList } from '@/app/components/base/user-avatar-list'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { AppCardTags } from '@/features/tag-management/components/app-card-tags'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { AccessMode } from '@/models/access-control'
import dynamic from '@/next/dynamic'
import { useRouter } from '@/next/navigation'
import { useGetUserCanAccessApp } from '@/service/access-control'
import { copyApp, exportAppConfig, updateAppInfo } from '@/service/apps'
import { fetchInstalledAppList } from '@/service/explore'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useDeleteAppMutation } from '@/service/use-apps'
import { fetchWorkflowDraft } from '@/service/workflow'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
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

type AppCardProps = {
  app: App
  onlineUsers?: WorkflowOnlineUser[]
  onRefresh?: () => void
  onOpenTagManagement?: () => void
}

type AppCardOperationsMenuProps = {
  app: App
  shouldShowSwitchOption: boolean
  shouldShowOpenInExploreOption: boolean
  shouldShowAccessControlOption: boolean
  onEdit: () => void
  onDuplicate: () => void
  onExport: () => void
  onSwitch: () => void
  onDelete: () => void
  onAccessControl: () => void
}

const AppCardOperationsMenu: React.FC<AppCardOperationsMenuProps> = ({
  app,
  shouldShowSwitchOption,
  shouldShowOpenInExploreOption,
  shouldShowAccessControlOption,
  onEdit,
  onDuplicate,
  onExport,
  onSwitch,
  onDelete,
  onAccessControl,
}) => {
  const { t } = useTranslation()
  const openAsyncWindow = useAsyncWindowOpen()

  const handleMenuAction = useCallback((e: React.MouseEvent<HTMLElement>, action: () => void) => {
    e.stopPropagation()
    e.preventDefault()
    action()
  }, [])

  const handleOpenInstalledApp = useCallback(async (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation()
    e.preventDefault()
    try {
      await openAsyncWindow(async () => {
        const { installed_apps } = await fetchInstalledAppList(app.id)
        if (installed_apps?.length > 0)
          return `${basePath}/explore/installed/${installed_apps[0]!.id}`
        throw new Error('No app found in Explore')
      }, {
        onError: (err) => {
          toast.error(`${err.message || err}`)
        },
      })
    }
    catch (e: unknown) {
      const message = e instanceof Error ? e.message : `${e}`
      toast.error(message)
    }
  }, [app.id, openAsyncWindow])

  return (
    <>
      <DropdownMenuItem className="gap-2 px-3" onClick={e => handleMenuAction(e, onEdit)}>
        <span className="system-sm-regular text-text-secondary">{t('editApp', { ns: 'app' })}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="gap-2 px-3" onClick={e => handleMenuAction(e, onDuplicate)}>
        <span className="system-sm-regular text-text-secondary">{t('duplicate', { ns: 'app' })}</span>
      </DropdownMenuItem>
      <DropdownMenuItem className="gap-2 px-3" onClick={e => handleMenuAction(e, onExport)}>
        <span className="system-sm-regular text-text-secondary">{t('export', { ns: 'app' })}</span>
      </DropdownMenuItem>
      {shouldShowSwitchOption && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 px-3" onClick={e => handleMenuAction(e, onSwitch)}>
            <span className="text-sm leading-5 text-text-secondary">{t('switch', { ns: 'app' })}</span>
          </DropdownMenuItem>
        </>
      )}
      {shouldShowOpenInExploreOption && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 px-3" onClick={handleOpenInstalledApp}>
            <span className="system-sm-regular text-text-secondary">{t('openInExplore', { ns: 'app' })}</span>
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuSeparator />
      {shouldShowAccessControlOption && (
        <>
          <DropdownMenuItem className="gap-2 px-3" onClick={e => handleMenuAction(e, onAccessControl)}>
            <span className="text-sm leading-5 text-text-secondary">{t('accessControl', { ns: 'app' })}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem
        variant="destructive"
        className="gap-2 px-3"
        onClick={e => handleMenuAction(e, onDelete)}
      >
        <span className="system-sm-regular">
          {t('operation.delete', { ns: 'common' })}
        </span>
      </DropdownMenuItem>
    </>
  )
}

type AppCardOperationsMenuContentProps = Omit<AppCardOperationsMenuProps, 'shouldShowOpenInExploreOption'>

const AppCardOperationsMenuContent: React.FC<AppCardOperationsMenuContentProps> = (props) => {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: userCanAccessApp, isLoading: isGettingUserCanAccessApp } = useGetUserCanAccessApp({
    appId: props.app.id,
    enabled: systemFeatures.webapp_auth.enabled,
  })

  const shouldShowOpenInExploreOption = !props.app.has_draft_trigger
    && (
      !systemFeatures.webapp_auth.enabled
      || (!isGettingUserCanAccessApp && Boolean(userCanAccessApp?.result))
    )

  return (
    <AppCardOperationsMenu
      {...props}
      shouldShowOpenInExploreOption={shouldShowOpenInExploreOption}
    />
  )
}

const AppCard = ({ app, onlineUsers = [], onRefresh, onOpenTagManagement = () => {} }: AppCardProps) => {
  const { t } = useTranslation()
  const deleteAppNameInputId = useId()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { onPlanInfoChanged } = useProviderContext()
  const { push } = useRouter()

  const [showEditModal, setShowEditModal] = useState(false)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [showSwitchModal, setShowSwitchModal] = useState<boolean>(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [confirmDeleteInput, setConfirmDeleteInput] = useState('')
  const [showAccessControl, setShowAccessControl] = useState(false)
  const [isOperationsMenuOpen, setIsOperationsMenuOpen] = useState(false)
  const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariable[]>([])
  const { mutateAsync: mutateDeleteApp, isPending: isDeleting } = useDeleteAppMutation()

  const onConfirmDelete = useCallback(async () => {
    try {
      await mutateDeleteApp(app.id)
      toast.success(t('appDeleted', { ns: 'app' }))
      onPlanInfoChanged()
      setShowConfirmDelete(false)
      setConfirmDeleteInput('')
    }
    catch (e) {
      const message = e instanceof Error ? e.message : ''
      toast.error(`${t('appDeleteFailed', { ns: 'app' })}${message ? `: ${message}` : ''}`)
    }
  }, [app.id, mutateDeleteApp, onPlanInfoChanged, t])

  const onDeleteDialogOpenChange = useCallback((open: boolean) => {
    if (isDeleting)
      return

    setShowConfirmDelete(open)
    if (!open)
      setConfirmDeleteInput('')
  }, [isDeleting])

  const isDeleteConfirmDisabled = isDeleting || confirmDeleteInput !== app.name

  const onDeleteDialogSubmit: React.FormEventHandler<HTMLFormElement> = useCallback((e) => {
    e.preventDefault()
    if (isDeleteConfirmDisabled)
      return

    void onConfirmDelete()
  }, [isDeleteConfirmDisabled, onConfirmDelete])

  const handleShowEditModal = useCallback(() => {
    setIsOperationsMenuOpen(false)
    queueMicrotask(() => {
      setShowEditModal(true)
    })
  }, [])

  const handleShowDuplicateModal = useCallback(() => {
    setIsOperationsMenuOpen(false)
    queueMicrotask(() => {
      setShowDuplicateModal(true)
    })
  }, [])

  const handleShowSwitchModal = useCallback(() => {
    setIsOperationsMenuOpen(false)
    queueMicrotask(() => {
      setShowSwitchModal(true)
    })
  }, [])

  const handleShowDeleteConfirm = useCallback(() => {
    setIsOperationsMenuOpen(false)
    queueMicrotask(() => {
      setShowConfirmDelete(true)
    })
  }, [])

  const handleShowAccessControl = useCallback(() => {
    setIsOperationsMenuOpen(false)
    queueMicrotask(() => {
      setShowAccessControl(true)
    })
  }, [])

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
    catch (e) {
      toast.error(e instanceof Error ? e.message : t('editFailed', { ns: 'app' }))
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
    setIsOperationsMenuOpen(false)
    if (app.mode !== AppModeEnum.WORKFLOW && app.mode !== AppModeEnum.ADVANCED_CHAT) {
      onExport()
      return
    }
    try {
      const workflowDraft = await fetchWorkflowDraft(`/apps/${app.id}/workflows/draft`)
      const list = (workflowDraft.environment_variables || []).filter(env => env.value_type === 'secret')
      if (list.length === 0) {
        onExport()
        return
      }
      setSecretEnvList(list)
    }
    catch {
      toast.error(t('exportFailed', { ns: 'app' }))
    }
  }

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

  const shouldShowSwitchOption = app.mode === AppModeEnum.COMPLETION || app.mode === AppModeEnum.CHAT
  const shouldShowAccessControlOption = systemFeatures.webapp_auth.enabled && isCurrentWorkspaceEditor
  const operationsMenuWidthClassName = shouldShowSwitchOption ? 'w-[256px]' : 'w-[216px]'

  const EditTimeText = useMemo(() => {
    const timeText = formatTime({
      date: (app.updated_at || app.created_at) * 1000,
      dateFormat: `${t('segment.dateTimeFormat', { ns: 'datasetDocuments' })}`,
    })
    return `${t('segment.editedAt', { ns: 'datasetDocuments' })} ${timeText}`
  }, [app.updated_at, app.created_at, t])

  const onlinePresenceUsers = useMemo(() => {
    return onlineUsers
      .map((user, index) => {
        const id = user.user_id || user.sid || `${app.id}-online-${index}`
        const name = user.username || user.user_id || user.sid || `${index + 1}`
        return {
          id,
          name,
          avatar_url: user.avatar || null,
        }
      })
      .filter(user => Boolean(user.id))
  }, [app.id, onlineUsers])

  return (
    <>
      <div
        onClick={(e) => {
          e.preventDefault()
          getRedirection(isCurrentWorkspaceEditor, app, push)
        }}
        className="group relative col-span-1 inline-flex h-[160px] cursor-pointer flex-col rounded-xl border border-solid border-components-card-border bg-components-card-bg shadow-sm transition-all duration-200 ease-in-out hover:shadow-lg"
      >
        <div className="flex h-[66px] shrink-0 grow-0 items-center gap-3 px-[14px] pt-[14px] pb-3">
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
          <div className="w-0 grow py-px">
            <div className="flex items-center text-sm leading-5 font-semibold text-text-secondary">
              <div className="truncate" title={app.name}>{app.name}</div>
            </div>
            <div className="flex items-center gap-1 text-[10px] leading-[18px] font-medium text-text-tertiary">
              <div className="truncate" title={app.author_name}>{app.author_name}</div>
              <div>·</div>
              <div className="truncate" title={EditTimeText}>{EditTimeText}</div>
            </div>
          </div>
          <div className="flex h-full shrink-0 flex-col items-end justify-between py-px">
            {onlinePresenceUsers.length > 0 && (
              <UserAvatarList users={onlinePresenceUsers} size="xxs" maxVisible={3} className="justify-end" />
            )}
            <div className="flex h-5 w-5 items-center justify-center">
              {app.access_mode === AccessMode.PUBLIC && (
                <Tooltip>
                  <TooltipTrigger
                    aria-label={t('accessItemsDescription.anyone', { ns: 'app' })}
                    render={<span title={t('accessItemsDescription.anyone', { ns: 'app' })} className="i-ri-global-line h-4 w-4 text-text-quaternary" />}
                  />
                  <TooltipContent>{t('accessItemsDescription.anyone', { ns: 'app' })}</TooltipContent>
                </Tooltip>
              )}
              {app.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS && (
                <Tooltip>
                  <TooltipTrigger
                    aria-label={t('accessItemsDescription.specific', { ns: 'app' })}
                    render={<span title={t('accessItemsDescription.specific', { ns: 'app' })} className="i-ri-lock-line h-4 w-4 text-text-quaternary" />}
                  />
                  <TooltipContent>{t('accessItemsDescription.specific', { ns: 'app' })}</TooltipContent>
                </Tooltip>
              )}
              {app.access_mode === AccessMode.ORGANIZATION && (
                <Tooltip>
                  <TooltipTrigger
                    aria-label={t('accessItemsDescription.organization', { ns: 'app' })}
                    render={<span title={t('accessItemsDescription.organization', { ns: 'app' })} className="i-ri-building-line h-4 w-4 text-text-quaternary" />}
                  />
                  <TooltipContent>{t('accessItemsDescription.organization', { ns: 'app' })}</TooltipContent>
                </Tooltip>
              )}
              {app.access_mode === AccessMode.EXTERNAL_MEMBERS && (
                <Tooltip>
                  <TooltipTrigger
                    aria-label={t('accessItemsDescription.external', { ns: 'app' })}
                    render={<span title={t('accessItemsDescription.external', { ns: 'app' })} className="i-ri-verified-badge-line h-4 w-4 text-text-quaternary" />}
                  />
                  <TooltipContent>{t('accessItemsDescription.external', { ns: 'app' })}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
        <div className="h-[90px] px-[14px] text-xs leading-normal text-text-tertiary">
          <div
            className="line-clamp-2"
            title={app.description}
          >
            {app.description}
          </div>
        </div>
        <div className="absolute right-0 bottom-1 left-0 flex h-[42px] shrink-0 items-center pt-1 pr-[6px] pb-[6px] pl-[14px]">
          {isCurrentWorkspaceEditor && (
            <>
              <div
                className={cn('flex w-0 grow items-center gap-1')}
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                }}
              >
                <div className="mr-[41px] min-w-0 grow overflow-hidden">
                  <AppCardTags
                    appId={app.id}
                    tags={app.tags}
                    onOpenTagManagement={onOpenTagManagement}
                    onTagsChange={onRefresh}
                  />
                </div>
              </div>
              <div
                className={cn(
                  'absolute top-1/2 right-[6px] flex -translate-y-1/2 items-center transition-opacity',
                  isOperationsMenuOpen
                    ? 'pointer-events-auto opacity-100'
                    : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100',
                )}
              >
                <div className="mx-1 h-[14px] w-px shrink-0 bg-divider-regular" />
                <DropdownMenu modal={false} open={isOperationsMenuOpen} onOpenChange={setIsOperationsMenuOpen}>
                  <DropdownMenuTrigger
                    aria-label={t('operation.more', { ns: 'common' })}
                    className={cn(
                      isOperationsMenuOpen ? 'bg-state-base-hover shadow-none' : 'bg-transparent',
                      'flex h-8 w-8 items-center justify-center rounded-md border-none p-2 hover:bg-state-base-hover',
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                    }}
                  >
                    <div className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md">
                      <span className="sr-only">{t('operation.more', { ns: 'common' })}</span>
                      <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    placement="bottom-end"
                    sideOffset={4}
                    popupClassName={operationsMenuWidthClassName}
                  >
                    {systemFeatures.webapp_auth.enabled
                      ? (
                          <AppCardOperationsMenuContent
                            app={app}
                            shouldShowSwitchOption={shouldShowSwitchOption}
                            shouldShowAccessControlOption={shouldShowAccessControlOption}
                            onEdit={handleShowEditModal}
                            onDuplicate={handleShowDuplicateModal}
                            onExport={exportCheck}
                            onSwitch={handleShowSwitchModal}
                            onDelete={handleShowDeleteConfirm}
                            onAccessControl={handleShowAccessControl}
                          />
                        )
                      : (
                          <AppCardOperationsMenu
                            app={app}
                            shouldShowSwitchOption={shouldShowSwitchOption}
                            shouldShowOpenInExploreOption={!app.has_draft_trigger}
                            shouldShowAccessControlOption={shouldShowAccessControlOption}
                            onEdit={handleShowEditModal}
                            onDuplicate={handleShowDuplicateModal}
                            onExport={exportCheck}
                            onSwitch={handleShowSwitchModal}
                            onDelete={handleShowDeleteConfirm}
                            onAccessControl={handleShowAccessControl}
                          />
                        )}
                  </DropdownMenuContent>
                </DropdownMenu>
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
          <form className="flex flex-col" onSubmit={onDeleteDialogSubmit}>
            <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
              <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
                {t('deleteAppConfirmTitle', { ns: 'app' })}
              </AlertDialogTitle>
              <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                {t('deleteAppConfirmContent', { ns: 'app' })}
              </AlertDialogDescription>
              <div className="mt-2">
                <label htmlFor={deleteAppNameInputId} className="mb-1 block system-sm-regular text-text-secondary">
                  <Trans
                    i18nKey="deleteAppConfirmInputLabel"
                    ns="app"
                    values={{ appName: app.name }}
                    components={{
                      appName: <span className="system-sm-semibold text-text-primary" translate="no" />,
                    }}
                  />
                </label>
                <Input
                  id={deleteAppNameInputId}
                  name="confirm-app-name"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('deleteAppConfirmInputPlaceholder', { ns: 'app' })}
                  value={confirmDeleteInput}
                  onChange={e => setConfirmDeleteInput(e.target.value)}
                  className="border-components-input-border-hover bg-components-input-bg-normal focus:border-components-input-border-active focus:bg-components-input-bg-active"
                />
              </div>
            </div>
            <AlertDialogActions>
              <AlertDialogCancelButton type="button" disabled={isDeleting}>
                {t('operation.cancel', { ns: 'common' })}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton
                type="submit"
                loading={isDeleting}
                disabled={isDeleteConfirmDisabled}
              >
                {t('operation.confirm', { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogActions>
          </form>
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
