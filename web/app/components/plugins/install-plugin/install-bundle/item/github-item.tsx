'use client'
import type { FC } from 'react'
import type { GitHubItemAndMarketPlaceDependency, Plugin, VersionProps } from '../../../types'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect, useMemo } from 'react'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import Loading from '../../base/loading'
import LoadingError from '../../base/loading-error'
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
  const githubQuery = useQuery(
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
  const { data } = githubQuery
  // A failed first load shows as an error row in place of this item, which the bundle list keeps
  // once it learns of the failure.
  const githubLoad = useOwnedQueryError(githubQuery)
  const isLoadFailed = githubLoad !== undefined
  const fetchedPayload = useMemo<Plugin | null>(
    () => (data ? pluginDeclarationToCardPluginProps(data.manifest, data.unique_identifier) : null),
    [data],
  )
  const payload = useMemo<Plugin | null>(
    () => fetchedPayload && { ...fetchedPayload, from: dependency.type },
    [fetchedPayload, dependency.type],
  )
  // The bundle installer collects each resolved package.
  useEffect(() => {
    if (fetchedPayload) onFetchedPayload(fetchedPayload)
  }, [fetchedPayload])
  useEffect(() => {
    if (isLoadFailed) onFetchError()
  }, [isLoadFailed])
  if (isLoadFailed) return <LoadingError />
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
