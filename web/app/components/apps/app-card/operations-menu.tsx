'use client'

import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { MouseEvent } from 'react'
import { DropdownMenuItem, DropdownMenuSeparator } from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { buildInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { useGetUserCanAccessApp } from '@/service/access-control/use-app-access-control'
import { fetchInstalledAppList } from '@/service/explore'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'

const APP_MODES_REQUIRING_PUBLISHED_WORKFLOW_IN_EXPLORE = new Set<AppPartial['mode']>([
  AppModeEnum.ADVANCED_CHAT,
  AppModeEnum.WORKFLOW,
])

function requiresPublishedWorkflowInExplore(app: AppPartial) {
  return APP_MODES_REQUIRING_PUBLISHED_WORKFLOW_IN_EXPLORE.has(app.mode)
}

type AppCardOperationsMenuProps = {
  app: AppPartial
  shouldShowEditOption: boolean
  shouldShowDuplicateOption: boolean
  shouldShowExportOption: boolean
  shouldShowSwitchOption: boolean
  shouldShowOpenInExploreOption: boolean
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

function AppCardOperationsMenu({
  app,
  shouldShowEditOption,
  shouldShowDuplicateOption,
  shouldShowExportOption,
  shouldShowSwitchOption,
  shouldShowOpenInExploreOption,
  shouldShowAccessConfigOption,
  shouldShowDeleteOption,
  isExporting,
  onEdit,
  onDuplicate,
  onExport,
  onSwitch,
  onDelete,
  onAccessConfig,
}: AppCardOperationsMenuProps) {
  const { t } = useTranslation()
  const openAsyncWindow = useAsyncWindowOpen()
  const hasEditGroup = shouldShowEditOption
  const hasCreateExportGroup = shouldShowDuplicateOption || shouldShowExportOption
  const hasSwitchOrExploreGroup = shouldShowSwitchOption || shouldShowOpenInExploreOption
  const hasAccessDeleteGroup = shouldShowAccessConfigOption || shouldShowDeleteOption

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
      {shouldShowAccessConfigOption && shouldShowDeleteOption && <DropdownMenuSeparator />}
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

export function AppCardOperationsMenuContent(props: AppCardOperationsMenuContentProps) {
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
