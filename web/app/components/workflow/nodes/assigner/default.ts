import { BlockEnum } from '../../types'
import type { NodeDefault, Var } from '../../types'
import { getNotExistVariablesByArray } from '../../utils/workflow'
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

  checkVarValid(payload: AssignerNodeType, varMap: Record<string, Var>, t: any) {
    const errorMessageArr: string[] = []
    const variables_warnings = getNotExistVariablesByArray(payload.items.map(item => item.variable_selector ?? []) ?? [], varMap)
    if (variables_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.assigner.assignedVariable')} ${t('workflow.common.referenceVar')}${variables_warnings.join('、')}${t('workflow.common.noExist')}`)

    const value_warnings = getNotExistVariablesByArray(payload.items.map(item => item.value ?? []) ?? [], varMap)
    if (value_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.assigner.setVariable')} ${t('workflow.common.referenceVar')}${value_warnings.join('、')}${t('workflow.common.noExist')}`)

    return {
      isValid: true,
      warning_vars: [...variables_warnings, ...value_warnings],
      errorMessage: errorMessageArr,
    }
  },
}

export default nodeDefault
