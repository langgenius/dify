'use client'

import type { ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { noop } from 'es-toolkit/function'
import { useMemo, useState } from 'react'
import InstallFromLocalPackage from '@/app/components/plugins/install-plugin/install-from-local-package'
import InstallFromMarketplaceQuery from '@/app/components/plugins/install-plugin/install-from-marketplace-query'
import { usePluginPageContext } from '@/app/components/plugins/plugin-page/context'
import { PluginPageContextProvider } from '@/app/components/plugins/plugin-page/context-provider'
import PluginsPanel from '@/app/components/plugins/plugin-page/plugins-panel'
import { useUploader } from '@/app/components/plugins/plugin-page/use-uploader'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS } from '@/config'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

type PluginCategoryPageProps = {
  canInstall?: boolean
  canDeletePlugin?: boolean
  isInstallPermissionLoading?: boolean
  canUpdatePlugin?: boolean
  category: PluginCategoryEnum
  layout?: (parts: { body: ReactNode, toolbar: ReactNode }) => ReactNode
  onSwitchToMarketplace?: () => void
  toolbarAction?: ReactNode
}

const supportedLocalPackageExtensions = SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS.split(',')

const PluginCategoryPageContent = ({
  canInstall = true,
  canDeletePlugin = true,
  isInstallPermissionLoading = false,
  canUpdatePlugin = true,
  category,
  layout,
  onSwitchToMarketplace,
  toolbarAction,
}: PluginCategoryPageProps) => {
  const [currentFile, setCurrentFile] = useState<File | null>(null)
  const containerRef = usePluginPageContext(v => v.containerRef)
  const { data: pluginInstallationPermission } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.plugin_installation_permission,
  })
  const supportsDropInstall = category === PluginCategoryEnum.tool || category === PluginCategoryEnum.trigger || category === PluginCategoryEnum.agent || category === PluginCategoryEnum.extension
  const canDropLocalPackage = canInstall && supportsDropInstall && !pluginInstallationPermission.restrict_to_marketplace_only

  const handleFileChange = (file: File | null) => {
    if (!canInstall) {
      setCurrentFile(null)
      return
    }

    if (!file || !supportedLocalPackageExtensions.some(extension => file.name.endsWith(extension))) {
      setCurrentFile(null)
      return
    }

    setCurrentFile(file)
  }
  const {
    dragging,
    fileUploader,
    fileChangeHandle,
    removeFile,
  } = useUploader({
    onFileChange: handleFileChange,
    containerRef,
    enabled: canDropLocalPackage,
  })

  return (
    <div ref={containerRef} className="relative flex h-0 grow flex-col overflow-hidden bg-components-panel-bg">
      <PluginsPanel
        canInstall={canInstall}
        canDeletePlugin={canDeletePlugin}
        canUpdatePlugin={canUpdatePlugin}
        contentInset="compact"
        fixedCategory={category}
        layout={layout}
        onSwitchToMarketplace={onSwitchToMarketplace}
        toolbarAction={toolbarAction}
      />
      {dragging && (
        <div
          className="absolute inset-0 m-0.5 rounded-2xl border-2 border-dashed border-components-dropzone-border-accent
            bg-[rgba(21,90,239,0.14)] p-2"
        />
      )}
      {currentFile && (
        <InstallFromLocalPackage
          file={currentFile}
          installContextCategory={category}
          onClose={removeFile ?? noop}
          onSuccess={noop}
        />
      )}
      <InstallFromMarketplaceQuery
        canInstallPlugin={canInstall}
        isPermissionLoading={isInstallPermissionLoading}
        installContextCategory={category}
      />
      <input
        ref={fileUploader}
        className="hidden"
        type="file"
        id="fileUploader"
        accept={SUPPORT_INSTALL_LOCAL_FILE_EXTENSIONS}
        onChange={fileChangeHandle ?? noop}
      />
    </div>
  )
}

const PluginCategoryPage = ({
  canInstall = true,
  canDeletePlugin = true,
  isInstallPermissionLoading = false,
  canUpdatePlugin = true,
  category,
  layout,
  onSwitchToMarketplace,
  toolbarAction,
}: PluginCategoryPageProps) => {
  const initialFilters = useMemo(() => ({
    categories: [category],
    tags: [],
    searchQuery: '',
  }), [category])

  return (
    <PluginPageContextProvider key={category} initialFilters={initialFilters}>
      <PluginCategoryPageContent
        canInstall={canInstall}
        canDeletePlugin={canDeletePlugin}
        isInstallPermissionLoading={isInstallPermissionLoading}
        canUpdatePlugin={canUpdatePlugin}
        category={category}
        layout={layout}
        onSwitchToMarketplace={onSwitchToMarketplace}
        toolbarAction={toolbarAction}
      />
    </PluginPageContextProvider>
  )
}

export default PluginCategoryPage
