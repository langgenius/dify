import { MARKETPLACE_API_PREFIX } from '@/config'
import type { TryAppInfo } from '@/service/try-app'
import type { AgentTool } from '@/types/app'
import { uniqBy } from 'lodash-es'

type Params = {
  appDetail: TryAppInfo
  appId: string
}

type RequirementItem = {
  name: string
  iconUrl: string
}
const getIconUrl = (provider: string, tool: string) => {
  return `${MARKETPLACE_API_PREFIX}/plugins/${provider}/${tool}/icon`
}

const useGetRequirements = ({ appDetail, appId }: Params) => {
  const isBasic = ['chat', 'completion', 'agent-chat'].includes(appDetail.mode)
  const isAgent = appDetail.mode === 'agent-chat'

  const requirements: RequirementItem[] = []
  if(isBasic) {
    const modelProviderAndName = appDetail.model_config.model.provider.split('/')
    const name = appDetail.model_config.model.provider.split('/').pop() || ''
    requirements.push({
      name,
      iconUrl: getIconUrl(modelProviderAndName[0], modelProviderAndName[1]),
    })
  }
  if(isAgent) {
    requirements.push(...appDetail.model_config.agent_mode.tools.filter(data => (data as AgentTool).enabled).map((data) => {
      const tool = data as AgentTool
      const modelProviderAndName = tool.provider_id.split('/')
      return {
        name: tool.tool_label,
        iconUrl: getIconUrl(modelProviderAndName[0], modelProviderAndName[1]),
      }
    }))
  }

  const uniqueRequirements = uniqBy(requirements, 'name')

  return {
    requirements: uniqueRequirements,
  }
}

export default useGetRequirements
