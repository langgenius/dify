import { BlockEnum, VarType } from '../../types'
import type { NodeDefault } from '../../types'
import { type AssignerNodeType, WriteMode } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'
const i18nPrefix = 'workflow.errorMsg'

const nodeDefault: NodeDefault<AssignerNodeType> = {
  defaultValue: {
    variable: [],
    writeMode: WriteMode.Overwrite,
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
    const { variable, varType, writeMode, value } = payload

    if (!errorMessages && !variable?.length)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.assigner.assignedVariable') })

    if (!errorMessages && writeMode !== WriteMode.Clear) {
      switch (varType || VarType.string) {
        case VarType.string:
          if (!value)
            errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.assigner.value') })
          break
        case VarType.number:
          if (value?.value === undefined || value?.value?.length === 0)
            errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.assigner.value') })
          break
        case VarType.object:
          value?.forEach((item: any) => {
            if (!errorMessages && (item.key || item.value)) {
              if (!item.key)
                errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.assigner.keyInObj') })
              else if (!item.value)
                errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.assigner.valueInObj') })
            }
          })
          break
        default:
          if (
            (Array.isArray(value?.value) && value?.value.length === 0)
            || (typeof value === 'string' && !value)
            || (typeof value === 'object' && !value.value)
          )
            errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.assigner.value') })
      }
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
