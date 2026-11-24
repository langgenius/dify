'use client'
import type { FC } from 'react'
import type { GitHubItemAndMarketPlaceDependency, Plugin, VersionProps } from '../../../types'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect } from 'react'
import { consoleQuery } from '@/service/console'
import Loading from '../../base/loading'
import { pluginDeclarationToCardPluginProps } from '../../utils'
import LoadedItem from './loaded-item'

type Props = Readonly<{
  checked: boolean
  onCheckedChange: (plugin: Plugin) => void
  dependency: GitHubItemAndMarketPlaceDependency
  versionInfo: VersionProps
  onFetchedPayload: (payload: Plugin) => void
  onFetchError: () => void
}>

const Item: FC<Props> = ({
  checked,
  onCheckedChange,
  dependency,
  versionInfo,
  onFetchedPayload,
  onFetchError,
}) => {
  const info = dependency.value
  const { data, error } = useQuery(
    consoleQuery.workspaces.current.plugin.upload.github.post.queryOptions({
      input: {
        body: {
          repo: info.repo!,
          version: info.release! || info.version!,
          package: info.packages! || info.package!,
        },
      },
      retry: 0,
    }),
  )
  const [payload, setPayload] = React.useState<Plugin | null>(null)
  useEffect(() => {
    if (data) {
      const payload = {
        ...pluginDeclarationToCardPluginProps(data.manifest, data.unique_identifier),
      }
      onFetchedPayload(payload)
      setPayload({ ...payload, from: dependency.type })
    }
  }, [data])
  useEffect(() => {
    if (error) onFetchError()
  }, [error])
  if (!payload) return <Loading />
  return (
    <LoadedItem
      payload={payload}
      versionInfo={versionInfo}
      checked={checked}
      onCheckedChange={onCheckedChange}
    />
  )
}
export default React.memo(Item)
