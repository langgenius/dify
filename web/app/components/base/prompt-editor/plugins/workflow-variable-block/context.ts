import type { WorkflowVariableBlockType } from '../../types'
import { createContext } from 'react'

export const WorkflowVariableWarningContext =
  createContext<WorkflowVariableBlockType['getWarning']>(undefined)
