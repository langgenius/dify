import type { NodeDefault } from '../../types'
import type { KnowledgeBaseNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'

const metaData = genNodeMetaData({
  sort: 3.1,
  type: BlockEnum.KnowledgeBase,
})
const nodeDefault: NodeDefault<KnowledgeBaseNodeType> = {
  metaData,
  defaultValue: {},
  checkValid() {
    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
