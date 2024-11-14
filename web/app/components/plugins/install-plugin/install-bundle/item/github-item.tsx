'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import type { Dependency, Plugin } from '../../../types'
import { pluginManifestToCardPluginProps } from '../../utils'
import { useUploadGitHub } from '@/service/use-plugins'
import Loading from './loading'
import LoadedItem from './loaded-item'

type Props = {
  checked: boolean
  onCheckedChange: (plugin: Plugin) => void
  dependency: Dependency
  onFetchedPayload: (payload: Plugin) => void
}

const Item: FC<Props> = ({
  checked,
  onCheckedChange,
  dependency,
  onFetchedPayload,
}) => {
  const info = dependency.value
  const { data } = useUploadGitHub({
    repo: info.repo!,
    version: info.version!,
    package: info.package!,
  })
  const [payload, setPayload] = React.useState<Plugin | null>(null)
  useEffect(() => {
    if (data) {
      const payload = pluginManifestToCardPluginProps(data.manifest)
      onFetchedPayload(payload)
      setPayload(payload)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])
  if (!payload) return <Loading />
  return (
    <LoadedItem
      payload={payload}
      checked={checked}
      onCheckedChange={onCheckedChange}
    />
  )
}
export default React.memo(Item)
