'use client'
import type { CreateAppModalProps } from '../explore/create-app-modal'
import type { TryAppSelection } from '@/types/try-app'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEducationInit } from '@/app/education-apply/hooks'
import AppListContext from '@/context/app-list-context'
import useDocumentTitle from '@/hooks/use-document-title'
import { useImportDSL } from '@/hooks/use-import-dsl'
import { DSLImportMode } from '@/models/app'
import dynamic from '@/next/dynamic'
import { fetchAppDetail } from '@/service/explore'
import { trackCreateApp } from '@/utils/create-app-tracking'
import List from './list'

const DSLConfirmModal = dynamic(() => import('../app/create-from-dsl-modal/dsl-confirm-modal'), { ssr: false })
const CreateAppModal = dynamic(() => import('../explore/create-app-modal'), { ssr: false })
const TryApp = dynamic(() => import('../explore/try-app'), { ssr: false })

const Apps = () => {
  const { t } = useTranslation()

  useDocumentTitle(t('menus.apps', { ns: 'common' }))
  useEducationInit()

  const [currentTryAppParams, setCurrentTryAppParams] = useState<TryAppSelection | undefined>(undefined)
  const currentCreateAppModeRef = useRef<TryAppSelection['app']['app']['mode'] | null>(null)
  const currApp = currentTryAppParams?.app
  const [isShowTryAppPanel, setIsShowTryAppPanel] = useState(false)
  const hideTryAppPanel = useCallback(() => {
    setIsShowTryAppPanel(false)
  }, [])
  const setShowTryAppPanel = (showTryAppPanel: boolean, params?: TryAppSelection) => {
    if (showTryAppPanel)
      setCurrentTryAppParams(params)
    else
      setCurrentTryAppParams(undefined)
    setIsShowTryAppPanel(showTryAppPanel)
  }
  const [isShowCreateModal, setIsShowCreateModal] = useState(false)

  const handleShowFromTryApp = useCallback(() => {
    setIsShowCreateModal(true)
  }, [])
  const trackCurrentCreateApp = useCallback(() => {
    if (!currentCreateAppModeRef.current)
      return

    trackCreateApp({ appMode: currentCreateAppModeRef.current })
  }, [])

  const [controlRefreshList, setControlRefreshList] = useState(0)
  const [controlHideCreateFromTemplatePanel, setControlHideCreateFromTemplatePanel] = useState(0)
  const onSuccess = useCallback(() => {
    setControlRefreshList(prev => prev + 1)
    setControlHideCreateFromTemplatePanel(prev => prev + 1)
  }, [])

  const [showDSLConfirmModal, setShowDSLConfirmModal] = useState(false)

  const {
    handleImportDSL,
    handleImportDSLConfirm,
    versions,
    isFetching,
  } = useImportDSL()

  const onConfirmDSL = useCallback(async () => {
    await handleImportDSLConfirm({
      onSuccess: () => {
        trackCurrentCreateApp()
        onSuccess()
      },
    })
  }, [handleImportDSLConfirm, onSuccess, trackCurrentCreateApp])

  const onCreate: CreateAppModalProps['onConfirm'] = useCallback(async ({
    name,
    icon_type,
    icon,
    icon_background,
    description,
  }) => {
    hideTryAppPanel()

    const { export_data, mode } = await fetchAppDetail(
      currApp?.app.id as string,
    )
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
      onSuccess: () => {
        trackCurrentCreateApp()
        setIsShowCreateModal(false)
      },
      onPending: () => {
        setShowDSLConfirmModal(true)
      },
    })
  }, [currApp?.app.id, handleImportDSL, hideTryAppPanel, trackCurrentCreateApp])

  return (
    <AppListContext.Provider value={{
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
            category={currentTryAppParams?.app?.category}
            onClose={hideTryAppPanel}
            onCreate={handleShowFromTryApp}
          />
        )}

        {
          showDSLConfirmModal && (
            <DSLConfirmModal
              versions={versions}
              onCancel={() => setShowDSLConfirmModal(false)}
              onConfirm={onConfirmDSL}
              confirmDisabled={isFetching}
            />
          )
        }

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
      </div>
    </AppListContext.Provider>
  )
}

export default Apps
