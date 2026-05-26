import type { NodeDefault } from '../../types'
import type { DocExtractorNodeType } from '../../nodes/document-extractor/types'
import { BlockClassificationEnum } from '../../block-selector/types'
import { BlockEnum } from '../../types'
import { genNodeMetaData } from '../../utils'

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
