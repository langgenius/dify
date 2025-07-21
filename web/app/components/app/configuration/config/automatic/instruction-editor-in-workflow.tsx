'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { GeneratorType } from './types'
import type { Var } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import InstructionEditor from './instruction-editor'
import { useWorkflowVariableType } from '@/app/components/workflow/hooks'

type Props = {
  nodeId: string
  value: string
  onChange: (text: string) => void
  generatorType: GeneratorType
}

const InstructionEditorInWorkflow: FC<Props> = ({
  nodeId,
  value,
  onChange,
  generatorType,
}) => {
  const filterVar = useCallback((payload: Var) => {
    return payload.type !== VarType.file && payload.type !== VarType.arrayFile
  }, [])
  const {
    availableVars,
    availableNodes,
  } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar,
  })
  const getVarType = useWorkflowVariableType()

  console.log(availableVars)
  return (
    <InstructionEditor
      value={value}
      onChange={onChange}
      generatorType={generatorType}
      availableVars={availableVars}
      availableNodes={availableNodes}
      getVarType={getVarType}
    />
  )
}
export default React.memo(InstructionEditorInWorkflow)
