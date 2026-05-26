import type { NodeDefault } from '../../types'
import type { StartNodeType } from '../../nodes/start/types'
import { BlockEnum } from '../../types'
import { genNodeMetaData } from '../../utils'

const metaData = genNodeMetaData({
  sort: 0.1,
  type: BlockEnum.Start,
  isStart: true,
  isRequired: false,
  isSingleton: true,
  isTypeFixed: false, // support node type change for start node(user input)
  helpLinkUri: 'user-input',
})
const nodeDefault: NodeDefault<StartNodeType> = {
  metaData,
  defaultValue: {
    variables: [],
  },
  checkValid() {
    return {
      isValid: true,
    }
  },
}

export default nodeDefault
