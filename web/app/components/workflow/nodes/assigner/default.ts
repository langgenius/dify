import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import { type AssignerNodeType, WriteMode } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'
const i18nPrefix = 'workflow.errorMsg'

const nodeDefault: NodeDefault<AssignerNodeType> = {
  defaultValue: {
    version: '2',
    items: [],
  },
  getAvailablePrevNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS.filter(type => type !== BlockEnum.End)
    return nodes
  },
  getAvailableNextNodes(isChatMode: boolean) {
    const nodes = isChatMode ? ALL_CHAT_AVAILABLE_BLOCKS : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes
  },
  checkValid(payload: AssignerNodeType, t: any) {
    let errorMessages = ''
    const {
      items: operationItems,
    } = payload

    operationItems?.forEach((value) => {
      if (!errorMessages && !value.variable_selector?.length)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.assigner.assignedVariable') })

      if (!errorMessages && value.operation !== WriteMode.clear && value.operation !== WriteMode.removeFirst && value.operation !== WriteMode.removeLast) {
        if (value.operation === WriteMode.set || value.operation === WriteMode.increment
          || value.operation === WriteMode.decrement || value.operation === WriteMode.multiply
          || value.operation === WriteMode.divide) {
          if (!value.value && typeof value.value !== 'number')
            errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.assigner.variable') })
        }
        else if (!value.value?.length) {
          errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.assigner.variable') })
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
