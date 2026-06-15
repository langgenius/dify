import type { NodeDefault } from '../../types'
import type { EndNodeType } from './types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

const metaData = genNodeMetaData({
  sort: 2.1,
  type: BlockEnum.End,
  isRequired: false,
})
const nodeDefault: NodeDefault<EndNodeType> = {
  metaData,
  defaultValue: {
    outputs: [],
  },
  checkValid(payload: EndNodeType, t: any) {
    const outputs = payload.outputs || []

    let errorMessage = ''
    if (!outputs.length) {
      errorMessage = t('errorMsg.fieldRequired', { ns: 'workflow', field: t('nodes.end.output.variable', { ns: 'workflow' }) })
    }
    else {
      const invalidOutput = outputs.find((output) => {
        const variableName = output.variable?.trim()
        const hasSelector = Array.isArray(output.value_selector) && output.value_selector.length > 0
        return !variableName || !hasSelector
      })

      if (invalidOutput)
        errorMessage = t('errorMsg.fieldRequired', { ns: 'workflow', field: t('nodes.end.output.variable', { ns: 'workflow' }) })
    }

    return {
      isValid: !errorMessage,
      errorMessage,
    }
  },
}

export default nodeDefault
