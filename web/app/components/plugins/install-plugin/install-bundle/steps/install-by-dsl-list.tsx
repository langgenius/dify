'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo } from 'react'
import type { Dependency, Plugin } from '../../../types'
import MarketplaceItem from '../item/marketplace-item'
import GithubItem from '../item/github-item'
import { useFetchPluginsInMarketPlaceByIds } from '@/service/use-plugins'
import produce from 'immer'
import { useGetState } from 'ahooks'

type Props = {
  fromDSLPayload: Dependency[]
  selectedPlugins: Plugin[]
  onSelect: (plugin: Plugin, selectedIndex: number) => void
  onLoadedAllPlugin: () => void
}

const InstallByDSLList: FC<Props> = ({
  fromDSLPayload,
  selectedPlugins,
  onSelect,
  onLoadedAllPlugin,
}) => {
  const { isLoading: isFetchingMarketplaceData, data: marketplaceRes } = useFetchPluginsInMarketPlaceByIds(fromDSLPayload.filter(d => d.type === 'marketplace').map(d => d.value.plugin_unique_identifier!))

  const [plugins, setPlugins, getPlugins] = useGetState<Plugin[]>([])
  const handlePlugInFetched = useCallback((index: number) => {
    return (p: Plugin) => {
      setPlugins(plugins.map((item, i) => i === index ? p : item))
    }
  }, [plugins])

  const marketPlaceInDSLIndex = useMemo(() => {
    const res: number[] = []
    fromDSLPayload.forEach((d, index) => {
      if (d.type === 'marketplace')
        res.push(index)
    })
    return res
  }, [fromDSLPayload])

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

  const isLoadedAllData = fromDSLPayload.length === plugins.length && plugins.every(p => !!p)
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
      {fromDSLPayload.map((d, index) => (
        d.type === 'github'
          ? <GithubItem
            key={index}
            checked={!!selectedPlugins.find(p => p.plugin_id === plugins[index]?.plugin_id)}
            onCheckedChange={handleSelect(index)}
            dependency={d}
            onFetchedPayload={handlePlugInFetched(index)}
          />
          : <MarketplaceItem
            key={index}
            checked={!!selectedPlugins.find(p => p.plugin_id === plugins[index]?.plugin_id)}
            onCheckedChange={handleSelect(index)}
            payload={plugins[index] as Plugin}
          />
      ))}
    </>
  )
}
export default React.memo(InstallByDSLList)
