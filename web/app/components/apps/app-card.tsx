'use client'

import type {
  AppPartial,
  EnvironmentVariableItemResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { FormEventHandler, MouseEvent } from 'react'
import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { WorkflowOnlineUser } from '@/models/app'
import { zIconType } from '@dify/contracts/api/console/apps/zod.gen'
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
import { Field, FieldControl, FieldLabel } from '@langgenius/dify-ui/field'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useId, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import { useExportAppDsl, useExportWorkflowAppDsl } from '@/app/components/app/use-export-app-dsl'
import AppIcon from '@/app/components/base/app-icon'
import StarIcon from '@/app/components/base/icons/src/vender/Star'
import { UserAvatarList } from '@/app/components/base/user-avatar-list'
import { buildInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import {
  getStepByStepTourDropdownMenuContentProps,
  useStepByStepTourControlledDropdown,
} from '@/app/components/step-by-step-tour/dropdown-menu'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useProviderContext } from '@/context/provider-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { AppCardTags } from '@/features/tag-management/components/app-card-tags'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { AccessMode, isAccessMode } from '@/models/access-control'
import dynamic from '@/next/dynamic'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { useGetUserCanAccessApp } from '@/service/access-control/use-app-access-control'
import { consoleQuery } from '@/service/client'
import { fetchInstalledAppList } from '@/service/explore'
import { AppModeEnum } from '@/types/app'
import { getRedirection, getRedirectionPath } from '@/utils/app-redirection'
import {
  getAppACLCapabilities,
  hasOnlyAppPreviewPermission,
  hasPermission,
} from '@/utils/permission'
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
const DSLExportConfirmModal = dynamic(
  () => import('@/app/components/workflow/dsl-export-confirm-modal'),
  {
    ssr: false,
  },
)
const AccessControl = dynamic(() => import('@/app/components/app/app-access-control'), {
  ssr: false,
})

const ACCESS_MODE_ICON_CLASS_NAMES: Record<AccessMode, string> = {
  [AccessMode.PUBLIC]: 'i-ri-global-line',
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: 'i-ri-lock-line',
  [AccessMode.ORGANIZATION]: 'i-ri-building-line',
  [AccessMode.EXTERNAL_MEMBERS]: 'i-ri-verified-badge-line',
}

const ACCESS_MODE_LABEL_KEYS = {
  [AccessMode.PUBLIC]: 'accessItemsDescription.anyone',
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: 'accessItemsDescription.specific',
  [AccessMode.ORGANIZATION]: 'accessItemsDescription.organization',
  [AccessMode.EXTERNAL_MEMBERS]: 'accessItemsDescription.external',
} as const

const APP_MODES_REQUIRING_PUBLISHED_WORKFLOW_IN_EXPLORE = new Set<AppPartial['mode']>([
  AppModeEnum.ADVANCED_CHAT,
  AppModeEnum.WORKFLOW,
])
const OPERATIONS_MENU_POPUP_CLASS_NAME = 'min-w-[216px]'
const EMPTY_ONLINE_USERS: WorkflowOnlineUser[] = []

type AppCardProps = {
  app: AppPartial
  onlineUsers?: WorkflowOnlineUser[]
  onOpenTagManagement?: () => void
  stepByStepTourActionMenuOpen?: boolean
  stepByStepTourCardTarget?: string
  stepByStepTourCardHighlightPart?: string
  stepByStepTourActionMenuHighlightPart?: string
}

type AppAccessModeIconProps = {
  accessMode?: AccessMode | null
}

function requiresPublishedWorkflowInExplore(app: AppPartial) {
  return APP_MODES_REQUIRING_PUBLISHED_WORKFLOW_IN_EXPLORE.has(app.mode)
}

function AppAccessModeIcon({ accessMode }: AppAccessModeIconProps) {
  const { t } = useTranslation()

  if (!accessMode) return null

  const iconClassName = ACCESS_MODE_ICON_CLASS_NAMES[accessMode]
  const labelKey = ACCESS_MODE_LABEL_KEYS[accessMode]

  if (!iconClassName || !labelKey) return null

  const label = t(($) => $[labelKey], { ns: 'app' })

  return (
    <div className="absolute right-3 bottom-3 flex size-4 items-center justify-center">
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="img"
              aria-label={label}
              className={cn(iconClassName, 'size-4 text-text-quaternary')}
            />
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </div>
  )
}

type AppCardOperationsMenuProps = {
  app: AppPartial
  shouldShowEditOption: boolean
  shouldShowDuplicateOption: boolean
  shouldShowExportOption: boolean
  shouldShowSwitchOption: boolean
  shouldShowOpenInExploreOption: boolean
  shouldShowAccessControlOption: boolean
  shouldShowAccessConfigOption: boolean
  shouldShowDeleteOption: boolean
  isExporting: boolean
  onEdit: () => void
  onDuplicate: () => void
  onExport: () => void
  onSwitch: () => void
  onDelete: () => void
  onAccessControl: () => void
  onAccessConfig: () => void
}

function AppCardOperationsMenu({
  app,
  shouldShowEditOption,
  shouldShowDuplicateOption,
  shouldShowExportOption,
  shouldShowSwitchOption,
  shouldShowOpenInExploreOption,
  shouldShowAccessControlOption,
  shouldShowAccessConfigOption,
  shouldShowDeleteOption,
  isExporting,
  onEdit,
  onDuplicate,
  onExport,
  onSwitch,
  onDelete,
  onAccessControl,
  onAccessConfig,
}: AppCardOperationsMenuProps) {
  const { t } = useTranslation()
  const openAsyncWindow = useAsyncWindowOpen()
  const hasEditGroup = shouldShowEditOption
  const hasCreateExportGroup = shouldShowDuplicateOption || shouldShowExportOption
  const hasSwitchOrExploreGroup = shouldShowSwitchOption || shouldShowOpenInExploreOption
  const hasAccessDeleteGroup =
    shouldShowAccessControlOption || shouldShowAccessConfigOption || shouldShowDeleteOption

  function handleMenuAction(e: MouseEvent<HTMLElement>, action: () => void) {
    e.stopPropagation()
    e.preventDefault()
    action()
  }

  async function handleOpenInstalledApp(e: MouseEvent<HTMLElement>) {
    e.stopPropagation()
    e.preventDefault()
    if (requiresPublishedWorkflowInExplore(app) && !app.workflow?.id) {
      toast.error(t(($) => $.notPublishedYet, { ns: 'app' }))
      return
    }

    try {
      await openAsyncWindow(
        async () => {
          const { installed_apps } = await fetchInstalledAppList(app.id)
          if (installed_apps?.length > 0)
            return `${basePath}${buildInstalledAppPath(installed_apps[0]!.id)}`
          throw new Error(t(($) => $.notPublishedYet, { ns: 'app' }))
        },
        {
          onError: (err) => {
            toast.error(`${err.message || err}`)
          },
        },
      )
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : `${e}`
      toast.error(message)
    }
  }

  return (
    <>
      {shouldShowEditOption && (
        <DropdownMenuItem className="gap-2 px-3" onClick={(e) => handleMenuAction(e, onEdit)}>
          <span className="system-sm-regular text-text-secondary">
            {t(($) => $.editApp, { ns: 'app' })}
          </span>
        </DropdownMenuItem>
      )}
      {hasEditGroup &&
        (hasCreateExportGroup || hasSwitchOrExploreGroup || hasAccessDeleteGroup) && (
          <DropdownMenuSeparator />
        )}
      {shouldShowDuplicateOption && (
        <DropdownMenuItem className="gap-2 px-3" onClick={(e) => handleMenuAction(e, onDuplicate)}>
          <span className="system-sm-regular text-text-secondary">
            {t(($) => $.duplicate, { ns: 'app' })}
          </span>
        </DropdownMenuItem>
      )}
      {shouldShowExportOption && (
        <DropdownMenuItem
          className="gap-2 px-3"
          disabled={isExporting}
          onClick={(e) => handleMenuAction(e, onExport)}
        >
          <span className="system-sm-regular text-text-secondary">
            {t(($) => $.export, { ns: 'app' })}
          </span>
        </DropdownMenuItem>
      )}
      {hasCreateExportGroup && (hasSwitchOrExploreGroup || hasAccessDeleteGroup) && (
        <DropdownMenuSeparator />
      )}
      {shouldShowSwitchOption && (
        <DropdownMenuItem className="gap-2 px-3" onClick={(e) => handleMenuAction(e, onSwitch)}>
          <span className="text-sm/5 text-text-secondary">{t(($) => $.switch, { ns: 'app' })}</span>
        </DropdownMenuItem>
      )}
      {shouldShowOpenInExploreOption && (
        <DropdownMenuItem className="gap-2 px-3" onClick={handleOpenInstalledApp}>
          <span className="system-sm-regular text-text-secondary">
            {t(($) => $.openInExplore, { ns: 'app' })}
          </span>
        </DropdownMenuItem>
      )}
      {hasSwitchOrExploreGroup && hasAccessDeleteGroup && <DropdownMenuSeparator />}
      {shouldShowAccessControlOption && (
        <DropdownMenuItem
          className="gap-2 px-3"
          onClick={(e) => handleMenuAction(e, onAccessControl)}
        >
          <span className="text-sm/5 text-text-secondary">
            {t(($) => $.accessControl, { ns: 'app' })}
          </span>
        </DropdownMenuItem>
      )}
      {shouldShowAccessConfigOption && (
        <DropdownMenuItem
          className="gap-2 px-3"
          onClick={(e) => handleMenuAction(e, onAccessConfig)}
        >
          <span className="text-sm/5 text-text-secondary">
            {t(($) => $['settings.resourceAccess'], { ns: 'common' })}
          </span>
        </DropdownMenuItem>
      )}
      {(shouldShowAccessControlOption || shouldShowAccessConfigOption) &&
        shouldShowDeleteOption && <DropdownMenuSeparator />}
      {shouldShowDeleteOption && (
        <DropdownMenuItem
          variant="destructive"
          className="gap-2 px-3"
          onClick={(e) => handleMenuAction(e, onDelete)}
        >
          <span className="system-sm-regular">
            {t(($) => $['operation.delete'], { ns: 'common' })}
          </span>
        </DropdownMenuItem>
      )}
    </>
  )
}

type AppCardOperationsMenuContentProps = Omit<
  AppCardOperationsMenuProps,
  'shouldShowOpenInExploreOption'
>

function AppCardOperationsMenuContent(props: AppCardOperationsMenuContentProps) {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: userCanAccessApp, isLoading: isGettingUserCanAccessApp } = useGetUserCanAccessApp({
    appId: props.app.id,
    enabled: systemFeatures.webapp_auth.enabled,
  })
  const needsPublishBeforeExplore =
    requiresPublishedWorkflowInExplore(props.app) && !props.app.workflow?.id

  const shouldShowOpenInExploreOption =
    !props.app.has_draft_trigger &&
    (needsPublishBeforeExplore ||
      !systemFeatures.webapp_auth.enabled ||
      (!isGettingUserCanAccessApp && Boolean(userCanAccessApp?.result)))

  return (
    <AppCardOperationsMenu
      {...props}
      shouldShowOpenInExploreOption={shouldShowOpenInExploreOption}
    />
  )
}

type AppCardActionBarProps = {
  app: AppPartial
  stepByStepTourActionMenuOpen?: boolean
  stepByStepTourActionMenuHighlightPart?: string
}

export const AppCardActionBar = memo(
  ({
    app,
    stepByStepTourActionMenuOpen = false,
    stepByStepTourActionMenuHighlightPart,
  }: AppCardActionBarProps) => {
    const { t } = useTranslation()
    const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
    const currentUserId = useAtomValue(userProfileIdAtom)
    const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
    const isRbacEnabled = systemFeatures.rbac_enabled
    const { onPlanInfoChanged } = useProviderContext()
    const { push } = useRouter()
    const { mutate: copyApp } = useMutation(consoleQuery.apps.byAppId.copy.post.mutationOptions())
    const { mutateAsync: updateApp } = useMutation(consoleQuery.apps.byAppId.put.mutationOptions())
    const { mutate: deleteApp, isPending: isDeleting } = useMutation(
      consoleQuery.apps.byAppId.delete.mutationOptions(),
    )
    const { mutate: starApp, isPending: isStarring } = useMutation(
      consoleQuery.apps.byAppId.star.post.mutationOptions(),
    )
    const { mutate: unstarApp, isPending: isUnstarring } = useMutation(
      consoleQuery.apps.byAppId.star.delete.mutationOptions(),
    )

    const [showEditModal, setShowEditModal] = useState(false)
    const [showDuplicateModal, setShowDuplicateModal] = useState(false)
    const [showSwitchModal, setShowSwitchModal] = useState<boolean>(false)
    const [showConfirmDelete, setShowConfirmDelete] = useState(false)
    const [confirmDeleteInput, setConfirmDeleteInput] = useState('')
    const [showAccessControl, setShowAccessControl] = useState(false)
    const operationsMenu = useStepByStepTourControlledDropdown({
      allowTriggerCloseWhileControlled: false,
      controlledOpen: stepByStepTourActionMenuOpen,
    })
    const isOperationsMenuOpen = operationsMenu.open
    const setIsOperationsMenuOpen = operationsMenu.onOpenChange
    const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariableItemResponse[]>([])
    const { exportAppDsl, isExporting: isAppDslExporting } = useExportAppDsl()
    const { exportWorkflowAppDsl, isExporting: isWorkflowAppDslExporting } =
      useExportWorkflowAppDsl()
    const isExporting = isAppDslExporting || isWorkflowAppDslExporting
    const isTogglingStar = isStarring || isUnstarring
    const appIconType = zIconType.safeParse(app.icon_type).data ?? null
    const resourceMaintainer = app.maintainer ?? undefined
    const maintainerPermissionOptions = useMemo(
      () => ({
        currentUserId,
        resourceMaintainer,
        workspacePermissionKeys,
        isRbacEnabled,
      }),
      [currentUserId, isRbacEnabled, resourceMaintainer, workspacePermissionKeys],
    )
    const appACLCapabilities = useMemo(
      () => getAppACLCapabilities(app.permission_keys, maintainerPermissionOptions),
      [app.permission_keys, maintainerPermissionOptions],
    )
    const isPreviewOnly = hasOnlyAppPreviewPermission(app.permission_keys)
    const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')

    const onConfirmDelete = useCallback(() => {
      try {
        deleteApp(
          { params: { app_id: app.id } },
          {
            onSuccess: () => {
              toast.success(t(($) => $.appDeleted, { ns: 'app' }))
              onPlanInfoChanged()
              setShowConfirmDelete(false)
              setConfirmDeleteInput('')
            },
            onError: (error) => {
              const message = error instanceof Error ? error.message : ''
              toast.error(
                `${t(($) => $.appDeleteFailed, { ns: 'app' })}${message ? `: ${message}` : ''}`,
              )
            },
          },
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        toast.error(`${t(($) => $.appDeleteFailed, { ns: 'app' })}${message ? `: ${message}` : ''}`)
      }
    }, [app.id, deleteApp, onPlanInfoChanged, t])

    const onDeleteDialogOpenChange = useCallback(
      (open: boolean) => {
        if (isDeleting) return

        setShowConfirmDelete(open)
        if (!open) setConfirmDeleteInput('')
      },
      [isDeleting],
    )

    const isDeleteConfirmDisabled = isDeleting || confirmDeleteInput !== app.name

    const onDeleteDialogSubmit: FormEventHandler<HTMLFormElement> = useCallback(
      (e) => {
        e.preventDefault()
        if (isDeleteConfirmDisabled) return

        void onConfirmDelete()
      },
      [isDeleteConfirmDisabled, onConfirmDelete],
    )

    const handleShowEditModal = useCallback(() => {
      setIsOperationsMenuOpen(false)
      queueMicrotask(() => {
        setShowEditModal(true)
      })
    }, [setIsOperationsMenuOpen])

    const handleShowDuplicateModal = useCallback(() => {
      setIsOperationsMenuOpen(false)
      queueMicrotask(() => {
        setShowDuplicateModal(true)
      })
    }, [setIsOperationsMenuOpen])

    const handleShowSwitchModal = useCallback(() => {
      setIsOperationsMenuOpen(false)
      queueMicrotask(() => {
        setShowSwitchModal(true)
      })
    }, [setIsOperationsMenuOpen])

    const handleShowDeleteConfirm = useCallback(() => {
      setIsOperationsMenuOpen(false)
      queueMicrotask(() => {
        setShowConfirmDelete(true)
      })
    }, [setIsOperationsMenuOpen])

    const handleShowAccessControl = useCallback(() => {
      setIsOperationsMenuOpen(false)
      queueMicrotask(() => {
        setShowAccessControl(true)
      })
    }, [setIsOperationsMenuOpen])

    const handleOpenAccessConfig = useCallback(() => {
      setIsOperationsMenuOpen(false)
      push(`/app/${app.id}/access-config`)
    }, [app.id, push, setIsOperationsMenuOpen])

    const onEdit: CreateAppModalProps['onConfirm'] = useCallback(
      async ({
        name,
        icon_type,
        icon,
        icon_background,
        description,
        use_icon_as_answer_icon,
        max_active_requests,
      }) => {
        try {
          await updateApp({
            params: { app_id: app.id },
            body: {
              name,
              icon_type,
              icon,
              icon_background,
              description,
              use_icon_as_answer_icon,
              max_active_requests,
            },
          })
          setShowEditModal(false)
          toast.success(t(($) => $.editDone, { ns: 'app' }))
        } catch (e) {
          toast.error(e instanceof Error ? e.message : t(($) => $.editFailed, { ns: 'app' }))
        }
      },
      [app.id, t, updateApp],
    )

    const onCopy: DuplicateAppModalProps['onConfirm'] = ({
      name,
      icon_type,
      icon,
      icon_background,
    }) => {
      try {
        copyApp(
          {
            params: { app_id: app.id },
            body: {
              name,
              icon_type,
              icon,
              icon_background,
            },
          },
          {
            onSuccess: (newApp) => {
              if (!('mode' in newApp)) {
                toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
                return
              }

              setShowDuplicateModal(false)
              toast.success(t(($) => $['newApp.appCreated'], { ns: 'app' }))
              onPlanInfoChanged()
              getRedirection(newApp, push, {
                currentUserId,
                resourceMaintainer: newApp.maintainer ?? undefined,
                workspacePermissionKeys,
                isRbacEnabled,
              })
            },
            onError: () => toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' })),
          },
        )
      } catch {
        toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
      }
      return Promise.resolve()
    }

    const onExport = async (include = false) => {
      await exportAppDsl({ appId: app.id, appName: app.name, includeSecret: include })
    }

    const exportCheck = async () => {
      if (isExporting) return

      setIsOperationsMenuOpen(false)
      const isWorkflowApp =
        app.mode === AppModeEnum.WORKFLOW || app.mode === AppModeEnum.ADVANCED_CHAT
      const result = isWorkflowApp
        ? await exportWorkflowAppDsl({ appId: app.id, appName: app.name })
        : await exportAppDsl({ appId: app.id, appName: app.name })
      if (result?.status === 'confirmation-required') setSecretEnvList(result.secretEnvList)
    }

    const onUpdateAccessControl = useCallback(() => {
      setShowAccessControl(false)
    }, [])

    const handleToggleStar = useCallback(
      (e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation()
        e.preventDefault()

        if (isTogglingStar) return

        const mutateStar = app.is_starred ? unstarApp : starApp
        try {
          mutateStar(
            { params: { app_id: app.id } },
            {
              onError: (error) =>
                toast.error(
                  error instanceof Error
                    ? error.message
                    : t(($) => $['studio.starFailed'], { ns: 'app' }),
                ),
            },
          )
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : t(($) => $['studio.starFailed'], { ns: 'app' }),
          )
        }
      },
      [app.id, app.is_starred, isTogglingStar, starApp, t, unstarApp],
    )

    const shouldShowEditOption = appACLCapabilities.canEdit
    const shouldShowDuplicateOption = canCreateApp
    const shouldShowExportOption = appACLCapabilities.canImportExportDSL
    const shouldShowSwitchOption =
      appACLCapabilities.canEdit &&
      (app.mode === AppModeEnum.COMPLETION || app.mode === AppModeEnum.CHAT)
    const shouldShowAccessControlOption =
      systemFeatures.webapp_auth.enabled && appACLCapabilities.canReleaseAndVersion
    const shouldShowAccessConfigOption = appACLCapabilities.canAccessConfig
    const shouldShowDeleteOption = appACLCapabilities.canDelete
    const shouldShowOperationsMenu =
      shouldShowEditOption ||
      shouldShowDuplicateOption ||
      shouldShowExportOption ||
      shouldShowSwitchOption ||
      shouldShowAccessControlOption ||
      shouldShowAccessConfigOption ||
      shouldShowDeleteOption
    const starActionLabel = app.is_starred
      ? t(($) => $['studio.unstarApp'], { ns: 'app' })
      : t(($) => $['studio.starApp'], { ns: 'app' })

    return (
      <>
        {!isPreviewOnly && (
          <div
            className={cn(
              'absolute top-2 right-2 flex items-center overflow-hidden rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg backdrop-blur-xs transition-opacity',
              isOperationsMenuOpen || isExporting
                ? 'pointer-events-auto opacity-100'
                : 'pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100',
            )}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={starActionLabel}
                    disabled={isTogglingStar}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-70"
                    onClick={handleToggleStar}
                  >
                    <StarIcon
                      aria-hidden
                      className={cn(
                        app.is_starred ? 'text-text-warning-secondary' : 'text-text-tertiary',
                        'size-4.5',
                      )}
                    />
                  </button>
                }
              />
              <TooltipContent>{starActionLabel}</TooltipContent>
            </Tooltip>
            {shouldShowOperationsMenu && (
              <DropdownMenu
                modal={false}
                open={isOperationsMenuOpen}
                onOpenChange={setIsOperationsMenuOpen}
              >
                <DropdownMenuTrigger
                  aria-label={
                    isExporting
                      ? t(($) => $['operation.exporting'], { ns: 'common' })
                      : t(($) => $['operation.moreActionsFor'], {
                          ns: 'common',
                          name: app.name,
                        })
                  }
                  disabled={isExporting}
                  className={cn(
                    'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden disabled:cursor-not-allowed data-popup-open:bg-state-base-hover',
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                  }}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'h-4.5 w-4.5 text-text-tertiary',
                      isExporting
                        ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none'
                        : 'i-ri-more-fill',
                    )}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  placement="bottom-end"
                  sideOffset={4}
                  {...getStepByStepTourDropdownMenuContentProps({
                    highlightPart: stepByStepTourActionMenuHighlightPart,
                    interactionMode: operationsMenu.controlled ? 'presentation' : 'interactive',
                    popupClassName: OPERATIONS_MENU_POPUP_CLASS_NAME,
                  })}
                >
                  <AppCardOperationsMenuContent
                    app={app}
                    shouldShowEditOption={shouldShowEditOption}
                    shouldShowDuplicateOption={shouldShowDuplicateOption}
                    shouldShowExportOption={shouldShowExportOption}
                    shouldShowSwitchOption={shouldShowSwitchOption}
                    shouldShowAccessControlOption={shouldShowAccessControlOption}
                    shouldShowAccessConfigOption={shouldShowAccessConfigOption}
                    shouldShowDeleteOption={shouldShowDeleteOption}
                    isExporting={isExporting}
                    onEdit={handleShowEditModal}
                    onDuplicate={handleShowDuplicateModal}
                    onExport={exportCheck}
                    onSwitch={handleShowSwitchModal}
                    onDelete={handleShowDeleteConfirm}
                    onAccessControl={handleShowAccessControl}
                    onAccessConfig={handleOpenAccessConfig}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
        {showEditModal && (
          <EditAppModal
            isEditModal
            appName={app.name}
            appIconType={appIconType}
            appIcon={app.icon ?? ''}
            appIconBackground={app.icon_background}
            appIconUrl={app.icon_url}
            appDescription={app.description ?? ''}
            appMode={app.mode}
            appUseIconAsAnswerIcon={app.use_icon_as_answer_icon ?? false}
            max_active_requests={app.max_active_requests ?? null}
            show={showEditModal}
            onConfirm={onEdit}
            onHide={() => setShowEditModal(false)}
          />
        )}
        {showDuplicateModal && (
          <DuplicateAppModal
            appName={app.name}
            icon_type={appIconType}
            icon={app.icon ?? ''}
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
          />
        )}
        <AlertDialog open={showConfirmDelete} onOpenChange={onDeleteDialogOpenChange}>
          <AlertDialogContent>
            <form className="flex flex-col" onSubmit={onDeleteDialogSubmit}>
              <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
                  {t(($) => $.deleteAppConfirmTitle, { ns: 'app' })}
                </AlertDialogTitle>
                <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                  {t(($) => $.deleteAppConfirmContent, { ns: 'app' })}
                </AlertDialogDescription>
                <Field name="confirm-app-name" className="mt-2">
                  <FieldLabel className="mb-1 block py-0 system-sm-regular text-text-secondary">
                    <Trans
                      i18nKey={($) => $.deleteAppConfirmInputLabel}
                      ns="app"
                      values={{ appName: app.name }}
                      components={{
                        appName: (
                          <span className="system-sm-semibold text-text-primary" translate="no" />
                        ),
                      }}
                    />
                  </FieldLabel>
                  <FieldControl
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t(($) => $.deleteAppConfirmInputPlaceholder, { ns: 'app' })}
                    value={confirmDeleteInput}
                    onValueChange={setConfirmDeleteInput}
                    className="border-components-input-border-hover bg-components-input-bg-normal focus:border-components-input-border-active focus:bg-components-input-bg-active"
                  />
                </Field>
              </div>
              <AlertDialogActions>
                <AlertDialogCancelButton type="button" disabled={isDeleting}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton
                  type="submit"
                  loading={isDeleting}
                  disabled={isDeleteConfirmDisabled}
                >
                  {t(($) => $['operation.confirm'], { ns: 'common' })}
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
          <AccessControl
            app={app}
            onConfirm={onUpdateAccessControl}
            onClose={() => setShowAccessControl(false)}
          />
        )}
      </>
    )
  },
)

export const AppCard = memo(
  ({
    app,
    onlineUsers = EMPTY_ONLINE_USERS,
    onOpenTagManagement,
    stepByStepTourActionMenuOpen = false,
    stepByStepTourCardTarget,
    stepByStepTourCardHighlightPart,
    stepByStepTourActionMenuHighlightPart,
  }: AppCardProps) => {
    const { t } = useTranslation()
    const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
    const currentUserId = useAtomValue(userProfileIdAtom)
    const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
    const isRbacEnabled = systemFeatures.rbac_enabled
    const resourceMaintainer = app.maintainer ?? undefined
    const maintainerPermissionOptions = useMemo(
      () => ({
        currentUserId,
        resourceMaintainer,
        workspacePermissionKeys,
        isRbacEnabled,
      }),
      [currentUserId, isRbacEnabled, resourceMaintainer, workspacePermissionKeys],
    )
    const appACLCapabilities = useMemo(
      () => getAppACLCapabilities(app.permission_keys, maintainerPermissionOptions),
      [app.permission_keys, maintainerPermissionOptions],
    )
    const isPreviewOnly = hasOnlyAppPreviewPermission(app.permission_keys)
    const canManageAppTags = hasPermission(workspacePermissionKeys, 'app.tag.manage')
    const canBindOrUnbindTags = !isPreviewOnly && (canManageAppTags || appACLCapabilities.canEdit)
    const editTimeText = useMemo(() => {
      const timestamp = app.updated_at || app.created_at
      if (!timestamp) return ''

      const timeText = formatTime({
        date: timestamp * 1000,
        dateFormat: `${t(($) => $['segment.dateTimeFormat'], { ns: 'datasetDocuments' })}`,
      })
      return `${t(($) => $['segment.editedAt'], { ns: 'datasetDocuments' })} ${timeText}`
    }, [app.updated_at, app.created_at, t])

    const appModeLabel = useMemo(() => {
      switch (app.mode) {
        case AppModeEnum.CHAT:
          return t(($) => $['types.chatbot'], { ns: 'app' })
        case AppModeEnum.ADVANCED_CHAT:
          return t(($) => $['types.advanced'], { ns: 'app' })
        case AppModeEnum.AGENT_CHAT:
          return t(($) => $['types.agent'], { ns: 'app' })
        case AppModeEnum.COMPLETION:
          return t(($) => $['types.completion'], { ns: 'app' })
        case AppModeEnum.WORKFLOW:
          return t(($) => $['types.workflow'], { ns: 'app' })
        default:
          return app.mode
      }
    }, [app.mode, t])

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
        .filter((user) => Boolean(user.id))
    }, [app.id, onlineUsers])
    const appNameId = useId()
    const appDescriptionId = useId()
    const appIconType = zIconType.safeParse(app.icon_type).data ?? null
    const appHref = getRedirectionPath(app, maintainerPermissionOptions)
    const appCardClassName = cn(
      'inline-flex h-full w-full touch-manipulation flex-col overflow-hidden rounded-xl border-[0.5px] border-solid border-components-card-border bg-components-card-bg shadow-xs outline-hidden transition-shadow duration-200 ease-in-out',
      isPreviewOnly
        ? 'cursor-not-allowed opacity-60 focus-visible:ring-2 focus-visible:ring-state-accent-solid'
        : 'cursor-pointer hover:shadow-lg focus-visible:ring-2 focus-visible:ring-state-accent-solid',
    )
    const showPreviewOnlyAccessWarning = useCallback(() => {
      toast.warning(t(($) => $.noAccessResourcePermission, { ns: 'app' }))
    }, [t])
    const appCardContent = (
      <>
        <div className="flex shrink-0 items-center gap-3 pt-4 pr-4 pb-2 pl-4">
          <div className="relative shrink-0">
            <AppIcon
              size="large"
              iconType={appIconType}
              icon={app.icon ?? undefined}
              background={app.icon_background}
              imageUrl={app.icon_url}
            />
            <AppTypeIcon
              type={app.mode}
              wrapperClassName="absolute -bottom-0.5 -right-0.5 w-4 h-4 shadow-sm"
              className="size-3"
            />
          </div>
          <div className="flex w-0 grow flex-col gap-1 py-px">
            <div className="flex items-center text-sm/5 font-semibold text-text-secondary">
              <div id={appNameId} className="truncate">
                {app.name}
              </div>
            </div>
            <div className="truncate system-2xs-medium-uppercase text-text-tertiary">
              {appModeLabel}
            </div>
          </div>
          {onlinePresenceUsers.length > 0 && (
            <div className="ml-3 flex shrink-0 items-start">
              <UserAvatarList
                users={onlinePresenceUsers}
                size="xxs"
                maxVisible={3}
                className="justify-end"
              />
            </div>
          )}
        </div>
        <div className="shrink-0 px-4 py-1 system-xs-regular text-text-tertiary">
          <div id={appDescriptionId} className="line-clamp-2 min-h-8">
            {app.description}
          </div>
        </div>
        <div className="flex h-6.5 shrink-0 items-start px-3" />
        <div
          className={cn(
            'flex min-w-0 shrink-0 items-center overflow-hidden pt-2 pb-3 pl-4 system-xs-regular text-text-tertiary',
            app.access_mode ? 'pr-9' : 'pr-4',
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap">
            {app.author_name && (
              <>
                <div className="min-w-0 truncate">{app.author_name}</div>
                <div className="shrink-0">·</div>
              </>
            )}
            <div className="min-w-0 truncate">{editTimeText}</div>
          </div>
        </div>
      </>
    )

    return (
      <div className="group relative col-span-1 h-41.5">
        {isPreviewOnly ? (
          <button
            type="button"
            aria-labelledby={appNameId}
            aria-describedby={app.description ? appDescriptionId : undefined}
            data-step-by-step-tour-target={stepByStepTourCardTarget}
            data-step-by-step-tour-highlight-part={stepByStepTourCardHighlightPart}
            className={cn(appCardClassName, 'text-left')}
            onClick={showPreviewOnlyAccessWarning}
          >
            {appCardContent}
          </button>
        ) : (
          <Link
            href={appHref}
            aria-labelledby={appNameId}
            aria-describedby={app.description ? appDescriptionId : undefined}
            data-step-by-step-tour-target={stepByStepTourCardTarget}
            data-step-by-step-tour-highlight-part={stepByStepTourCardHighlightPart}
            className={appCardClassName}
          >
            {appCardContent}
          </Link>
        )}
        <AppAccessModeIcon
          accessMode={isAccessMode(app.access_mode) ? app.access_mode : undefined}
        />
        {!isPreviewOnly && (
          <AppCardActionBar
            app={app}
            stepByStepTourActionMenuOpen={stepByStepTourActionMenuOpen}
            stepByStepTourActionMenuHighlightPart={stepByStepTourActionMenuHighlightPart}
          />
        )}
        <div className="absolute top-26 right-3 left-3 flex h-6.5 min-w-0 items-start">
          <AppCardTags
            appId={app.id}
            tags={app.tags ?? []}
            canBindOrUnbindTags={canBindOrUnbindTags}
            onOpenTagManagement={onOpenTagManagement}
          />
        </div>
      </div>
    )
  },
)
