import type { NodeDefault } from '../../types'
import type { TemplateTransformNodeType } from './types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

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
