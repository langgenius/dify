'use client'
import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { UploadConfig } from '@dify/contracts/api/console/files/types.gen'
import type { Collection } from '@/app/components/tools/types'
import { queryOptions, skipToken, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
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
  const [initialDefaults] = useState(defaults)
  const viewModel = useConfiguration(initialDefaults)
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
  collections?: Collection[]
  upload?: UploadConfig
}) {
  const [initialDetail] = useState(detail)
  const { currentModel, currentProvider } = useModelListAndDefaultModelAndCurrentProviderAndModel(
    ModelTypeEnum.rerank,
  )
  const datasetIds = initialDetail.model_config
    ? getConfigurationDatasetIds(initialDetail.model_config)
    : []
  const datasets = useQuery(
    queryOptions({
      queryKey: ['configuration', 'datasets', datasetIds],
      queryFn: datasetIds.length
        ? () => fetchDatasets({ url: '/datasets', params: { page: 1, ids: datasetIds } })
        : skipToken,
    }),
  )
  if (!initialDetail.model_config)
    throw new Error(`App ${initialDetail.id} has no model configuration`)
  if (datasets.isLoadingError) throw datasets.error
  if (!collections || !upload || (datasetIds.length && !datasets.data)) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingPlaceholder />
      </div>
    )
  }

  return (
    <ConfigurationSession
      defaults={{
        ...buildConfigurationDefaults({
          response: initialDetail,
          collections,
          nextDataSets: datasets.data?.data ?? [],
          basePath,
          currentRerankModel: currentModel?.model,
          currentRerankProvider: currentProvider?.provider,
        }),
        fileUploadConfigResponse: upload,
      }}
    />
  )
}

export default function Configuration() {
  const { appId } = useParams<{ appId: string }>()
  const detail = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: { params: { app_id: appId } },
    }),
  )
  const collections = useAllToolProviders()
  const upload = useQuery(consoleQuery.files.upload.get.queryOptions())
  if (detail.isLoadingError) throw detail.error
  if (collections.isLoadingError) throw collections.error
  if (upload.isLoadingError) throw upload.error
  if (!detail.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingPlaceholder />
      </div>
    )
  }
  return (
    <ConfigurationDefaults
      key={appId}
      detail={detail.data}
      collections={collections.data}
      upload={upload.data}
    />
  )
}
