import type { StrategyDetail, StrategyPluginDetail } from '@/app/components/plugins/types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '../../constants'
import type { NodeDefault } from '../../types'
import type { AgentNodeType } from './types'

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
    strategyProvider: StrategyPluginDetail | undefined,
    strategy: StrategyDetail | undefined
    language: string
  }) {
    const { strategy, language } = moreDataForCheckValid
    if (!strategy) {
      return {
        isValid: false,
        errorMessage: t('workflow.checkList.strategyNotSelected'),
      }
    }
    for (const param of strategy.parameters) {
      if (param.required && !payload.agent_parameters?.[param.name]?.value) {
        return {
          isValid: false,
          errorMessage: t('workflow.errorMsg.fieldRequired', { field: param.label[language] }),
        }
      }
    }
    // TODO: tool selector valid?
    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
