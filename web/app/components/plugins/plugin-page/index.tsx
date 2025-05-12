'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Link from 'next/link'
import {
  RiBookOpenLine,
  RiDragDropLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import InstallFromLocalPackage from '../install-plugin/install-from-local-package'
import {
  PluginPageContextProvider,
  usePluginPageContext,
} from './context'
import InstallPluginDropdown from './install-plugin-dropdown'
import { useUploader } from './use-uploader'
import usePermission from './use-permission'
import DebugInfo from './debug-info'
import PluginTasks from './plugin-tasks'
import Button from '@/app/components/base/button'
import TabSlider from '@/app/components/base/tab-slider'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'
import PermissionSetModal from '@/app/components/plugins/permission-setting-modal/modal'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import InstallFromMarketplace from '../install-plugin/install-from-marketplace'
import {
  useRouter,
  useSearchParams,
} from 'next/navigation'
import type { Dependency } from '../types'
import type { PluginDeclaration, PluginManifestInMarket } from '../types'
import { sleep } from '@/utils'
import { getDocsUrl } from '@/app/components/plugins/utils'
import { fetchBundleInfoFromMarketPlace, fetchManifestFromMarketPlace } from '@/service/plugins'
import { marketplaceApiPrefix } from '@/config'
import { SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS } from '@/config'
import I18n from '@/context/i18n'
import { noop } from 'lodash-es'
import { PLUGIN_TYPE_SEARCH_MAP } from '../marketplace/plugin-type-switch'
import { PLUGIN_PAGE_TABS_MAP } from '../hooks'

const PACKAGE_IDS_KEY = 'package-ids'
const BUNDLE_INFO_KEY = 'bundle-info'

export type PluginPageProps = {
  plugins: React.ReactNode
  marketplace: React.ReactNode
}
const PluginPage = ({
  plugins,
  marketplace,
}: PluginPageProps) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const searchParams = useSearchParams()
  const { replace } = useRouter()

  document.title = `${t('plugin.metadata.title')} - Dify`

  // just support install one package now
  const packageId = useMemo(() => {
    const idStrings = searchParams.get(PACKAGE_IDS_KEY)
    try {
      return idStrings ? JSON.parse(idStrings)[0] : ''
    }
    catch {
      return ''
    }
  }, [searchParams])

  const [dependencies, setDependencies] = useState<Dependency[]>([])
  const bundleInfo = useMemo(() => {
    const info = searchParams.get(BUNDLE_INFO_KEY)
    try {
      return info ? JSON.parse(info) : undefined
    }
    catch {
      return undefined
    }
  }, [searchParams])

  const [isShowInstallFromMarketplace, {
    setTrue: showInstallFromMarketplace,
    setFalse: doHideInstallFromMarketplace,
  }] = useBoolean(false)

  const hideInstallFromMarketplace = () => {
    doHideInstallFromMarketplace()
    const url = new URL(window.location.href)
    url.searchParams.delete(PACKAGE_IDS_KEY)
    url.searchParams.delete(BUNDLE_INFO_KEY)
    replace(url.toString())
  }
  const [manifest, setManifest] = useState<PluginDeclaration | PluginManifestInMarket | null>(null)

  useEffect(() => {
    (async () => {
      await sleep(100)
      if (packageId) {
        const { data } = await fetchManifestFromMarketPlace(encodeURIComponent(packageId))
        const { plugin, version } = data
        setManifest({
          ...plugin,
          version: version.version,
          icon: `${marketplaceApiPrefix}/plugins/${plugin.org}/${plugin.name}/icon`,
        })
        showInstallFromMarketplace()
        return
      }
      if (bundleInfo) {
        const { data } = await fetchBundleInfoFromMarketPlace(bundleInfo)
        setDependencies(data.version.dependencies)
        showInstallFromMarketplace()
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId, bundleInfo])

  const {
    canManagement,
    canDebugger,
    canSetPermissions,
    permissions,
    setPermissions,
  } = usePermission()
  const [showPluginSettingModal, {
    setTrue: setShowPluginSettingModal,
    setFalse: setHidePluginSettingModal,
  }] = useBoolean()
  const [currentFile, setCurrentFile] = useState<File | null>(null)
  const containerRef = usePluginPageContext(v => v.containerRef)
  const options = usePluginPageContext(v => v.options)
  const activeTab = usePluginPageContext(v => v.activeTab)
  const setActiveTab = usePluginPageContext(v => v.setActiveTab)
  const { enable_marketplace } = useAppContextSelector(s => s.systemFeatures)

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
      id='marketplace-container'
      ref={containerRef}
      style={{ scrollbarGutter: 'stable' }}
      className={cn('relative flex grow flex-col overflow-y-auto border-t border-divider-subtle', isPluginsTab
        ? 'rounded-t-xl bg-components-panel-bg'
        : 'bg-background-body',
      )}
    >
      <div
        className={cn(
          'sticky top-0 z-10 flex min-h-[60px] items-center gap-1 self-stretch bg-components-panel-bg px-12 pb-2 pt-4', isExploringMarketplace && 'bg-background-body',
        )}
      >
        <div className='flex w-full items-center justify-between'>
          <div className='flex-1'>
            <TabSlider
              value={isPluginsTab ? PLUGIN_PAGE_TABS_MAP.plugins : PLUGIN_PAGE_TABS_MAP.marketplace}
              onChange={setActiveTab}
              options={options}
            />
          </div>
          <div className='flex shrink-0 items-center gap-1'>
            {
              isExploringMarketplace && (
                <>
                  <Link
                    href={getDocsUrl(locale, '/plugins/publish-plugins/publish-to-dify-marketplace/README')}
                    target='_blank'
                  >
                    <Button
                      className='px-3'
                      variant='secondary-accent'
                    >
                      <RiBookOpenLine className='mr-1 h-4 w-4' />
                      {t('plugin.submitPlugin')}
                    </Button>
                  </Link>
                  <div className='mx-2 h-3.5 w-[1px] bg-divider-regular'></div>
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
                <Tooltip
                  popupContent={t('plugin.privilege.title')}
                >
                  <Button
                    className='group h-full w-full p-2 text-components-button-secondary-text'
                    onClick={setShowPluginSettingModal}
                  >
                    <RiEqualizer2Line className='h-4 w-4' />
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
                  bg-[rgba(21,90,239,0.14)] p-2">
            </div>
          )}
          <div className={`flex items-center justify-center gap-2 py-4 ${dragging ? 'text-text-accent' : 'text-text-quaternary'}`}>
            <RiDragDropLine className="h-4 w-4" />
            <span className="system-xs-regular">{t('plugin.installModal.dropPluginToInstall')}</span>
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
        <PermissionSetModal
          payload={permissions!}
          onHide={setHidePluginSettingModal}
          onSave={setPermissions}
        />
      )}

      {
        isShowInstallFromMarketplace && (
          <InstallFromMarketplace
            manifest={manifest! as PluginManifestInMarket}
            uniqueIdentifier={packageId}
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
