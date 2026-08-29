'use client'

import type {
  AppPartial,
  EnvironmentVariableItemResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { FormEventHandler, MouseEvent, ReactElement } from 'react'
import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
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
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@langgenius/dify-ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { toast } from '@langgenius/dify-ui/toast'
import { Toggle } from '@langgenius/dify-ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useExportAppDsl, useExportWorkflowAppDsl } from '@/app/components/app/use-export-app-dsl'
import StarIcon from '@/app/components/base/icons/src/vender/Star'
import { buildInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import {
  getStepByStepTourDropdownMenuContentProps,
  useStepByStepTourControlledDropdown,
} from '@/app/components/step-by-step-tour/dropdown-menu'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useProviderContext } from '@/context/provider-context'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import dynamic from '@/next/dynamic'
import { useRouter } from '@/next/navigation'
import { useGetUserCanAccessApp } from '@/service/access-control/use-app-access-control'
import { consoleQuery } from '@/service/client'
import { fetchInstalledAppList } from '@/service/explore'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import { getAppACLCapabilities, hasPermission } from '@/utils/permission'
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

const OPERATIONS_MENU_POPUP_CLASS_NAME = 'min-w-[216px]'
const APP_MODES_REQUIRING_PUBLISHED_WORKFLOW_IN_EXPLORE = new Set<AppPartial['mode']>([
  AppModeEnum.ADVANCED_CHAT,
  AppModeEnum.WORKFLOW,
])

function requiresPublishedWorkflowInExplore(app: AppPartial) {
  return APP_MODES_REQUIRING_PUBLISHED_WORKFLOW_IN_EXPLORE.has(app.mode)
}

type AppCardOperationsMenuItemsProps = {
  app: AppPartial
  kind: 'context' | 'dropdown'
  shouldShowEditOption: boolean
  shouldShowDuplicateOption: boolean
  shouldShowExportOption: boolean
  shouldShowSwitchOption: boolean
  shouldShowAccessConfigOption: boolean
  shouldShowDeleteOption: boolean
  isExporting: boolean
  onEdit: () => void
  onDuplicate: () => void
  onExport: () => void
  onSwitch: () => void
  onDelete: () => void
  onAccessConfig: () => void
}

function AppCardOperationsMenuItems({
  app,
  kind,
  shouldShowEditOption,
  shouldShowDuplicateOption,
  shouldShowExportOption,
  shouldShowSwitchOption,
  shouldShowAccessConfigOption,
  shouldShowDeleteOption,
  isExporting,
  onEdit,
  onDuplicate,
  onExport,
  onSwitch,
  onDelete,
  onAccessConfig,
}: AppCardOperationsMenuItemsProps) {
  const { t } = useTranslation()
  const openAsyncWindow = useAsyncWindowOpen()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: userCanAccessApp, isLoading: isGettingUserCanAccessApp } = useGetUserCanAccessApp({
    appId: app.id,
    enabled: systemFeatures.webapp_auth.enabled,
  })
  const needsPublishBeforeExplore = requiresPublishedWorkflowInExplore(app) && !app.workflow?.id
  const shouldShowOpenInExploreOption =
    !app.has_draft_trigger &&
    (needsPublishBeforeExplore ||
      !systemFeatures.webapp_auth.enabled ||
      (!isGettingUserCanAccessApp && Boolean(userCanAccessApp?.result)))
  const hasEditGroup = shouldShowEditOption
  const hasCreateExportGroup = shouldShowDuplicateOption || shouldShowExportOption
  const hasSwitchOrExploreGroup = shouldShowSwitchOption || shouldShowOpenInExploreOption
  const hasAccessDeleteGroup = shouldShowAccessConfigOption || shouldShowDeleteOption
  const MenuItem = kind === 'context' ? ContextMenuItem : DropdownMenuItem
  const MenuSeparator = kind === 'context' ? ContextMenuSeparator : DropdownMenuSeparator

  function handleMenuAction(event: MouseEvent<HTMLElement>, action: () => void) {
    event.stopPropagation()
    event.preventDefault()
    action()
  }

  async function handleOpenInstalledApp(event: MouseEvent<HTMLElement>) {
    event.stopPropagation()
    event.preventDefault()
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
          onError: (error) => {
            toast.error(`${error.message || error}`)
          },
        },
      )
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : `${error}`
      toast.error(message)
    }
  }

  return (
    <>
      {shouldShowEditOption && (
        <MenuItem className="gap-2 px-3" onClick={(event) => handleMenuAction(event, onEdit)}>
          <span className="system-sm-regular text-text-secondary">
            {t(($) => $.editApp, { ns: 'app' })}
          </span>
        </MenuItem>
      )}
      {hasEditGroup &&
        (hasCreateExportGroup || hasSwitchOrExploreGroup || hasAccessDeleteGroup) && (
          <MenuSeparator />
        )}
      {shouldShowDuplicateOption && (
        <MenuItem className="gap-2 px-3" onClick={(event) => handleMenuAction(event, onDuplicate)}>
          <span className="system-sm-regular text-text-secondary">
            {t(($) => $.duplicate, { ns: 'app' })}
          </span>
        </MenuItem>
      )}
      {shouldShowExportOption && (
        <MenuItem
          className="gap-2 px-3"
          disabled={isExporting}
          onClick={(event) => handleMenuAction(event, onExport)}
        >
          <span className="system-sm-regular text-text-secondary">
            {t(($) => $.export, { ns: 'app' })}
          </span>
        </MenuItem>
      )}
      {hasCreateExportGroup && (hasSwitchOrExploreGroup || hasAccessDeleteGroup) && (
        <MenuSeparator />
      )}
      {shouldShowSwitchOption && (
        <MenuItem className="gap-2 px-3" onClick={(event) => handleMenuAction(event, onSwitch)}>
          <span className="text-sm/5 text-text-secondary">{t(($) => $.switch, { ns: 'app' })}</span>
        </MenuItem>
      )}
      {shouldShowOpenInExploreOption && (
        <MenuItem className="gap-2 px-3" onClick={handleOpenInstalledApp}>
          <span className="system-sm-regular text-text-secondary">
            {t(($) => $.openInExplore, { ns: 'app' })}
          </span>
        </MenuItem>
      )}
      {hasSwitchOrExploreGroup && hasAccessDeleteGroup && <MenuSeparator />}
      {shouldShowAccessConfigOption && (
        <MenuItem
          className="gap-2 px-3"
          onClick={(event) => handleMenuAction(event, onAccessConfig)}
        >
          <span className="text-sm/5 text-text-secondary">
            {t(($) => $['settings.resourceAccess'], { ns: 'common' })}
          </span>
        </MenuItem>
      )}
      {shouldShowAccessConfigOption && shouldShowDeleteOption && <MenuSeparator />}
      {shouldShowDeleteOption && (
        <MenuItem
          variant="destructive"
          className="gap-2 px-3"
          onClick={(event) => handleMenuAction(event, onDelete)}
        >
          <span className="system-sm-regular">
            {t(($) => $['operation.delete'], { ns: 'common' })}
          </span>
        </MenuItem>
      )}
    </>
  )
}

type AppCardInteractionsProps = {
  app: AppPartial
  children: ReactElement
  stepByStepTourActionMenuOpen?: boolean
  stepByStepTourActionMenuHighlightPart?: string
}

export function AppCardInteractions({
  app,
  children,
  stepByStepTourActionMenuOpen = false,
  stepByStepTourActionMenuHighlightPart,
}: AppCardInteractionsProps) {
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
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

  const [activeDialog, setActiveDialog] = useState<
    'delete' | 'duplicate' | 'edit' | 'switch' | null
  >(null)
  const [confirmDeleteInput, setConfirmDeleteInput] = useState('')
  const operationsMenu = useStepByStepTourControlledDropdown({
    allowTriggerCloseWhileControlled: false,
    controlledOpen: stepByStepTourActionMenuOpen,
  })
  const isOperationsMenuOpen = operationsMenu.open
  const setIsOperationsMenuOpen = operationsMenu.onOpenChange
  const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariableItemResponse[]>([])
  const { exportAppDsl, isExporting: isAppDslExporting } = useExportAppDsl()
  const { exportWorkflowAppDsl, isExporting: isWorkflowAppDslExporting } = useExportWorkflowAppDsl()
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
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')

  const onConfirmDelete = useCallback(() => {
    try {
      deleteApp(
        { params: { app_id: app.id } },
        {
          onSuccess: () => {
            toast.success(t(($) => $.appDeleted, { ns: 'app' }))
            onPlanInfoChanged()
            setActiveDialog(null)
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

      setActiveDialog(open ? 'delete' : null)
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
      setActiveDialog('edit')
    })
  }, [setIsOperationsMenuOpen])

  const handleShowDuplicateModal = useCallback(() => {
    setIsOperationsMenuOpen(false)
    queueMicrotask(() => {
      setActiveDialog('duplicate')
    })
  }, [setIsOperationsMenuOpen])

  const handleShowSwitchModal = useCallback(() => {
    setIsOperationsMenuOpen(false)
    queueMicrotask(() => {
      setActiveDialog('switch')
    })
  }, [setIsOperationsMenuOpen])

  const handleShowDeleteConfirm = useCallback(() => {
    setIsOperationsMenuOpen(false)
    queueMicrotask(() => {
      setActiveDialog('delete')
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
        setActiveDialog(null)
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

            setActiveDialog(null)
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

  const handleToggleStar = useCallback(
    (pressed: boolean) => {
      if (isTogglingStar) return

      const mutateStar = pressed ? starApp : unstarApp
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
          error instanceof Error ? error.message : t(($) => $['studio.starFailed'], { ns: 'app' }),
        )
      }
    },
    [app.id, isTogglingStar, starApp, t, unstarApp],
  )

  const shouldShowEditOption = appACLCapabilities.canEdit
  const shouldShowDuplicateOption = canCreateApp
  const shouldShowExportOption = appACLCapabilities.canImportExportDSL
  const shouldShowSwitchOption =
    appACLCapabilities.canEdit &&
    (app.mode === AppModeEnum.COMPLETION || app.mode === AppModeEnum.CHAT)
  const shouldShowAccessConfigOption = appACLCapabilities.canAccessConfig
  const shouldShowDeleteOption = appACLCapabilities.canDelete
  const shouldShowOperationsMenu =
    shouldShowEditOption ||
    shouldShowDuplicateOption ||
    shouldShowExportOption ||
    shouldShowSwitchOption ||
    shouldShowAccessConfigOption ||
    shouldShowDeleteOption
  const starToggleLabel = t(($) => $['studio.starApp'], { ns: 'app' })
  const starToggleAccessibleLabel = `${starToggleLabel}: ${app.name}`
  const operationsMenuItemsProps = {
    app,
    shouldShowEditOption,
    shouldShowDuplicateOption,
    shouldShowExportOption,
    shouldShowSwitchOption,
    shouldShowAccessConfigOption,
    shouldShowDeleteOption,
    isExporting,
    onEdit: handleShowEditModal,
    onDuplicate: handleShowDuplicateModal,
    onExport: exportCheck,
    onSwitch: handleShowSwitchModal,
    onDelete: handleShowDeleteConfirm,
    onAccessConfig: handleOpenAccessConfig,
  }

  return (
    <>
      {shouldShowOperationsMenu ? (
        <ContextMenu>
          <ContextMenuTrigger render={children} />
          <ContextMenuContent className={OPERATIONS_MENU_POPUP_CLASS_NAME}>
            <AppCardOperationsMenuItems kind="context" {...operationsMenuItemsProps} />
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        children
      )}
      <div
        className={cn(
          'pointer-events-none absolute top-[-0.5px] right-[-0.5px] flex h-16 w-30 items-start justify-end bg-[linear-gradient(67deg,var(--color-components-card-bg-alt-transparent)_0%,var(--color-components-card-bg-alt)_75%)] p-2 opacity-0',
          isOperationsMenuOpen || isExporting
            ? 'opacity-100'
            : 'group-focus-within:opacity-100 group-hover:opacity-100 has-data-popup-open:opacity-100 [@media(hover:none)]:opacity-100',
        )}
      >
        <div
          className={cn(
            'flex items-center overflow-hidden rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg backdrop-blur-xs',
            isOperationsMenuOpen || isExporting
              ? 'pointer-events-auto'
              : 'pointer-events-none group-focus-within:pointer-events-auto group-hover:pointer-events-auto has-data-popup-open:pointer-events-auto [@media(hover:none)]:pointer-events-auto',
          )}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  pressed={app.is_starred}
                  disabled={isTogglingStar}
                  onPressedChange={handleToggleStar}
                  render={
                    <IconButton
                      size="lg"
                      aria-label={starToggleAccessibleLabel}
                      className="group disabled:opacity-70"
                    >
                      <StarIcon
                        aria-hidden
                        className="size-4.5 text-text-tertiary group-data-pressed:text-text-warning-secondary"
                      />
                    </IconButton>
                  }
                />
              }
            />
            <TooltipContent>{starToggleLabel}</TooltipContent>
          </Tooltip>
          {shouldShowOperationsMenu && (
            <DropdownMenu
              modal={false}
              open={isOperationsMenuOpen}
              onOpenChange={setIsOperationsMenuOpen}
            >
              <DropdownMenuTrigger
                render={
                  <IconButton
                    size="lg"
                    aria-label={
                      isExporting
                        ? t(($) => $['operation.exporting'], { ns: 'common' })
                        : t(($) => $['operation.moreActionsFor'], {
                            ns: 'common',
                            name: app.name,
                          })
                    }
                    disabled={isExporting}
                    className="data-popup-open:bg-state-base-hover"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'size-4.5 text-text-tertiary',
                        isExporting
                          ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none'
                          : 'i-ri-more-fill',
                      )}
                    />
                  </IconButton>
                }
              />
              <DropdownMenuContent
                placement="bottom-end"
                sideOffset={4}
                {...getStepByStepTourDropdownMenuContentProps({
                  highlightPart: stepByStepTourActionMenuHighlightPart,
                  interactionMode: operationsMenu.controlled ? 'presentation' : 'interactive',
                  className: OPERATIONS_MENU_POPUP_CLASS_NAME,
                })}
              >
                <AppCardOperationsMenuItems kind="dropdown" {...operationsMenuItemsProps} />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {activeDialog === 'edit' && (
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
          show
          onConfirm={onEdit}
          onHide={() => setActiveDialog(null)}
        />
      )}
      {activeDialog === 'duplicate' && (
        <DuplicateAppModal
          appName={app.name}
          icon_type={appIconType}
          icon={app.icon ?? ''}
          icon_background={app.icon_background}
          icon_url={app.icon_url}
          show
          onConfirm={onCopy}
          onHide={() => setActiveDialog(null)}
        />
      )}
      {activeDialog === 'switch' && (
        <SwitchAppModal show appDetail={app} onClose={() => setActiveDialog(null)} />
      )}
      <AlertDialog open={activeDialog === 'delete'} onOpenChange={onDeleteDialogOpenChange}>
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
                <InputGroup className="border-components-input-border-hover">
                  <InputGroupInput
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t(($) => $.deleteAppConfirmInputPlaceholder, { ns: 'app' })}
                    value={confirmDeleteInput}
                    onValueChange={setConfirmDeleteInput}
                  />
                  <InputGroupAddon align="inline-end" className="min-w-20 justify-end pe-1.75">
                    <Button
                      variant="tertiary"
                      size="small"
                      onClick={() => setConfirmDeleteInput(app.name)}
                      className="rounded-full px-2.5"
                    >
                      {t(($) => $['operation.fill'], { ns: 'common' })}
                    </Button>
                  </InputGroupAddon>
                </InputGroup>
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
    </>
  )
}
