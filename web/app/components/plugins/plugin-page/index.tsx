'use client'

import type { Dependency, PluginDeclaration, PluginManifestInMarket } from '../types'
import {
  RiDragDropLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { noop } from 'es-toolkit/function'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import TabSlider from '@/app/components/base/tab-slider'
import Tooltip from '@/app/components/base/tooltip'
import ReferenceSettingModal from '@/app/components/plugins/reference-setting-modal'
import { MARKETPLACE_API_PREFIX, SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS } from '@/config'
import { useGlobalPublicStore } from '@/context/global-public-context'
import useDocumentTitle from '@/hooks/use-document-title'
import { usePluginInstallation } from '@/hooks/use-query-params'
import { fetchBundleInfoFromMarketPlace, fetchManifestFromMarketPlace } from '@/service/plugins'
import { sleep } from '@/utils'
import { PLUGIN_PAGE_TABS_MAP } from '../hooks'
import InstallFromLocalPackage from '../install-plugin/install-from-local-package'
import InstallFromMarketplace from '../install-plugin/install-from-marketplace'
import { PLUGIN_TYPE_SEARCH_MAP } from '../marketplace/constants'
import SearchBoxWrapper from '../marketplace/search-box/search-box-wrapper'
import {
  PluginPageContextProvider,
  usePluginPageContext,
} from './context'
import DebugInfo from './debug-info'
import InstallPluginDropdown from './install-plugin-dropdown'
import { SubmitRequestDropdown } from './nav-operations'
import PluginTasks from './plugin-tasks'
import useReferenceSetting from './use-reference-setting'
import { useUploader } from './use-uploader'

export type PluginPageProps = {
  plugins: React.ReactNode
  marketplace: React.ReactNode
}
const PluginPage = ({
  plugins,
  marketplace,
}: PluginPageProps) => {
  const { t } = useTranslation()
  useDocumentTitle(t('metadata.title', { ns: 'plugin' }))

  // Use nuqs hook for installation state
  const [{ packageId, bundleInfo }, setInstallState] = usePluginInstallation()

  const [uniqueIdentifier, setUniqueIdentifier] = useState<string | null>(null)
  const [dependencies, setDependencies] = useState<Dependency[]>([])

  const [isShowInstallFromMarketplace, {
    setTrue: showInstallFromMarketplace,
    setFalse: doHideInstallFromMarketplace,
  }] = useBoolean(false)

  const hideInstallFromMarketplace = () => {
    doHideInstallFromMarketplace()
    setInstallState(null)
  }

  const [manifest, setManifest] = useState<PluginDeclaration | PluginManifestInMarket | null>(null)

  useEffect(() => {
    (async () => {
      setUniqueIdentifier(null)
      await sleep(100)
      if (packageId) {
        const { data } = await fetchManifestFromMarketPlace(encodeURIComponent(packageId))
        const { plugin, version } = data
        setManifest({
          ...plugin,
          version: version.version,
          icon: `${MARKETPLACE_API_PREFIX}/plugins/${plugin.org}/${plugin.name}/icon`,
        })
        setUniqueIdentifier(packageId)
        showInstallFromMarketplace()
        return
      }
      if (bundleInfo) {
        try {
          const { data } = await fetchBundleInfoFromMarketPlace(bundleInfo)
          setDependencies(data.version.dependencies)
          showInstallFromMarketplace()
        }
        catch (error) {
          console.error('Failed to load bundle info:', error)
        }
      }
    })()
  }, [packageId, bundleInfo, showInstallFromMarketplace])

  const {
    referenceSetting,
    canManagement,
    canDebugger,
    canSetPermissions,
    setReferenceSettings,
  } = useReferenceSetting()
  const [showPluginSettingModal, {
    setTrue: setShowPluginSettingModal,
    setFalse: setHidePluginSettingModal,
  }] = useBoolean(false)
  const [currentFile, setCurrentFile] = useState<File | null>(null)
  const containerRef = usePluginPageContext(v => v.containerRef)
  const options = usePluginPageContext(v => v.options)
  const activeTab = usePluginPageContext(v => v.activeTab)
  const setActiveTab = usePluginPageContext(v => v.setActiveTab)
  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)

  const isPluginsTab = useMemo(() => activeTab === PLUGIN_PAGE_TABS_MAP.plugins, [activeTab])
  const isExploringMarketplace = useMemo(() => {
    const values = Object.values(PLUGIN_TYPE_SEARCH_MAP)
    return activeTab === PLUGIN_PAGE_TABS_MAP.marketplace || values.includes(activeTab)
  }, [activeTab])

  const handleFileChange = (file: File | null) => {
    if (!file || !file.name.endsWith('.difypkg')) {
      setCurrentFile(null)
      return
    }

    setCurrentFile(file)
  }
  const uploaderProps = useUploader({
    onFileChange: handleFileChange,
    containerRef,
    enabled: isPluginsTab && canManagement,
  })

  const { dragging, fileUploader, fileChangeHandle, removeFile } = uploaderProps
  return (
    <div
      id="marketplace-container"
      ref={containerRef}
      style={{ scrollbarGutter: 'stable' }}
      className="relative flex grow flex-col overflow-y-auto rounded-t-xl border-t border-divider-subtle bg-components-panel-bg"
    >
      <div className="sticky top-0 z-10 flex min-h-[60px] items-center gap-1 self-stretch bg-components-panel-bg px-12 pb-2 pt-4">
        <div className="flex w-full items-center justify-between">
          <div className="flex flex-1 items-center justify-start gap-2">
            <TabSlider
              value={isPluginsTab ? PLUGIN_PAGE_TABS_MAP.plugins : PLUGIN_PAGE_TABS_MAP.marketplace}
              onChange={setActiveTab}
              options={options}
            />
            {!isPluginsTab && <SearchBoxWrapper wrapperClassName="w-[360px] mx-0" inputClassName="p-0" />}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isExploringMarketplace && <SubmitRequestDropdown />}
            <PluginTasks />
            {canManagement && (
              <InstallPluginDropdown
                onSwitchToMarketplaceTab={() => setActiveTab('discover')}
              />
            )}
            {
              canDebugger && (
                <DebugInfo />
              )
            }
            {
              canSetPermissions && (
                <Tooltip
                  popupContent={t('privilege.title', { ns: 'plugin' })}
                >
                  <Button
                    data-testid="plugin-settings-button"
                    className="group h-full w-full p-2 text-components-button-secondary-text"
                    onClick={setShowPluginSettingModal}
                  >
                    <RiEqualizer2Line className="h-4 w-4" />
                  </Button>
                </Tooltip>
              )
            }
          </div>
        </div>
      </div>
      {isPluginsTab && (
        <>
          {plugins}
          {dragging && (
            <div
              className="absolute inset-0 m-0.5 rounded-2xl border-2 border-dashed border-components-dropzone-border-accent
                  bg-[rgba(21,90,239,0.14)] p-2"
            >
            </div>
          )}
          <div className={`flex items-center justify-center gap-2 py-4 ${dragging ? 'text-text-accent' : 'text-text-quaternary'}`}>
            <RiDragDropLine className="h-4 w-4" />
            <span className="system-xs-regular">{t('installModal.dropPluginToInstall', { ns: 'plugin' })}</span>
          </div>
          {currentFile && (
            <InstallFromLocalPackage
              file={currentFile}
              onClose={removeFile ?? noop}
              onSuccess={noop}
            />
          )}
          <input
            ref={fileUploader}
            className="hidden"
            type="file"
            id="fileUploader"
            accept={SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS}
            onChange={fileChangeHandle ?? noop}
          />
        </>
      )}
      {
        isExploringMarketplace && enable_marketplace && marketplace
      }

      {showPluginSettingModal && (
        <ReferenceSettingModal
          payload={referenceSetting!}
          onHide={setHidePluginSettingModal}
          onSave={setReferenceSettings}
        />
      )}

      {
        isShowInstallFromMarketplace && uniqueIdentifier && (
          <InstallFromMarketplace
            manifest={manifest! as PluginManifestInMarket}
            uniqueIdentifier={uniqueIdentifier}
            isBundle={!!bundleInfo}
            dependencies={dependencies}
            onClose={hideInstallFromMarketplace}
            onSuccess={hideInstallFromMarketplace}
          />
        )
      }
    </div>
  )
}

const PluginPageWithContext = (props: PluginPageProps) => {
  return (
    <PluginPageContextProvider>
      <PluginPage {...props} />
    </PluginPageContextProvider>
  )
}

export default PluginPageWithContext
