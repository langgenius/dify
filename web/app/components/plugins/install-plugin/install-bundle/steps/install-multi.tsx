'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dependency, GitHubItemAndMarketPlaceDependency, PackageDependency, Plugin } from '../../../types'
import MarketplaceItem from '../item/marketplace-item'
import GithubItem from '../item/github-item'
import { useFetchPluginsInMarketPlaceByIds } from '@/service/use-plugins'
import produce from 'immer'
import { useGetState } from 'ahooks'
import PackageItem from '../item/package-item'

type Props = {
  allPlugins: Dependency[]
  selectedPlugins: Plugin[]
  onSelect: (plugin: Plugin, selectedIndex: number) => void
  onLoadedAllPlugin: () => void
}

const InstallByDSLList: FC<Props> = ({
  allPlugins,
  selectedPlugins,
  onSelect,
  onLoadedAllPlugin,
}) => {
  const { isLoading: isFetchingMarketplaceData, data: marketplaceRes } = useFetchPluginsInMarketPlaceByIds(allPlugins.filter(d => d.type === 'marketplace').map(d => d.value.plugin_unique_identifier!))

  const [plugins, setPlugins, getPlugins] = useGetState<Plugin[]>([])

  const [errorIndexes, setErrorIndexes] = useState<number[]>([])

  const handleGitHubPluginFetched = useCallback((index: number) => {
    return (p: Plugin) => {
      const nextPlugins = produce(getPlugins(), (draft) => {
        draft[index] = p
      })
      setPlugins(nextPlugins)
    }
  }, [getPlugins, setPlugins])

  const handleGitHubPluginFetchError = useCallback((index: number) => {
    return () => {
      setErrorIndexes([...errorIndexes, index])
    }
  }, [errorIndexes])

  const marketPlaceInDSLIndex = useMemo(() => {
    const res: number[] = []
    allPlugins.forEach((d, index) => {
      if (d.type === 'marketplace')
        res.push(index)
    })
    return res
  }, [allPlugins])

  useEffect(() => {
    if (!isFetchingMarketplaceData && marketplaceRes?.data.plugins && marketplaceRes?.data.plugins.length > 0) {
      const payloads = marketplaceRes?.data.plugins

      const nextPlugins = produce(getPlugins(), (draft) => {
        marketPlaceInDSLIndex.forEach((index, i) => {
          draft[index] = payloads[i]
        })
      })
      setPlugins(nextPlugins)
      // marketplaceRes?.data.plugins
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFetchingMarketplaceData])

  const isLoadedAllData = allPlugins.length === plugins.length && plugins.every(p => !!p)
  useEffect(() => {
    if (isLoadedAllData)
      onLoadedAllPlugin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadedAllData])

  const handleSelect = useCallback((index: number) => {
    return () => {
      onSelect(plugins[index], index)
    }
  }, [onSelect, plugins])
  return (
    <>
      {allPlugins.map((d, index) => {
        if (errorIndexes.includes(index)) {
          return (
            <div key={index}>error</div>
          )
        }
        if (d.type === 'github') {
          return (<GithubItem
            key={index}
            checked={!!selectedPlugins.find(p => p.plugin_id === plugins[index]?.plugin_id)}
            onCheckedChange={handleSelect(index)}
            dependency={d as GitHubItemAndMarketPlaceDependency}
            onFetchedPayload={handleGitHubPluginFetched(index)}
            onFetchError={handleGitHubPluginFetchError(index)}
          />)
        }

        if (d.type === 'marketplace') {
          return (
            <MarketplaceItem
              key={index}
              checked={!!selectedPlugins.find(p => p.plugin_id === plugins[index]?.plugin_id)}
              onCheckedChange={handleSelect(index)}
              payload={plugins[index] as Plugin}
            />
          )
        }

        return (
          <PackageItem
            key={index}
            checked={!!selectedPlugins.find(p => p.plugin_id === plugins[index]?.plugin_id)}
            onCheckedChange={handleSelect(index)}
            payload={d as PackageDependency}
          />
        )
      })
      }
    </>
  )
}
export default React.memo(InstallByDSLList)
