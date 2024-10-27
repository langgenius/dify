import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import { type AssignerNodeType, WriteMode } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'
const i18nPrefix = 'workflow.errorMsg'

const nodeDefault: NodeDefault<AssignerNodeType> = {
  defaultValue: {
    assigned_variable_selector: [],
    write_mode: WriteMode.Overwrite,
    input_variable_selector: [],
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
      assigned_variable_selector: assignedVarSelector,
      write_mode: writeMode,
      input_variable_selector: toAssignerVarSelector,
    } = payload

    if (!errorMessages && !assignedVarSelector?.length)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.assigner.assignedVariable') })

    if (!errorMessages && writeMode !== WriteMode.Clear) {
      if (!toAssignerVarSelector?.length)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.assigner.variable') })
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
