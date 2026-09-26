import type {
  AppDetailWithSite,
  AppModelConfigResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { Collection } from '@/app/components/tools/types'
import type { DataSet } from '@/models/datasets'
import { zAppLegacyDatasetToolResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { PromptMode } from '@/models/debug'
import { AppModeEnum } from '@/types/app'
import { withCollectionIconBasePath } from '../../utils'
import { buildConfigurationDatasetConfigs } from './dataset'
import { buildPublishedConfig } from './published-config'

export function getConfigurationDatasetIds(backendModelConfig: AppModelConfigResponse) {
  const agentDatasets = (backendModelConfig.agent_mode.tools ?? []).flatMap((tool) => {
    const result = zAppLegacyDatasetToolResponse.safeParse(tool)
    return result.success ? [result.data.dataset] : []
  })
  const configuredDatasets = agentDatasets.some((dataset) => dataset.enabled)
    ? agentDatasets
    : (backendModelConfig.dataset_configs.datasets?.datasets ?? []).map((item) => item.dataset)
  return configuredDatasets.flatMap(({ id }) => (id ? [id] : []))
}

export function buildConfigurationDefaults({
  response,
  collections,
  nextDataSets,
  basePath,
  currentRerankModel,
  currentRerankProvider,
}: {
  response: AppDetailWithSite
  collections: Collection[]
  nextDataSets: DataSet[]
  basePath?: string
  currentRerankModel?: string
  currentRerankProvider?: string
}) {
  const collectionList = withCollectionIconBasePath(collections, basePath)
  const mode = response.mode
  if (
    mode !== AppModeEnum.CHAT &&
    mode !== AppModeEnum.AGENT_CHAT &&
    mode !== AppModeEnum.COMPLETION
  )
    throw new Error(`App mode ${mode} does not use model configuration`)
  const backendModelConfig = response.model_config
  if (!backendModelConfig) throw new Error(`App ${response.id} has no model configuration`)
  const datasetConfigs = buildConfigurationDatasetConfigs({
    backendModelConfig,
    currentRerankModel,
    currentRerankProvider,
    nextDataSets,
  })

  const publishedConfig = buildPublishedConfig({
    backendModelConfig,
    collectionList,
    datasetConfigs,
    deletedTools: response.deleted_tools,
    mode,
    nextDataSets,
  })

  return {
    canReturnToSimpleMode: publishedConfig.promptMode !== PromptMode.advanced,
    collectionList,
    mode,
    publishedConfig,
  }
}
