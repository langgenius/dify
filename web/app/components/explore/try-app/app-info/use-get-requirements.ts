import type { TryAppInfo } from '@/service/try-app'
import type { AgentTool } from '@/types/app'
import { uniqBy } from 'es-toolkit/compat'
import { BlockEnum } from '@/app/components/workflow/types'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { useGetTryAppFlowPreview } from '@/service/use-try-app'

type Params = {
  appDetail: TryAppInfo
  appId: string
}

type RequirementItem = {
  name: string
  iconUrl: string
}

type ProviderType = 'model' | 'tool'

type ProviderInfo = {
  organization: string
  providerName: string
}

const PROVIDER_PLUGIN_ALIASES: Record<ProviderType, Record<string, string>> = {
  model: {
    google: 'gemini',
  },
  tool: {
    stepfun: 'stepfun_tool',
    jina: 'jina_tool',
    siliconflow: 'siliconflow_tool',
    gitee_ai: 'gitee_ai_tool',
  },
}

const parseProviderId = (providerId: string): ProviderInfo | null => {
  const segments = providerId.split('/').filter(Boolean)
  if (!segments.length) return null

  if (segments.length === 1) {
    return {
      organization: 'langgenius',
      providerName: segments[0]!,
    }
  }

  return {
    organization: segments[0]!,
    providerName: segments[1]!,
  }
}

const getPluginName = (providerName: string, type: ProviderType) => {
  return PROVIDER_PLUGIN_ALIASES[type][providerName] || providerName
}

const getIconUrl = (providerId: string, type: ProviderType) => {
  const parsed = parseProviderId(providerId)
  if (!parsed) return ''

  const organization = encodeURIComponent(parsed.organization)
  const pluginName = encodeURIComponent(getPluginName(parsed.providerName, type))
  return `${MARKETPLACE_API_PREFIX}/plugins/${organization}/${pluginName}/icon`
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const getGraphNodes = (graph: unknown): unknown[] => {
  if (!isRecord(graph) || !Array.isArray(graph.nodes)) return []

  return graph.nodes
}

const isAgentTool = (value: unknown): value is AgentTool => {
  if (!isRecord(value)) return false

  return (
    typeof value.provider_id === 'string' &&
    typeof value.tool_label === 'string' &&
    value.enabled === true
  )
}

const hasLLMRequirementData = (
  value: unknown,
): value is { model: { name: string; provider: string } } => {
  if (!isRecord(value) || !isRecord(value.model)) return false

  return typeof value.model.name === 'string' && typeof value.model.provider === 'string'
}

const hasToolRequirementData = (
  value: unknown,
): value is { provider_id: string; tool_label: string } => {
  if (!isRecord(value)) return false

  return typeof value.provider_id === 'string' && typeof value.tool_label === 'string'
}

const useGetRequirements = ({ appDetail, appId }: Params) => {
  const isBasic = ['chat', 'completion', 'agent-chat'].includes(appDetail.mode)
  const isAgent = appDetail.mode === 'agent-chat'
  const isAdvanced = !isBasic
  const { data: flowData } = useGetTryAppFlowPreview(appId, isBasic)

  const requirements: RequirementItem[] = []
  const modelConfig = appDetail.model_config
  const model = modelConfig?.model
  if (isBasic && model) {
    const modelProvider = model.provider
    const name = model.provider.split('/').pop() || ''
    requirements.push({
      name,
      iconUrl: getIconUrl(modelProvider, 'model'),
    })
  }
  if (isAgent && modelConfig?.agent_mode?.tools) {
    requirements.push(
      ...modelConfig.agent_mode.tools.filter(isAgentTool).map((tool) => ({
        name: tool.tool_label,
        iconUrl: getIconUrl(tool.provider_id, 'tool'),
      })),
    )
  }
  const nodes = getGraphNodes(flowData?.graph)
  if (isAdvanced && nodes.length > 0) {
    requirements.push(
      ...nodes.flatMap((node) => {
        const data = isRecord(node) && isRecord(node.data) ? node.data : null
        if (data?.type !== BlockEnum.LLM || !hasLLMRequirementData(data)) return []

        return [
          {
            name: data.model.name,
            iconUrl: getIconUrl(data.model.provider, 'model'),
          },
        ]
      }),
    )

    requirements.push(
      ...nodes.flatMap((node) => {
        const data = isRecord(node) && isRecord(node.data) ? node.data : null
        if (data?.type !== BlockEnum.Tool || !hasToolRequirementData(data)) return []

        return [
          {
            name: data.tool_label,
            iconUrl: getIconUrl(data.provider_id, 'tool'),
          },
        ]
      }),
    )
  }

  const uniqueRequirements = uniqBy(requirements, 'name')

  return {
    requirements: uniqueRequirements,
  }
}

export default useGetRequirements
