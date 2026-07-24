import type { NodeDefault } from '../../types'
import type { DocExtractorNodeType } from './types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

const i18nPrefix = 'errorMsg'

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
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.assigner.assignedVariable', { ns: 'workflow' }) })

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
