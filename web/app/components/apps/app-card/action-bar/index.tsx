'use client'

import type {
  AppPartial,
  EnvironmentVariableItemResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { FormEventHandler } from 'react'
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
  DropdownMenu,
  DropdownMenuContent,
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
import { memo, useCallback, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useExportAppDsl, useExportWorkflowAppDsl } from '@/app/components/app/use-export-app-dsl'
import StarIcon from '@/app/components/base/icons/src/vender/Star'
import {
  getStepByStepTourDropdownMenuContentProps,
  useStepByStepTourControlledDropdown,
} from '@/app/components/step-by-step-tour/dropdown-menu'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useProviderContext } from '@/context/provider-context'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import dynamic from '@/next/dynamic'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import {
  getAppACLCapabilities,
  hasOnlyAppPreviewPermission,
  hasPermission,
} from '@/utils/permission'
import { AppCardOperationsMenuContent } from '../operations-menu'

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

    const [showEditModal, setShowEditModal] = useState(false)
    const [showDuplicateModal, setShowDuplicateModal] = useState(false)
    const [showSwitchModal, setShowSwitchModal] = useState<boolean>(false)
    const [showConfirmDelete, setShowConfirmDelete] = useState(false)
    const [confirmDeleteInput, setConfirmDeleteInput] = useState('')
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
            error instanceof Error
              ? error.message
              : t(($) => $['studio.starFailed'], { ns: 'app' }),
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
    const starActionLabel = app.is_starred
      ? t(($) => $['studio.unstarApp'], { ns: 'app' })
      : t(($) => $['studio.starApp'], { ns: 'app' })
    const starToggleLabel = t(($) => $['studio.starApp'], { ns: 'app' })

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
                  <Toggle
                    pressed={app.is_starred}
                    disabled={isTogglingStar}
                    onPressedChange={handleToggleStar}
                    render={
                      <IconButton
                        size="lg"
                        aria-label={starToggleLabel}
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
              <TooltipContent>{starActionLabel}</TooltipContent>
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
                  <AppCardOperationsMenuContent
                    app={app}
                    shouldShowEditOption={shouldShowEditOption}
                    shouldShowDuplicateOption={shouldShowDuplicateOption}
                    shouldShowExportOption={shouldShowExportOption}
                    shouldShowSwitchOption={shouldShowSwitchOption}
                    shouldShowAccessConfigOption={shouldShowAccessConfigOption}
                    shouldShowDeleteOption={shouldShowDeleteOption}
                    isExporting={isExporting}
                    onEdit={handleShowEditModal}
                    onDuplicate={handleShowDuplicateModal}
                    onExport={exportCheck}
                    onSwitch={handleShowSwitchModal}
                    onDelete={handleShowDeleteConfirm}
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
  },
)
