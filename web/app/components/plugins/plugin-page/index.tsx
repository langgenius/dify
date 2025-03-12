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
import { fetchBundleInfoFromMarketPlace, fetchManifestFromMarketPlace } from '@/service/plugins'
import { marketplaceApiPrefix } from '@/config'
import { SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS } from '@/config'
import { LanguagesSupported } from '@/i18n/language'
import I18n from '@/context/i18n'

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

  // just support install one package now
  const packageId = useMemo(() => {
    const idStrings = searchParams.get(PACKAGE_IDS_KEY)
    try {
      return idStrings ? JSON.parse(idStrings)[0] : ''
    }
    catch (e) {
      return ''
    }
  }, [searchParams])

  const [dependencies, setDependencies] = useState<Dependency[]>([])
  const bundleInfo = useMemo(() => {
    const info = searchParams.get(BUNDLE_INFO_KEY)
    try {
      return info ? JSON.parse(info) : undefined
    }
    catch (e) {
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

  const uploaderProps = useUploader({
    onFileChange: setCurrentFile,
    containerRef,
    enabled: activeTab === 'plugins',
  })

  const { dragging, fileUploader, fileChangeHandle, removeFile } = uploaderProps

  return (
    <div
      id='marketplace-container'
      ref={containerRef}
      className={cn('grow relative flex flex-col overflow-y-auto border-t border-divider-subtle', activeTab === 'plugins'
        ? 'rounded-t-xl bg-components-panel-bg'
        : 'bg-background-body',
      )}
    >
      <div
        className={cn(
          'sticky top-0 flex min-h-[60px] px-12 pt-4 pb-2 items-center self-stretch gap-1 z-10 bg-components-panel-bg', activeTab === 'discover' && 'bg-background-body',
        )}
      >
        <div className='flex justify-between items-center w-full'>
          <div className='flex-1'>
            <TabSlider
              value={activeTab}
              onChange={setActiveTab}
              options={options}
            />
          </div>
          <div className='flex shrink-0 items-center gap-1'>
            {
              activeTab === 'discover' && (
                <>
                  <Link
                    href={`https://docs.dify.ai/${locale === LanguagesSupported[1] ? 'v/zh-hans/' : ''}plugins/publish-plugins/publish-to-dify-marketplace`}
                    target='_blank'
                  >
                    <Button
                      className='px-3'
                      variant='secondary-accent'
                    >
                      <RiBookOpenLine className='mr-1 w-4 h-4' />
                      {t('plugin.submitPlugin')}
                    </Button>
                  </Link>
                  <div className='mx-2 w-[1px] h-3.5 bg-divider-regular'></div>
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
                    className='w-full h-full p-2 text-components-button-secondary-text group'
                    onClick={setShowPluginSettingModal}
                  >
                    <RiEqualizer2Line className='w-4 h-4' />
                  </Button>
                </Tooltip>
              )
            }
          </div>
        </div>
      </div>
      {activeTab === 'plugins' && (
        <>
          {plugins}
          {dragging && (
            <div
              className="absolute inset-0 m-0.5 p-2 rounded-2xl bg-[rgba(21,90,239,0.14)] border-2
                  border-dashed border-components-dropzone-border-accent">
            </div>
          )}
          <div className={`flex py-4 justify-center items-center gap-2 ${dragging ? 'text-text-accent' : 'text-text-quaternary'}`}>
            <RiDragDropLine className="w-4 h-4" />
            <span className="system-xs-regular">{t('plugin.installModal.dropPluginToInstall')}</span>
          </div>
          {currentFile && (
            <InstallFromLocalPackage
              file={currentFile}
              onClose={removeFile ?? (() => { })}
              onSuccess={() => { }}
            />
          )}
          <input
            ref={fileUploader}
            className="hidden"
            type="file"
            id="fileUploader"
            accept={SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS}
            onChange={fileChangeHandle ?? (() => { })}
          />
        </>
      )}
      {
        activeTab === 'discover' && enable_marketplace && marketplace
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
