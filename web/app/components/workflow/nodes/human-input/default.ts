import type { NodeDefault } from '../../types'
import type { HumanInputNodeType } from './types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

const i18nPrefix = 'workflow.nodes.humanInput'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Logic,
  sort: 6,
  type: BlockEnum.HumanInput,
})

const nodeDefault: NodeDefault<HumanInputNodeType> = {
  metaData,
  defaultValue: {
    pause_reason: '',
    _targetBranches: [
      { id: 'approve', name: 'Approve' },
      { id: 'reject', name: 'Reject' },
    ],
  },
  checkValid(payload: HumanInputNodeType, t: any) {
    let errorMessages = ''
    if (!payload.pause_reason) {
      errorMessages = t(`${i18nPrefix}.pauseReasonRequired`)
    }
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
