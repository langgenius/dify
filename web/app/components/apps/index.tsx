'use client'
import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { CreateAppModalProps } from '../explore/create-app-modal'
import type { TrackCreateAppParams } from '@/utils/create-app-tracking'
import { useAtomValue } from 'jotai'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EducationExpireNotice } from '@/app/education/expire-notice'
import { toast } from '@/app/notifications'
import AppListContext from '@/context/app-list-context'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useImportDSL } from '@/hooks/use-import-dsl'
import { DSLImportMode } from '@/models/app'
import dynamic from '@/next/dynamic'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleClient } from '@/service/console'
import { trackCreateApp } from '@/utils/create-app-tracking'
import { hasPermission } from '@/utils/permission'
import { List } from './list'

const DSLConfirmModal = dynamic(() => import('../app/create-from-dsl-modal/dsl-confirm-modal'), {
  ssr: false,
})
const CreateAppModal = dynamic(() => import('../explore/create-app-modal'), { ssr: false })
const TryApp = dynamic(() => import('../explore/try-app'), { ssr: false })
const ImportFromMarketplaceTemplateModal = dynamic(
  () => import('./import-from-marketplace-template-modal'),
  { ssr: false },
)
const AppListProvider = AppListContext.Provider

const AppsContent = () => {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const { replace } = useRouter()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')
  const templateId = searchParams.get('template-id')
  const templateDismissedRef = useRef(false)

  const [currApp, setCurrApp] = useState<RecommendedAppResponse | undefined>(undefined)
  const currentCreateAppModeRef = useRef<TrackCreateAppParams['appMode'] | null>(null)
  const currentCreateAppTrackingRef = useRef<Pick<
    TrackCreateAppParams,
    'source' | 'templateId'
  > | null>(null)
  const [isShowTryAppPanel, setIsShowTryAppPanel] = useState(false)
  const hideTryAppPanel = useCallback(() => {
    setIsShowTryAppPanel(false)
  }, [])
  const openTryAppPanel = useCallback((app: RecommendedAppResponse) => {
    setCurrApp(app)
    setIsShowTryAppPanel(true)
  }, [])
  const [isShowCreateModal, setIsShowCreateModal] = useState(false)

  const handleCreateLearnDify = (app: RecommendedAppResponse) => {
    if (!canCreateApp) return

    setCurrApp(app)
    setIsShowCreateModal(true)
  }

  const handleShowFromTryApp = useCallback(() => {
    if (!canCreateApp) return

    currentCreateAppTrackingRef.current = {
      source: 'studio_template_preview',
      templateId: currApp?.app_id,
    }
    setIsShowCreateModal(true)
  }, [canCreateApp, currApp?.app_id])
  const trackCurrentCreateApp = useCallback((appMode?: TrackCreateAppParams['appMode'] | null) => {
    const currentCreateAppTracking = currentCreateAppTrackingRef.current
    const resolvedAppMode = appMode ?? currentCreateAppModeRef.current
    if (!resolvedAppMode || !currentCreateAppTracking) return

    trackCreateApp({
      ...currentCreateAppTracking,
      appMode: resolvedAppMode,
    })
    currentCreateAppTrackingRef.current = null
    currentCreateAppModeRef.current = null
  }, [])

  const [showDSLConfirmModal, setShowDSLConfirmModal] = useState(false)

  const handleCloseTemplateModal = useCallback(() => {
    templateDismissedRef.current = true
    const params = new URLSearchParams(searchParams.toString())
    params.delete('template-id')
    const query = params.toString()
    replace(query ? `?${query}` : window.location.pathname, { scroll: false })
  }, [searchParams, replace])

  const { handleImportDSL, handleImportDSLConfirm, versions, isFetching } = useImportDSL()

  const onConfirmDSL = useCallback(async () => {
    await handleImportDSLConfirm({
      onSuccess: (response) => {
        trackCurrentCreateApp(response.app_mode)
      },
    })
  }, [handleImportDSLConfirm, trackCurrentCreateApp])

  const handleMarketplaceTemplateConfirm = useCallback(
    async (dslContent: string) => {
      if (!canCreateApp) return

      currentCreateAppModeRef.current = null
      currentCreateAppTrackingRef.current = {
        source: 'external',
        templateId: templateId || undefined,
      }
      await handleImportDSL(
        {
          mode: DSLImportMode.YAML_CONTENT,
          yaml_content: dslContent,
        },
        {
          onSuccess: (response) => {
            trackCurrentCreateApp(response.app_mode)
            handleCloseTemplateModal()
          },
          onPending: () => {
            handleCloseTemplateModal()
            setShowDSLConfirmModal(true)
          },
        },
      )
    },
    [canCreateApp, handleImportDSL, handleCloseTemplateModal, templateId, trackCurrentCreateApp],
  )

  const onCreate: CreateAppModalProps['onConfirm'] = useCallback(
    async ({ name, icon_type, icon, icon_background, description }) => {
      if (!canCreateApp || !currApp) return

      hideTryAppPanel()

      try {
        const { export_data, mode } = await consoleClient.explore.apps.byAppId.get({
          params: { app_id: currApp.app_id },
        })
        currentCreateAppModeRef.current = mode
        const payload = {
          mode: DSLImportMode.YAML_CONTENT,
          yaml_content: export_data,
          name,
          icon_type,
          icon,
          icon_background,
          description,
        }
        await handleImportDSL(payload, {
          onSuccess: (response) => {
            trackCurrentCreateApp(response.app_mode)
            setIsShowCreateModal(false)
          },
          onPending: () => {
            setShowDSLConfirmModal(true)
          },
        })
      } catch {
        toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
      }
    },
    [canCreateApp, currApp, handleImportDSL, hideTryAppPanel, trackCurrentCreateApp, t],
  )

  return (
    <>
      <EducationExpireNotice />
      <AppListProvider
        value={{
          openTryAppPanel,
        }}
      >
        <div className="relative flex h-0 shrink-0 grow flex-col overflow-hidden bg-background-body">
          <List onCreateLearnDify={handleCreateLearnDify} onTryLearnDify={openTryAppPanel} />
          {isShowTryAppPanel && currApp && (
            <TryApp app={currApp} onClose={hideTryAppPanel} onCreate={handleShowFromTryApp} />
          )}

          {showDSLConfirmModal && (
            <DSLConfirmModal
              versions={versions}
              onCancel={() => setShowDSLConfirmModal(false)}
              onConfirm={onConfirmDSL}
              confirmDisabled={isFetching}
            />
          )}

          {isShowCreateModal && (
            <CreateAppModal
              appIconType={
                currApp?.app?.icon_type === 'image' || currApp?.app?.icon_type === 'link'
                  ? currApp.app.icon_type
                  : 'emoji'
              }
              appIcon={currApp?.app?.icon ?? ''}
              appIconBackground={currApp?.app?.icon_background ?? ''}
              appIconUrl={currApp?.app?.icon_url}
              appName={currApp?.app?.name ?? ''}
              appDescription=""
              show
              onConfirm={onCreate}
              confirmDisabled={isFetching}
              onHide={() => setIsShowCreateModal(false)}
            />
          )}

          {canCreateApp && templateId && !templateDismissedRef.current && (
            <ImportFromMarketplaceTemplateModal
              templateId={templateId}
              onClose={handleCloseTemplateModal}
              onConfirm={handleMarketplaceTemplateConfirm}
            />
          )}
        </div>
      </AppListProvider>
    </>
  )
}

export function Apps() {
  return <AppsContent />
}
