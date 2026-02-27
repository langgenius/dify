import type { NodeDefault } from '../../types'
import type { QuestionClassifierNodeType } from './types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { AppModeEnum } from '@/types/app'

const i18nPrefix = ''

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
      mode: AppModeEnum.CHAT,
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
      errorMessages = t(`${i18nPrefix}errorMsg.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}nodes.questionClassifiers.inputVars`, { ns: 'workflow' }) })

    if (!errorMessages && !payload.model.provider)
      errorMessages = t(`${i18nPrefix}errorMsg.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}nodes.questionClassifiers.model`, { ns: 'workflow' }) })

    if (!errorMessages && (!payload.classes || payload.classes.length === 0))
      errorMessages = t(`${i18nPrefix}errorMsg.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}nodes.questionClassifiers.class`, { ns: 'workflow' }) })

    if (!errorMessages && (payload.classes.some(item => !item.name)))
      errorMessages = t(`${i18nPrefix}errorMsg.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}nodes.questionClassifiers.topicName`, { ns: 'workflow' }) })

    if (!errorMessages && payload.vision?.enabled && !payload.vision.configs?.variable_selector?.length)
      errorMessages = t(`${i18nPrefix}errorMsg.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}errorMsg.fields.visionVariable`, { ns: 'workflow' }) })
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
