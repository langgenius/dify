import type { NodeDefault } from '../../types'
import type { DocExtractorNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
const i18nPrefix = 'workflow.errorMsg'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Transform,
  sort: 4,
  type: BlockEnum.DocExtractor,
  helpLinkUri: 'doc-extractor',
})
const nodeDefault: NodeDefault<DocExtractorNodeType> = {
  metaData,
  defaultValue: {
    variable_selector: [],
    is_array_file: false,
  },
  checkValid(payload: DocExtractorNodeType, t: any) {
    let errorMessages = ''
    const { variable_selector: variable } = payload

    if (!errorMessages && !variable?.length)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.assigner.assignedVariable') })

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
