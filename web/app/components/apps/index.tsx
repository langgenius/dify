'use client'
import type { CreateAppModalProps } from '../explore/create-app-modal'
import type { CurrentTryAppParams } from '@/context/explore-context'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEducationInit } from '@/app/education-apply/hooks'
import AppListContext from '@/context/app-list-context'
import useDocumentTitle from '@/hooks/use-document-title'
import { useImportDSL } from '@/hooks/use-import-dsl'
import { DSLImportMode } from '@/models/app'
import { fetchAppDetail } from '@/service/explore'
import DSLConfirmModal from '../app/create-from-dsl-modal/dsl-confirm-modal'
import CreateAppModal from '../explore/create-app-modal'
import TryApp from '../explore/try-app'
import List from './list'

const Apps = () => {
  const { t } = useTranslation()

  useDocumentTitle(t('menus.apps', { ns: 'common' }))
  useEducationInit()

  const [currentTryAppParams, setCurrentTryAppParams] = useState<CurrentTryAppParams | undefined>(undefined)
  const currApp = currentTryAppParams?.app
  const [isShowTryAppPanel, setIsShowTryAppPanel] = useState(false)
  const hideTryAppPanel = useCallback(() => {
    setIsShowTryAppPanel(false)
  }, [])
  const setShowTryAppPanel = (showTryAppPanel: boolean, params?: CurrentTryAppParams) => {
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
      onSuccess,
    })
  }, [handleImportDSLConfirm, onSuccess])

  const onCreate: CreateAppModalProps['onConfirm'] = async ({
    name,
    icon_type,
    icon,
    icon_background,
    description,
  }) => {
    hideTryAppPanel()

    const { export_data } = await fetchAppDetail(
      currApp?.app.id as string,
    )
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
        setIsShowCreateModal(false)
      },
      onPending: () => {
        setShowDSLConfirmModal(true)
      },
    })
  }

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
