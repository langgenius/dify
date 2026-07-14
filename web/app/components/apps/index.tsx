'use client'
import type { CreateAppModalProps } from '../explore/create-app-modal'
import type { TryAppSelection } from '@/types/try-app'
import type { TrackCreateAppParams } from '@/utils/create-app-tracking'
import { useAtomValue } from 'jotai'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEducationInit } from '@/app/education-apply/hooks'
import AppListContext from '@/context/app-list-context'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import useDocumentTitle from '@/hooks/use-document-title'
import { useImportDSL } from '@/hooks/use-import-dsl'
import { DSLImportMode } from '@/models/app'
import dynamic from '@/next/dynamic'
import { useRouter, useSearchParams } from '@/next/navigation'
import { fetchAppDetail } from '@/service/explore'
import { trackCreateApp } from '@/utils/create-app-tracking'
import { hasPermission } from '@/utils/permission'
import List from './list'

const DSLConfirmModal = dynamic(() => import('../app/create-from-dsl-modal/dsl-confirm-modal'), {
  ssr: false,
})
const CreateAppModal = dynamic(() => import('../explore/create-app-modal'), { ssr: false })
const TryApp = dynamic(() => import('../explore/try-app'), { ssr: false })
const ImportFromMarketplaceTemplateModal = dynamic(
  () => import('./import-from-marketplace-template-modal'),
  { ssr: false },
)

const Apps = () => {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const { replace } = useRouter()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')
  const templateId = searchParams.get('template-id')
  const templateDismissedRef = useRef(false)

  useDocumentTitle(t(($) => $['menus.apps'], { ns: 'common' }))
  useEducationInit()

  const [currentTryAppParams, setCurrentTryAppParams] = useState<TryAppSelection | undefined>(
    undefined,
  )
  const currentCreateAppModeRef = useRef<TryAppSelection['app']['app']['mode'] | null>(null)
  const currentCreateAppTrackingRef = useRef<Pick<
    TrackCreateAppParams,
    'source' | 'templateId'
  > | null>(null)
  const currApp = currentTryAppParams?.app
  const [isShowTryAppPanel, setIsShowTryAppPanel] = useState(false)
  const hideTryAppPanel = useCallback(() => {
    setIsShowTryAppPanel(false)
  }, [])
  const setShowTryAppPanel = (showTryAppPanel: boolean, params?: TryAppSelection) => {
    if (showTryAppPanel) setCurrentTryAppParams(params)
    else setCurrentTryAppParams(undefined)
    setIsShowTryAppPanel(showTryAppPanel)
  }
  const [isShowCreateModal, setIsShowCreateModal] = useState(false)

  const handleShowFromTryApp = useCallback(() => {
    if (!canCreateApp) return

    currentCreateAppTrackingRef.current = {
      source: 'studio_template_preview',
      templateId: currentTryAppParams?.appId || currentTryAppParams?.app.app_id,
    }
    setIsShowCreateModal(true)
  }, [canCreateApp, currentTryAppParams?.app.app_id, currentTryAppParams?.appId])
  const trackCurrentCreateApp = useCallback(
    (appMode?: TryAppSelection['app']['app']['mode'] | null) => {
      const currentCreateAppTracking = currentCreateAppTrackingRef.current
      const resolvedAppMode = appMode ?? currentCreateAppModeRef.current
      if (!resolvedAppMode || !currentCreateAppTracking) return

      trackCreateApp({
        ...currentCreateAppTracking,
        appMode: resolvedAppMode,
      })
      currentCreateAppTrackingRef.current = null
      currentCreateAppModeRef.current = null
    },
    [],
  )

  const [controlRefreshList, setControlRefreshList] = useState(0)
  const [controlHideCreateFromTemplatePanel, setControlHideCreateFromTemplatePanel] = useState(0)
  const onSuccess = useCallback(() => {
    setControlRefreshList((prev) => prev + 1)
    setControlHideCreateFromTemplatePanel((prev) => prev + 1)
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
        onSuccess()
      },
    })
  }, [handleImportDSLConfirm, onSuccess, trackCurrentCreateApp])

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
            onSuccess()
          },
          onPending: () => {
            handleCloseTemplateModal()
            setShowDSLConfirmModal(true)
          },
        },
      )
    },
    [
      canCreateApp,
      handleImportDSL,
      handleCloseTemplateModal,
      onSuccess,
      templateId,
      trackCurrentCreateApp,
    ],
  )

  const onCreate: CreateAppModalProps['onConfirm'] = useCallback(
    async ({ name, icon_type, icon, icon_background, description }) => {
      if (!canCreateApp) return

      hideTryAppPanel()

      const { export_data, mode } = await fetchAppDetail(currApp?.app.id as string)
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
    },
    [canCreateApp, currApp?.app.id, handleImportDSL, hideTryAppPanel, trackCurrentCreateApp],
  )

  return (
    <AppListContext.Provider
      value={{
        currentApp: currentTryAppParams,
        isShowTryAppPanel,
        setShowTryAppPanel,
        controlHideCreateFromTemplatePanel,
      }}
    >
      <div className="relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body">
        <List controlRefreshList={controlRefreshList} />
        {isShowTryAppPanel && (
          <TryApp
            appId={currentTryAppParams?.appId || ''}
            app={currentTryAppParams?.app}
            categories={currentTryAppParams?.app?.categories}
            onClose={hideTryAppPanel}
            onCreate={handleShowFromTryApp}
          />
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
            appIconType={currApp?.app.icon_type || 'emoji'}
            appIcon={currApp?.app.icon || ''}
            appIconBackground={currApp?.app.icon_background || ''}
            appIconUrl={currApp?.app.icon_url}
            appName={currApp?.app.name || ''}
            appDescription={currApp?.app.description || ''}
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
    </AppListContext.Provider>
  )
}

export default Apps
