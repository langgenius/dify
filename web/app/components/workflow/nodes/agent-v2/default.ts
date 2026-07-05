import type { NodeDefault } from '../../types'
import type { AgentV2NodeType } from './types'
import { BlockEnum } from '../../types'
import { genNodeMetaData } from '../../utils'
import { hasValidAgentBinding } from './types'

const metaData = genNodeMetaData({
  sort: 3,
  type: BlockEnum.AgentV2,
})

const nodeDefault: NodeDefault<AgentV2NodeType> = {
  metaData,
  defaultValue: {
    agent_binding: {
      binding_type: 'inline_agent',
    },
    agent_node_kind: 'dify_agent',
    version: '2',
  },
  checkValid(payload, t) {
    if (!hasValidAgentBinding(payload)) {
      return {
        isValid: false,
        errorMessage: t('errorMsg.fieldRequired', {
          ns: 'workflow',
          field: t('nodes.agent.roster.label', { ns: 'workflow' }),
        }),
      }
    }

    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
