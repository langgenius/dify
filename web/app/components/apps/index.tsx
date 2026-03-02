'use client'
import type { CreateAppModalProps } from '../explore/create-app-modal'
import type { CurrentTryAppParams } from '@/context/explore-context'
import type { MarketplaceTemplate } from '@/service/marketplace-templates'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'
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

const ImportFromMarketplaceTemplateModal = dynamic(
  () => import('./import-from-marketplace-template-modal'),
  { ssr: false },
)

const Apps = () => {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const { replace } = useRouter()

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

  // Marketplace template import via URL param
  const marketplaceTemplateId = searchParams.get('template-id') || undefined
  const dismissedTemplateIdRef = useRef<string | undefined>(undefined)
  const showMarketplaceModal = !!marketplaceTemplateId && dismissedTemplateIdRef.current !== marketplaceTemplateId

  const handleCloseMarketplaceModal = useCallback(() => {
    dismissedTemplateIdRef.current = marketplaceTemplateId
    // Remove template-id from URL without full navigation
    const params = new URLSearchParams(searchParams.toString())
    params.delete('template-id')
    const newQuery = params.toString()
    replace(newQuery ? `/apps?${newQuery}` : '/apps')
  }, [searchParams, replace, marketplaceTemplateId])

  const handleMarketplaceTemplateConfirm = useCallback(async (
    yamlContent: string,
    template: MarketplaceTemplate,
  ) => {
    const payload = {
      mode: DSLImportMode.YAML_CONTENT,
      yaml_content: yamlContent,
      name: template.template_name,
      icon: template.icon || undefined,
      icon_background: template.icon_background || undefined,
    }
    await handleImportDSL(payload, {
      onSuccess: () => {
        handleCloseMarketplaceModal()
        onSuccess()
      },
      onPending: () => {
        handleCloseMarketplaceModal()
        setShowDSLConfirmModal(true)
      },
    })
  }, [handleImportDSL, onSuccess, handleCloseMarketplaceModal])

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

        {showMarketplaceModal && marketplaceTemplateId && (
          <ImportFromMarketplaceTemplateModal
            templateId={marketplaceTemplateId}
            onConfirm={handleMarketplaceTemplateConfirm}
            onClose={handleCloseMarketplaceModal}
          />
        )}
      </div>
    </AppListContext.Provider>
  )
}

export default Apps
