'use client'

import type { PluginPageTab } from './context'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  RiBookOpenLine,
  RiBugLine,
  RiDragDropLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import { noop } from 'es-toolkit/function'
import { cloneElement, isValidElement, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import TabSlider from '@/app/components/base/tab-slider'
import ReferenceSettingModal from '@/app/components/plugins/reference-setting-modal'
import { SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS } from '@/config'
import { useDocLink } from '@/context/i18n'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { PLUGIN_PAGE_TABS_MAP } from '../hooks'
import { PluginInstallPermissionProvider } from '../install-plugin/components/plugin-install-permission-provider'
import InstallFromLocalPackage from '../install-plugin/install-from-local-package'
import InstallFromMarketplaceQuery from '../install-plugin/install-from-marketplace-query'
import { PLUGIN_TYPE_SEARCH_MAP } from '../marketplace/constants'
import { getInstallRedirectPathByPluginCategory } from '../plugin-routes'
import { PluginCategoryEnum } from '../types'
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

const getCurrentInstallSearchParams = (packageId: string) => {
  const searchParams: Record<string, string | string[]> = {}

  new URLSearchParams(window.location.search).forEach((value, key) => {
    const existing = searchParams[key]
    if (existing === undefined) {
      searchParams[key] = value
      return
    }

    if (Array.isArray(existing)) {
      existing.push(value)
      return
    }

    searchParams[key] = [existing, value]
  })

  searchParams['package-ids'] ??= JSON.stringify([packageId])

  return searchParams
}

export type PluginPageProps = {
  plugins: React.ReactNode
  marketplace: React.ReactNode
}
type PluginPanelPermissionProps = {
  canInstall?: boolean
  canDeletePlugin?: boolean
  canUpdatePlugin?: boolean
}
const PluginPage = ({
  plugins,
  marketplace,
}: PluginPageProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { replace } = useRouter()

  const {
    referenceSetting,
    canInstallPlugin,
    canUpdatePlugin,
    canDeletePlugin,
    canDebugger,
    canSetPermissions,
    canSetPluginPreferences,
    currentDifyVersion,
    isPermissionLoading,
    isReferenceSettingLoading,
    setReferenceSettings,
  } = useReferenceSetting(PluginCategoryEnum.tool)

  const handlePackageCategoryResolved = useCallback((category: string | undefined, packageId: string) => {
    const installRedirectPath = getInstallRedirectPathByPluginCategory(category, getCurrentInstallSearchParams(packageId))
    if (!installRedirectPath)
      return false

    replace(installRedirectPath)
    return true
  }, [replace])

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
  useDocumentTitle(isExploringMarketplace
    ? t('mainNav.marketplace', { ns: 'common' })
    : t('metadata.title', { ns: 'plugin' }))

  const handleFileChange = (file: File | null) => {
    if (!canInstallPlugin) {
      setCurrentFile(null)
      return
    }

    if (!file || !file.name.endsWith('.difypkg')) {
      setCurrentFile(null)
      return
    }

    setCurrentFile(file)
  }
  const uploaderProps = useUploader({
    onFileChange: handleFileChange,
    containerRef,
    enabled: isPluginsTab && canInstallPlugin,
  })

  const { dragging, fileUploader, fileChangeHandle, removeFile } = uploaderProps
  const pluginsWithPermission = useMemo(() => {
    if (!isValidElement(plugins) || typeof plugins.type === 'string')
      return plugins

    return cloneElement(plugins as React.ReactElement<PluginPanelPermissionProps>, {
      canInstall: canInstallPlugin,
      canDeletePlugin,
      canUpdatePlugin,
    })
  }, [canInstallPlugin, canDeletePlugin, canUpdatePlugin, plugins])

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
                      <RiBookOpenLine className="mr-1 size-4" />
                      {t('publishPlugins', { ns: 'plugin' })}
                    </Button>
                  </Link>
                  <div className="mx-1 h-3.5 w-px shrink-0 bg-divider-regular"></div>
                </>
              )
            }
            <PluginTasks />
            {(canInstallPlugin || isPermissionLoading) && (
              <InstallPluginDropdown
                disabled={isPermissionLoading || !canInstallPlugin}
                onSwitchToMarketplaceTab={() => setActiveTab('discover')}
              />
            )}
            {
              canDebugger && (
                <DebugInfo />
              )
            }
            {isPermissionLoading && (
              <Button
                className="h-full w-full p-2 text-components-button-secondary-text"
                disabled
                loading
              >
                <RiBugLine className="h-4 w-4" />
              </Button>
            )}
            {
              (canSetPermissions || canSetPluginPreferences) && (
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button
                        aria-label={t('privilege.title', { ns: 'plugin' })}
                        className="group size-full p-2 text-components-button-secondary-text"
                        disabled={isReferenceSettingLoading || !referenceSetting}
                        loading={isReferenceSettingLoading}
                        onClick={setShowPluginSettingModal}
                      >
                        <RiEqualizer2Line className="size-4" aria-hidden="true" />
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
          <PluginInstallPermissionProvider
            canInstallPlugin={canInstallPlugin}
            canUpdatePlugin={canUpdatePlugin}
            currentDifyVersion={currentDifyVersion}
          >
            {pluginsWithPermission}
          </PluginInstallPermissionProvider>
          {dragging && (
            <div
              className="absolute inset-0 m-0.5 rounded-2xl border-2 border-dashed border-components-dropzone-border-accent
                  bg-[rgba(21,90,239,0.14)] p-2"
            >
            </div>
          )}
          {canInstallPlugin && (
            <div className={`flex items-center justify-center gap-2 py-4 ${dragging ? 'text-text-accent' : 'text-text-quaternary'}`}>
              <RiDragDropLine className="size-4" />
              <span className="system-xs-regular">{t('installModal.dropPluginToInstall', { ns: 'plugin' })}</span>
            </div>
          )}
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
        isExploringMarketplace && enable_marketplace && (
          <PluginInstallPermissionProvider
            canInstallPlugin={canInstallPlugin}
            canUpdatePlugin={canUpdatePlugin}
            currentDifyVersion={currentDifyVersion}
          >
            {marketplace}
          </PluginInstallPermissionProvider>
        )
      }

      {showPluginSettingModal && referenceSetting && (
        <ReferenceSettingModal
          payload={referenceSetting}
          canSetPermissions={canSetPermissions}
          canSetAutoUpdate={canSetPluginPreferences}
          onHide={setHidePluginSettingModal}
          onSave={setReferenceSettings}
        />
      )}

      <InstallFromMarketplaceQuery
        canInstallPlugin={canInstallPlugin}
        isPermissionLoading={isPermissionLoading}
        onPackageCategoryResolved={handlePackageCategoryResolved}
      />
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
