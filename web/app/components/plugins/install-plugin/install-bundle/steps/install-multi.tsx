'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dependency, GitHubItemAndMarketPlaceDependency, PackageDependency, Plugin } from '../../../types'
import MarketplaceItem from '../item/marketplace-item'
import GithubItem from '../item/github-item'
import { useFetchPluginsInMarketPlaceByIds, useFetchPluginsInMarketPlaceByInfo } from '@/service/use-plugins'
import produce from 'immer'
import { useGetState } from 'ahooks'
import PackageItem from '../item/package-item'
import LoadingError from '../../base/loading-error'

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
  const { isLoading: isFetchingMarketplaceDataFromDSL, data: marketplaceFromDSLRes } = useFetchPluginsInMarketPlaceByIds(allPlugins.filter(d => d.type === 'marketplace').map(d => (d as GitHubItemAndMarketPlaceDependency).value.plugin_unique_identifier!))
  const { isLoading: isFetchingMarketplaceDataFromLocal, data: marketplaceResFromLocalRes } = useFetchPluginsInMarketPlaceByInfo(allPlugins.filter(d => d.type === 'marketplace').map(d => (d as GitHubItemAndMarketPlaceDependency).value!))
  const [plugins, setPlugins, getPlugins] = useGetState<(Plugin | undefined)[]>((() => {
    const hasLocalPackage = allPlugins.some(d => d.type === 'package')
    if (!hasLocalPackage)
      return []

    const _plugins = allPlugins.map((d) => {
      if (d.type === 'package') {
        return {
          ...(d as any).value.manifest,
          plugin_id: (d as any).value.unique_identifier,
        }
      }

      return undefined
    })
    return _plugins
  })())

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
    if (!isFetchingMarketplaceDataFromDSL && marketplaceFromDSLRes?.data.plugins) {
      const payloads = marketplaceFromDSLRes?.data.plugins
      const failedIndex: number[] = []
      const nextPlugins = produce(getPlugins(), (draft) => {
        marketPlaceInDSLIndex.forEach((index, i) => {
          if (payloads[i])
            draft[index] = payloads[i]
          else
            failedIndex.push(index)
        })
      })
      setPlugins(nextPlugins)
      if (failedIndex.length > 0)
        setErrorIndexes([...errorIndexes, ...failedIndex])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFetchingMarketplaceDataFromDSL])

  useEffect(() => {
    if (!isFetchingMarketplaceDataFromLocal && marketplaceResFromLocalRes?.data.list) {
      const payloads = marketplaceResFromLocalRes?.data.list
      const failedIndex: number[] = []
      const nextPlugins = produce(getPlugins(), (draft) => {
        marketPlaceInDSLIndex.forEach((index, i) => {
          if (payloads[i]) {
            const item = payloads[i]
            draft[index] = {
              ...item.plugin,
              plugin_id: item.version.unique_identifier,
            }
          }
          else {
            failedIndex.push(index)
          }
        })
      })
      setPlugins(nextPlugins)
      if (failedIndex.length > 0)
        setErrorIndexes([...errorIndexes, ...failedIndex])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFetchingMarketplaceDataFromLocal])

  const isLoadedAllData = (plugins.filter(p => !!p).length + errorIndexes.length) === allPlugins.length
  useEffect(() => {
    if (isLoadedAllData)
      onLoadedAllPlugin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadedAllData])

  const handleSelect = useCallback((index: number) => {
    return () => {
      onSelect(plugins[index]!, index)
    }
  }, [onSelect, plugins])
  return (
    <>
      {allPlugins.map((d, index) => {
        if (errorIndexes.includes(index)) {
          return (
            <LoadingError key={index} />
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
