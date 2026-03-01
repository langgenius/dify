import type { NodeDefault } from '../../types'
import type { AssignerNodeType } from './types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { WriteMode } from './types'

const i18nPrefix = 'errorMsg'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Transform,
  sort: 5,
  type: BlockEnum.Assigner,
  helpLinkUri: 'variable-assigner',
})
const nodeDefault: NodeDefault<AssignerNodeType> = {
  metaData,
  defaultValue: {
    version: '2',
    items: [],
  },
  checkValid(payload: AssignerNodeType, t: any) {
    let errorMessages = ''
    const {
      items: operationItems,
    } = payload

    operationItems?.forEach((value) => {
      if (!errorMessages && !value.variable_selector?.length)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.assigner.assignedVariable', { ns: 'workflow' }) })

      if (!errorMessages && value.operation !== WriteMode.clear && value.operation !== WriteMode.removeFirst && value.operation !== WriteMode.removeLast) {
        if (value.operation === WriteMode.set || value.operation === WriteMode.increment
          || value.operation === WriteMode.decrement || value.operation === WriteMode.multiply
          || value.operation === WriteMode.divide) {
          if (!value.value && value.value !== false && typeof value.value !== 'number')
            errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.assigner.variable', { ns: 'workflow' }) })
        }
        else if (!value.value?.length) {
          errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.assigner.variable', { ns: 'workflow' }) })
        }
      }
    })

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
