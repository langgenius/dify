'use client'
import type { Dependency, GitHubItemAndMarketPlaceDependency, PackageDependency, Plugin, VersionInfo } from '../../../types'
import * as React from 'react'
import { useImperativeHandle } from 'react'
import LoadingError from '../../base/loading-error'
import GithubItem from '../item/github-item'
import MarketplaceItem from '../item/marketplace-item'
import PackageItem from '../item/package-item'
import { getPluginKey, useInstallMultiState } from './hooks/use-install-multi-state'

type Props = {
  allPlugins: Dependency[]
  selectedPlugins: Plugin[]
  onSelect: (plugin: Plugin, selectedIndex: number, allCanInstallPluginsLength: number) => void
  onSelectAll: (plugins: Plugin[], selectedIndexes: number[]) => void
  onDeSelectAll: () => void
  onLoadedAllPlugin: (installedInfo: Record<string, VersionInfo>) => void
  isFromMarketPlace?: boolean
  ref?: React.Ref<ExposeRefs>
}

export type ExposeRefs = {
  selectAllPlugins: () => void
  deSelectAllPlugins: () => void
}

const InstallByDSLList = ({
  allPlugins,
  selectedPlugins,
  onSelect,
  onSelectAll,
  onDeSelectAll,
  onLoadedAllPlugin,
  isFromMarketPlace,
  ref,
}: Props) => {
  const {
    plugins,
    errorIndexes,
    handleGitHubPluginFetched,
    handleGitHubPluginFetchError,
    getVersionInfo,
    handleSelect,
    isPluginSelected,
    getInstallablePlugins,
  } = useInstallMultiState({
    allPlugins,
    selectedPlugins,
    onSelect,
    onLoadedAllPlugin,
  })

  useImperativeHandle(ref, () => ({
    selectAllPlugins: () => {
      const { installablePlugins, selectedIndexes } = getInstallablePlugins()
      onSelectAll(installablePlugins, selectedIndexes)
    },
    deSelectAllPlugins: onDeSelectAll,
  }))

  return (
    <>
      {allPlugins.map((d, index) => {
        if (errorIndexes.includes(index))
          return <LoadingError key={index} />

        const plugin = plugins[index]
        const checked = isPluginSelected(index)
        const versionInfo = getVersionInfo(getPluginKey(plugin))

        if (d.type === 'github') {
          return (
            <GithubItem
              key={index}
              checked={checked}
              onCheckedChange={handleSelect(index)}
              dependency={d as GitHubItemAndMarketPlaceDependency}
              onFetchedPayload={handleGitHubPluginFetched(index)}
              onFetchError={handleGitHubPluginFetchError(index)}
              versionInfo={versionInfo}
            />
          )
        }

        if (d.type === 'marketplace') {
          return (
            <MarketplaceItem
              key={index}
              checked={checked}
              onCheckedChange={handleSelect(index)}
              payload={{ ...plugin, from: d.type } as Plugin}
              version={(d as GitHubItemAndMarketPlaceDependency).value.version! || plugin?.version || ''}
              versionInfo={versionInfo}
            />
          )
        }

        return (
          <PackageItem
            key={index}
            checked={checked}
            onCheckedChange={handleSelect(index)}
            payload={d as PackageDependency}
            isFromMarketPlace={isFromMarketPlace}
            versionInfo={versionInfo}
          />
        )
      })}
    </>
  )
}
export default InstallByDSLList
