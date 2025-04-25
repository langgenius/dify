import type { NodeDefault } from '../../types'
import type { TemplateTransformNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
const i18nPrefix = 'workflow.errorMsg'

const nodeDefault: NodeDefault<TemplateTransformNodeType> = {
  ...genNodeMetaData({
    classification: BlockClassificationEnum.Transform,
    sort: 2,
    type: BlockEnum.TemplateTransform,
    helpLinkUri: 'template',
  }),
  defaultValue: {
    template: '',
    variables: [],
  },
  checkValid(payload: TemplateTransformNodeType, t: any) {
    let errorMessages = ''
    const { template, variables } = payload

    if (!errorMessages && variables.filter(v => !v.variable).length > 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variable`) })
    if (!errorMessages && variables.filter(v => !v.value_selector.length).length > 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variableValue`) })
    if (!errorMessages && !template)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.templateTransform.code') })
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
