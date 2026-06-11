import type { NodeDefault } from '../../types'
import type { AgentNodeType } from './types'
import { BlockEnum } from '../../types'
import { genNodeMetaData } from '../../utils'

const metaData = genNodeMetaData({
  sort: 3,
  type: BlockEnum.Agent,
})

const nodeDefault: NodeDefault<AgentNodeType> = {
  metaData,
  defaultValue: {
    agent_node_kind: 'dify_agent',
    version: '2',
  },
  checkValid(payload, t) {
    if (!payload.agent_roster) {
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
