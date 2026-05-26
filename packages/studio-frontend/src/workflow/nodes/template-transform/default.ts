import type { NodeDefault } from '../../types'
import type { TemplateTransformNodeType } from '../../nodes/template-transform/types'
import { BlockClassificationEnum } from '../../block-selector/types'
import { BlockEnum } from '../../types'
import { genNodeMetaData } from '../../utils'

const i18nPrefix = 'errorMsg'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Transform,
  sort: 2,
  type: BlockEnum.TemplateTransform,
  helpLinkUri: 'template',
})
const nodeDefault: NodeDefault<TemplateTransformNodeType> = {
  metaData,
  defaultValue: {
    template: '',
    variables: [],
  },
  checkValid(payload: TemplateTransformNodeType, t: any) {
    let errorMessages = ''
    const { template, variables } = payload

    if (!errorMessages && variables.filter(v => !v.variable).length > 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.fields.variable`, { ns: 'workflow' }) })
    if (!errorMessages && variables.filter(v => !v.value_selector.length).length > 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.fields.variableValue`, { ns: 'workflow' }) })
    if (!errorMessages && !template)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.templateTransform.code', { ns: 'workflow' }) })
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
