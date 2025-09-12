import { memo } from 'react'
import type { VariablePayload } from './types'
import VariableLabel from './base/variable-label'

const VariableLabelInSelect = (variablePayload: VariablePayload) => {
  return (
    <VariableLabel
      {...variablePayload}
    />
  )
}

export default memo(VariableLabelInSelect)
