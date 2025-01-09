import type { StrategyDetail, StrategyPluginDetail } from '@/app/components/plugins/types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '../../constants'
import type { NodeDefault } from '../../types'
import type { AgentNodeType } from './types'
import { renderI18nObject } from '@/hooks/use-i18n'

const nodeDefault: NodeDefault<AgentNodeType> = {
  defaultValue: {
  },
  getAvailablePrevNodes(isChatMode) {
    return isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS
  },
  getAvailableNextNodes(isChatMode) {
    return isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS
  },
  checkValid(payload, t, moreDataForCheckValid: {
    strategyProvider?: StrategyPluginDetail,
    strategy?: StrategyDetail
    language: string
    isReadyForCheckValid: boolean
  }) {
    const { strategy, language, isReadyForCheckValid } = moreDataForCheckValid
    if (!isReadyForCheckValid) {
      return {
        isValid: true,
        errorMessage: '',
      }
    }
    if (!strategy) {
      return {
        isValid: false,
        errorMessage: t('workflow.nodes.agent.checkList.strategyNotSelected'),
      }
    }
    for (const param of strategy.parameters) {
      if (param.required && !payload.agent_parameters?.[param.name]?.value) {
        return {
          isValid: false,
          errorMessage: t('workflow.errorMsg.fieldRequired', { field: renderI18nObject(param.label, language) }),
        }
      }
    }
    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
