'use client'
import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { UploadConfig } from '@dify/contracts/api/console/files/types.gen'
import type { UseQueryResult } from '@tanstack/react-query'
import type { Collection } from '@/app/components/tools/types'
import { queryOptions, skipToken, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { AppToastHost } from '@/app/notifications/host'
import { useParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { fetchDatasets } from '@/service/datasets'
import { useAllToolProviders } from '@/service/use-tools'
import { basePath } from '@/utils/var'
import ConfigurationView from './configuration-view'
import {
  buildConfigurationDefaults,
  getConfigurationDatasetIds,
} from './hooks/configuration-lifecycle/load'
import { useConfiguration } from './hooks/use-configuration'
import { appConfigurationToastManager } from './toast'

const ConfigurationSession = ({
  defaults,
}: {
  defaults: Parameters<typeof useConfiguration>[0]
}) => {
  const viewModel = useConfiguration(defaults)
  return (
    <>
      <AppToastHost manager={appConfigurationToastManager} offset={{ top: 60 }} />
      <ConfigurationView {...viewModel} />
    </>
  )
}

function ConfigurationDefaults({
  detail,
  collections,
  upload,
}: {
  detail: AppDetailWithSite
  collections: UseQueryResult<Collection[]>
  upload: UseQueryResult<UploadConfig>
}) {
  const { currentModel, currentProvider } = useModelListAndDefaultModelAndCurrentProviderAndModel(
    ModelTypeEnum.rerank,
  )
  const datasetIds = useMemo(
    () => (detail.model_config ? getConfigurationDatasetIds(detail.model_config) : []),
    [detail.model_config],
  )
  const datasets = useQuery(
    queryOptions({
      queryKey: ['configuration', 'datasets', datasetIds],
      queryFn: datasetIds.length
        ? () => fetchDatasets({ url: '/datasets', params: { page: 1, ids: datasetIds } })
        : skipToken,
      refetchOnMount: 'always',
    }),
  )
  const [initialDefaults, setInitialDefaults] = useState<Parameters<typeof useConfiguration>[0]>()
  if (!detail.model_config) throw new Error(`App ${detail.id} has no model configuration`)
  if (
    !initialDefaults &&
    collections.isFetchedAfterMount &&
    collections.isSuccess &&
    upload.isFetchedAfterMount &&
    upload.isSuccess &&
    (!datasetIds.length || (datasets.isFetchedAfterMount && datasets.isSuccess))
  ) {
    setInitialDefaults({
      ...buildConfigurationDefaults({
        response: detail,
        collections: collections.data,
        nextDataSets: datasets.data?.data ?? [],
        basePath,
        currentRerankModel: currentModel?.model,
        currentRerankProvider: currentProvider?.provider,
      }),
      fileUploadConfigResponse: upload.data,
    })
  }
  if (!initialDefaults) {
    if (collections.isError && !collections.isFetching) throw collections.error
    if (upload.isError && !upload.isFetching) throw upload.error
    if (datasets.isError && !datasets.isFetching) throw datasets.error
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingPlaceholder />
      </div>
    )
  }
  return <ConfigurationSession defaults={initialDefaults} />
}

function ConfigurationEntry({ appId }: { appId: string }) {
  const detail = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: { params: { app_id: appId } },
      refetchOnMount: 'always',
    }),
  )
  const collections = useAllToolProviders(false)
  const { refetch: refetchCollections } = collections
  useEffect(() => {
    void refetchCollections()
  }, [refetchCollections])
  const upload = useQuery(consoleQuery.files.upload.get.queryOptions({ refetchOnMount: 'always' }))
  const [initialDetail, setInitialDetail] = useState<AppDetailWithSite>()
  if (!initialDetail && detail.isFetchedAfterMount && detail.isSuccess)
    setInitialDetail(detail.data)
  if (!initialDetail) {
    if (detail.isError && !detail.isFetching) throw detail.error
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingPlaceholder />
      </div>
    )
  }
  return <ConfigurationDefaults detail={initialDetail} collections={collections} upload={upload} />
}

export default function Configuration() {
  const { appId } = useParams<{ appId: string }>()
  return <ConfigurationEntry key={appId} appId={appId} />
}
