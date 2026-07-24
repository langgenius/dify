'use client'
import type { FC } from 'react'
import type { GitHubItemAndMarketPlaceDependency, Plugin } from '../../../types'
import type { VersionProps } from '@/app/components/plugins/types'
import * as React from 'react'
import { useEffect } from 'react'
import { useUploadGitHub } from '@/service/use-plugins'
import Loading from '../../base/loading'
import { pluginManifestToCardPluginProps } from '../../utils'
import LoadedItem from './loaded-item'

type Props = {
  checked: boolean
  onCheckedChange: (plugin: Plugin) => void
  dependency: GitHubItemAndMarketPlaceDependency
  versionInfo: VersionProps
  onFetchedPayload: (payload: Plugin) => void
  onFetchError: () => void
}

const Item: FC<Props> = ({
  checked,
  onCheckedChange,
  dependency,
  versionInfo,
  onFetchedPayload,
  onFetchError,
}) => {
  const info = dependency.value
  const { data, error } = useUploadGitHub({
    repo: info.repo!,
    version: info.release! || info.version!,
    package: info.packages! || info.package!,
  })
  const [payload, setPayload] = React.useState<Plugin | null>(null)
  useEffect(() => {
    if (data) {
      const payload = {
        ...pluginManifestToCardPluginProps(data.manifest),
        plugin_id: data.unique_identifier,
      }
      onFetchedPayload(payload)
      setPayload({ ...payload, from: dependency.type })
    }
  }, [data])
  useEffect(() => {
    if (error)
      onFetchError()
  }, [error])
  if (!payload)
    return <Loading />
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
