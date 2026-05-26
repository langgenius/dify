import type { NodeDefault } from '@/app/components/workflow/types'
import type { IterationNodeType } from '@/app/components/workflow/nodes/iteration/types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum, ErrorHandleMode } from '@/app/components/workflow/types'

const i18nPrefix = ''

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Logic,
  sort: 2,
  type: BlockEnum.Iteration,
  isTypeFixed: true,
})
const nodeDefault: NodeDefault<IterationNodeType> = {
  metaData,
  defaultValue: {
    start_node_id: '',
    iterator_selector: [],
    output_selector: [],
    _children: [],
    _isShowTips: false,
    is_parallel: false,
    parallel_nums: 10,
    error_handle_mode: ErrorHandleMode.Terminated,
    flatten_output: true,
  },
  checkValid(payload: IterationNodeType, t: any) {
    let errorMessages = ''

    if (
      !errorMessages
      && (!payload.iterator_selector || payload.iterator_selector.length === 0)
    ) {
      errorMessages = t(`${i18nPrefix}errorMsg.fieldRequired`, {
        ns: 'workflow',
        field: t(`${i18nPrefix}nodes.iteration.input`, { ns: 'workflow' }),
      })
    }

    if (
      !errorMessages
      && (!payload.output_selector || payload.output_selector.length === 0)
    ) {
      errorMessages = t(`${i18nPrefix}errorMsg.fieldRequired`, {
        ns: 'workflow',
        field: t(`${i18nPrefix}nodes.iteration.output`, { ns: 'workflow' }),
      })
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
