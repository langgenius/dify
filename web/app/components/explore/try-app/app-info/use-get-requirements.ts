import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
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
  if (!segments.length)
    return null

  if (segments.length === 1) {
    return {
      organization: 'langgenius',
      providerName: segments[0],
    }
  }

  return {
    organization: segments[0],
    providerName: segments[1],
  }
}

const getPluginName = (providerName: string, type: ProviderType) => {
  return PROVIDER_PLUGIN_ALIASES[type][providerName] || providerName
}

const getIconUrl = (providerId: string, type: ProviderType) => {
  const parsed = parseProviderId(providerId)
  if (!parsed)
    return ''

  const organization = encodeURIComponent(parsed.organization)
  const pluginName = encodeURIComponent(getPluginName(parsed.providerName, type))
  return `${MARKETPLACE_API_PREFIX}/plugins/${organization}/${pluginName}/icon`
}

const useGetRequirements = ({ appDetail, appId }: Params) => {
  const isBasic = ['chat', 'completion', 'agent-chat'].includes(appDetail.mode)
  const isAgent = appDetail.mode === 'agent-chat'
  const isAdvanced = !isBasic
  const { data: flowData } = useGetTryAppFlowPreview(appId, isBasic)

  const requirements: RequirementItem[] = []
  if (isBasic) {
    const modelProvider = appDetail.model_config.model.provider
    const name = appDetail.model_config.model.provider.split('/').pop() || ''
    requirements.push({
      name,
      iconUrl: getIconUrl(modelProvider, 'model'),
    })
  }
  if (isAgent) {
    requirements.push(...appDetail.model_config.agent_mode.tools.filter(data => (data as AgentTool).enabled).map((data) => {
      const tool = data as AgentTool
      return {
        name: tool.tool_label,
        iconUrl: getIconUrl(tool.provider_id, 'tool'),
      }
    }))
  }
  if (isAdvanced && flowData && flowData?.graph?.nodes?.length > 0) {
    const nodes = flowData.graph.nodes
    const llmNodes = nodes.filter(node => node.data.type === BlockEnum.LLM)
    requirements.push(...llmNodes.map((node) => {
      const data = node.data as LLMNodeType
      return {
        name: data.model.name,
        iconUrl: getIconUrl(data.model.provider, 'model'),
      }
    }))

    const toolNodes = nodes.filter(node => node.data.type === BlockEnum.Tool)
    requirements.push(...toolNodes.map((node) => {
      const data = node.data as ToolNodeType
      return {
        name: data.tool_label,
        iconUrl: getIconUrl(data.provider_id, 'tool'),
      }
    }))
  }

  const uniqueRequirements = uniqBy(requirements, 'name')

  return {
    requirements: uniqueRequirements,
  }
}

export default useGetRequirements
