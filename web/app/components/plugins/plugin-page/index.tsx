'use client'

import type { Dependency, PluginDeclaration, PluginManifestInMarket } from '../types'
import type { PluginPageTab } from './context'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  RiBookOpenLine,
  RiDragDropLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import { noop } from 'es-toolkit/function'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import TabSlider from '@/app/components/base/tab-slider'
import ReferenceSettingModal from '@/app/components/plugins/reference-setting-modal'
import { MARKETPLACE_API_PREFIX, SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS } from '@/config'
import { useDocLink } from '@/context/i18n'
import useDocumentTitle from '@/hooks/use-document-title'
import { usePluginInstallation } from '@/hooks/use-query-params'
import Link from '@/next/link'
import { fetchBundleInfoFromMarketPlace, fetchManifestFromMarketPlace } from '@/service/plugins'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { sleep } from '@/utils'
import { PLUGIN_PAGE_TABS_MAP } from '../hooks'
import InstallFromLocalPackage from '../install-plugin/install-from-local-package'
import InstallFromMarketplace from '../install-plugin/install-from-marketplace'
import { PLUGIN_TYPE_SEARCH_MAP } from '../marketplace/constants'
import { usePluginPageContext } from './context'
import { PluginPageContextProvider } from './context-provider'
import DebugInfo from './debug-info'
import InstallPluginDropdown from './install-plugin-dropdown'
import PluginTasks from './plugin-tasks'
import useReferenceSetting from './use-reference-setting'
import { useUploader } from './use-uploader'

const pluginPageTabSet = new Set<string>([
  PLUGIN_PAGE_TABS_MAP.plugins,
  PLUGIN_PAGE_TABS_MAP.marketplace,
  ...Object.values(PLUGIN_TYPE_SEARCH_MAP),
])

const isPluginPageTab = (value: string): value is PluginPageTab => {
  return pluginPageTabSet.has(value)
}

export type PluginPageProps = {
  plugins: React.ReactNode
  marketplace: React.ReactNode
}
const PluginPage = ({
  plugins,
  marketplace,
}: PluginPageProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
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
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })

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
      className={cn('relative flex grow flex-col overflow-y-auto border-t border-divider-subtle', isPluginsTab
        ? 'rounded-t-xl bg-components-panel-bg'
        : 'bg-background-body')}
    >
      <div
        className={cn(
          'sticky top-0 z-10 flex min-h-[60px] items-center gap-1 self-stretch bg-components-panel-bg px-12 pt-4 pb-2',
          isExploringMarketplace && 'bg-background-body',
        )}
      >
        <div className="flex w-full items-center justify-between">
          <div className="flex-1">
            <TabSlider
              value={isPluginsTab ? PLUGIN_PAGE_TABS_MAP.plugins : PLUGIN_PAGE_TABS_MAP.marketplace}
              onChange={(nextTab) => {
                if (isPluginPageTab(nextTab))
                  setActiveTab(nextTab)
              }}
              options={options}
            />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {
              isExploringMarketplace && (
                <>
                  <Link
                    href="https://github.com/langgenius/dify-plugins/issues/new?template=plugin_request.yaml"
                    target="_blank"
                  >
                    <Button
                      variant="ghost"
                      className="text-text-tertiary"
                    >
                      {t('requestAPlugin', { ns: 'plugin' })}
                    </Button>
                  </Link>
                  <Link
                    href={docLink('/develop-plugin/publishing/marketplace-listing/release-to-dify-marketplace')}
                    target="_blank"
                  >
                    <Button
                      className="px-3"
                      variant="secondary-accent"
                    >
                      <RiBookOpenLine className="mr-1 h-4 w-4" />
                      {t('publishPlugins', { ns: 'plugin' })}
                    </Button>
                  </Link>
                  <div className="mx-1 h-3.5 w-px shrink-0 bg-divider-regular"></div>
                </>
              )
            }
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
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button
                        aria-label={t('privilege.title', { ns: 'plugin' })}
                        className="group h-full w-full p-2 text-components-button-secondary-text"
                        onClick={setShowPluginSettingModal}
                      >
                        <RiEqualizer2Line className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                  />
                  <TooltipContent>
                    {t('privilege.title', { ns: 'plugin' })}
                  </TooltipContent>
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
