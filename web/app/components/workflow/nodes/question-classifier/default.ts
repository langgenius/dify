import type { NodeDefault } from '../../types'
import type { QuestionClassifierNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'

const i18nPrefix = 'workflow'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.QuestionUnderstand,
  sort: 1,
  type: BlockEnum.QuestionClassifier,
})
const nodeDefault: NodeDefault<QuestionClassifierNodeType> = {
  metaData,
  defaultValue: {
    query_variable_selector: [],
    model: {
      provider: '',
      name: '',
      mode: 'chat',
      completion_params: {
        temperature: 0.7,
      },
    },
    classes: [
      {
        id: '1',
        name: '',
      },
      {
        id: '2',
        name: '',
      },
    ],
    _targetBranches: [
      {
        id: '1',
        name: '',
      },
      {
        id: '2',
        name: '',
      },
    ],
    vision: {
      enabled: false,
    },
  },
  checkValid(payload: QuestionClassifierNodeType, t: any) {
    let errorMessages = ''
    if (!errorMessages && (!payload.query_variable_selector || payload.query_variable_selector.length === 0))
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.questionClassifiers.inputVars`) })

    if (!errorMessages && !payload.model.provider)
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.questionClassifiers.model`) })

    if (!errorMessages && (!payload.classes || payload.classes.length === 0))
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.questionClassifiers.class`) })

    if (!errorMessages && (payload.classes.some(item => !item.name)))
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.questionClassifiers.topicName`) })

    if (!errorMessages && payload.vision?.enabled && !payload.vision.configs?.variable_selector?.length)
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.errorMsg.fields.visionVariable`) })
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
