'use client'

import type {
  AppPartial,
  EnvironmentVariableItemResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { MouseEvent, ReactElement } from 'react'
import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import { zIconType } from '@dify/contracts/api/console/apps/zod.gen'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@langgenius/dify-ui/context-menu'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { Toggle } from '@langgenius/dify-ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import dynamic from 'next/dynamic'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppMetadataForm } from '@/app/components/app/app-metadata'
import { useExportAppDsl, useExportWorkflowAppDsl } from '@/app/components/app/use-export-app-dsl'
import { buildInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import {
  getStepByStepTourMenuContentProps,
  useStepByStepTourControlledMenu,
} from '@/app/components/step-by-step-tour/menu'
import { toast } from '@/app/notifications'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { AccessMode } from '@/models/access-control'
import { useRouter } from '@/next/navigation'
import { useGetUserCanAccessApp } from '@/service/access-control/use-app-access-control'
import { consoleClient, consoleQuery } from '@/service/console'
import { getRedirection } from '@/utils/app-redirection'
import { getAppACLCapabilities, hasPermission } from '@/utils/permission'
import { basePath } from '@/utils/var'

const DuplicateAppModal = dynamic(() => import('@/app/components/app/duplicate-modal'), {
  ssr: false,
})
const SwitchAppModal = dynamic(() => import('@/app/components/app/switch-app-modal'), {
  ssr: false,
})
const AppExportConfirmModal = dynamic(() => import('@/app/components/app/export-confirm-modal'), {
  ssr: false,
})

const OPERATIONS_MENU_POPUP_CLASS_NAME = 'min-w-[216px]'
const APP_MODES_REQUIRING_PUBLISHED_WORKFLOW_IN_EXPLORE = new Set<AppPartial['mode']>([
  'advanced-chat',
  'workflow',
] as const)

function requiresPublishedWorkflowInExplore(app: AppPartial) {
  return APP_MODES_REQUIRING_PUBLISHED_WORKFLOW_IN_EXPLORE.has(app.mode)
}

type AppCardOperationsMenuItemsProps = {
  app: AppPartial
  kind: 'context' | 'menu'
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
  const { t } = useTranslation(['app', 'common', 'navigation'])
  const openAsyncWindow = useAsyncWindowOpen()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: userCanAccessApp, isLoading: isGettingUserCanAccessApp } = useGetUserCanAccessApp({
    appId: app.id,
    enabled: systemFeatures.webapp_auth.enabled,
  })
  const needsPublishBeforeExplore = requiresPublishedWorkflowInExplore(app) && !app.workflow?.id
  const shouldShowOpenInExploreOption =
    !app.has_draft_trigger &&
    app.access_mode !== AccessMode.EXTERNAL_MEMBERS &&
    (needsPublishBeforeExplore ||
      !systemFeatures.webapp_auth.enabled ||
      (!isGettingUserCanAccessApp && Boolean(userCanAccessApp?.result)))
  const hasEditGroup = shouldShowEditOption
  const hasCreateExportGroup = shouldShowDuplicateOption || shouldShowExportOption
  const hasSwitchOrExploreGroup = shouldShowSwitchOption || shouldShowOpenInExploreOption
  const hasAccessDeleteGroup = shouldShowAccessConfigOption || shouldShowDeleteOption
  const ActionItem = kind === 'context' ? ContextMenuItem : MenuItem
  const ActionSeparator = kind === 'context' ? ContextMenuSeparator : MenuSeparator

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
          const { installed_apps } = await consoleClient.installedApps.get({
            query: { app_id: app.id },
          })
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
        <ActionItem className="gap-2 px-3" onClick={(event) => handleMenuAction(event, onEdit)}>
          <span className="system-sm-regular text-text-secondary">
            {t(($) => $.editApp, { ns: 'app' })}
          </span>
        </ActionItem>
      )}
      {hasEditGroup &&
        (hasCreateExportGroup || hasSwitchOrExploreGroup || hasAccessDeleteGroup) && (
          <ActionSeparator />
        )}
      {shouldShowDuplicateOption && (
        <ActionItem
          className="gap-2 px-3"
          onClick={(event) => handleMenuAction(event, onDuplicate)}
        >
          <span className="system-sm-regular text-text-secondary">
            {t(($) => $.duplicate, { ns: 'app' })}
          </span>
        </ActionItem>
      )}
      {shouldShowExportOption && (
        <ActionItem
          className="gap-2 px-3"
          disabled={isExporting}
          onClick={(event) => handleMenuAction(event, onExport)}
        >
          <span className="system-sm-regular text-text-secondary">
            {t(($) => $.exportApp, { ns: 'app' })}
          </span>
        </ActionItem>
      )}
      {hasCreateExportGroup && (hasSwitchOrExploreGroup || hasAccessDeleteGroup) && (
        <ActionSeparator />
      )}
      {shouldShowSwitchOption && (
        <ActionItem className="gap-2 px-3" onClick={(event) => handleMenuAction(event, onSwitch)}>
          <span className="text-sm/5 text-text-secondary">{t(($) => $.switch, { ns: 'app' })}</span>
        </ActionItem>
      )}
      {shouldShowOpenInExploreOption && (
        <ActionItem className="gap-2 px-3" onClick={handleOpenInstalledApp}>
          <span className="system-sm-regular text-text-secondary">
            {t(($) => $.openInExplore, { ns: 'app' })}
          </span>
        </ActionItem>
      )}
      {hasSwitchOrExploreGroup && hasAccessDeleteGroup && <ActionSeparator />}
      {shouldShowAccessConfigOption && (
        <ActionItem
          className="gap-2 px-3"
          onClick={(event) => handleMenuAction(event, onAccessConfig)}
        >
          <span className="text-sm/5 text-text-secondary">
            {t(($) => $['settings.resourceAccess'], { ns: 'navigation' })}
          </span>
        </ActionItem>
      )}
      {shouldShowAccessConfigOption && shouldShowDeleteOption && <ActionSeparator />}
      {shouldShowDeleteOption && (
        <ActionItem
          variant="destructive"
          className="gap-2 px-3"
          onClick={(event) => handleMenuAction(event, onDelete)}
        >
          <span className="system-sm-regular">
            {t(($) => $['operation.delete'], { ns: 'common' })}
          </span>
        </ActionItem>
      )}
    </>
  )
}

type AppCardInteractionsProps = {
  app: AppPartial
  children: ReactElement
  onDelete: () => void
  stepByStepTourActionMenuOpen?: boolean
  stepByStepTourActionMenuHighlightPart?: string
}

export function AppCardInteractions({
  app,
  children,
  onDelete,
  stepByStepTourActionMenuOpen = false,
  stepByStepTourActionMenuHighlightPart,
}: AppCardInteractionsProps) {
  const { t } = useTranslation(['app', 'common'])
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const isRbacEnabled = systemFeatures.rbac_enabled
  const { push } = useRouter()
  const { mutate: copyApp } = useMutation(consoleQuery.apps.byAppId.copy.post.mutationOptions())
  const { mutate: starApp, isPending: isStarring } = useMutation(
    consoleQuery.apps.byAppId.star.post.mutationOptions(),
  )
  const { mutate: unstarApp, isPending: isUnstarring } = useMutation(
    consoleQuery.apps.byAppId.star.delete.mutationOptions(),
  )

  const editActionsRef = useRef<DialogActions>(null)
  const edit = useMutation(
    consoleQuery.apps.byAppId.put.mutationOptions({ context: { silent: true } }),
  )
  const editNameRef = useRef<HTMLInputElement>(null)
  const [activeDialog, setActiveDialog] = useState<'duplicate' | 'edit' | 'switch' | null>(null)
  const operationsMenu = useStepByStepTourControlledMenu({
    allowTriggerCloseWhileControlled: false,
    controlledOpen: stepByStepTourActionMenuOpen,
  })
  const isOperationsMenuOpen = operationsMenu.open
  const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariableItemResponse[]>([])
  const {
    exportAppDsl,
    isExporting: isAppDslExporting,
    errorMessage: exportError,
    reset: resetExport,
  } = useExportAppDsl()
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
    const result = await exportAppDsl({
      appId: app.id,
      appName: app.name,
      includeSecret: include,
      feedback: 'dialog',
    })
    return result.status === 'downloaded'
  }

  const exportCheck = async () => {
    if (isExporting) return

    resetExport()
    const isWorkflowApp = app.mode === 'workflow' || app.mode === 'advanced-chat'
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
    appACLCapabilities.canEdit && (app.mode === 'completion' || app.mode === 'chat')
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
    onEdit: () => setActiveDialog('edit'),
    onDuplicate: () => setActiveDialog('duplicate'),
    onExport: exportCheck,
    onSwitch: () => setActiveDialog('switch'),
    onDelete,
    onAccessConfig: () => push(`/app/${app.id}/access-config`),
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
          'pointer-events-none absolute inset-e-[-0.5px] top-[-0.5px] flex h-16 w-30 items-start justify-end bg-[linear-gradient(67deg,var(--color-components-card-bg-alt-transparent)_0%,var(--color-components-card-bg-alt)_75%)] p-2 opacity-0 rtl:bg-[linear-gradient(293deg,var(--color-components-card-bg-alt-transparent)_0%,var(--color-components-card-bg-alt)_75%)]',
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
                      <span
                        aria-hidden
                        className="i-custom-vender-solid-general-star size-4.5 text-text-tertiary group-data-pressed:text-text-warning-secondary"
                      />
                    </IconButton>
                  }
                />
              }
            />
            <TooltipContent>{starToggleLabel}</TooltipContent>
          </Tooltip>
          {shouldShowOperationsMenu && (
            <Menu
              modal={false}
              open={isOperationsMenuOpen}
              onOpenChange={operationsMenu.onOpenChange}
            >
              <MenuTrigger
                render={
                  <IconButton
                    size="lg"
                    aria-label={t(($) => $['operation.moreActionsFor'], {
                      ns: 'common',
                      name: app.name,
                    })}
                    className="data-popup-open:bg-state-base-hover"
                  >
                    <span aria-hidden className="i-ri-more-fill size-4.5 text-text-tertiary" />
                  </IconButton>
                }
              />
              <MenuContent
                align="end"
                {...getStepByStepTourMenuContentProps({
                  highlightPart: stepByStepTourActionMenuHighlightPart,
                  interactionMode: operationsMenu.controlled ? 'presentation' : 'interactive',
                  className: OPERATIONS_MENU_POPUP_CLASS_NAME,
                })}
              >
                <AppCardOperationsMenuItems kind="menu" {...operationsMenuItemsProps} />
              </MenuContent>
            </Menu>
          )}
        </div>
      </div>
      <Dialog
        actionsRef={editActionsRef}
        open={activeDialog === 'edit'}
        disablePointerDismissal
        onOpenChange={(open, details) => {
          if (!open && edit.isPending && details.reason !== 'imperative-action') details.cancel()
          else if (!open) setActiveDialog(null)
        }}
        onOpenChangeComplete={(open) => {
          if (!open) {
            edit.reset()
          }
        }}
      >
        <DialogContent initialFocus={editNameRef}>
          <AppMetadataForm
            appDetail={app}
            nameInputRef={editNameRef}
            operation="edit"
            isPending={edit.isPending}
            error={edit.error?.message}
            onSubmit={(body) => {
              if (edit.isPending) return
              edit.mutate(
                { params: { app_id: app.id }, body },
                {
                  onSuccess: () => editActionsRef.current?.close(),
                },
              )
            }}
          />
        </DialogContent>
      </Dialog>
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
        <SwitchAppModal
          open
          sourceApp={app}
          onOpenChange={(open) => {
            if (!open) setActiveDialog(null)
          }}
        />
      )}
      {secretEnvList.length > 0 && (
        <AppExportConfirmModal
          envList={secretEnvList}
          errorMessage={exportError}
          isExporting={isExporting}
          onConfirm={onExport}
          onClose={() => setSecretEnvList([])}
        />
      )}
    </>
  )
}
