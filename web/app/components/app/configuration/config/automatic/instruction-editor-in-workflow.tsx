'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { GeneratorType } from './types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import InstructionEditor from './instruction-editor'
import { useWorkflowVariableType } from '@/app/components/workflow/hooks'
import { useWorkflowStore } from '@/app/components/workflow/store'

type Props = {
  nodeId: string
  value: string
  editorKey: string
  onChange: (text: string) => void
  generatorType: GeneratorType
  isShowCurrentBlock: boolean
}

const InstructionEditorInWorkflow: FC<Props> = ({
  nodeId,
  value,
  editorKey,
  onChange,
  generatorType,
  isShowCurrentBlock,
}) => {
  const workflowStore = useWorkflowStore()
  const filterVar = useCallback((payload: Var, selector: ValueSelector) => {
    const { nodesWithInspectVars } = workflowStore.getState()
    const nodeId = selector?.[0]
    return !!nodesWithInspectVars.find(node => node.nodeId === nodeId) && payload.type !== VarType.file && payload.type !== VarType.arrayFile
  }, [workflowStore])
  const {
    availableVars,
    availableNodes,
  } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar,
  })
  const getVarType = useWorkflowVariableType()

  return (
    <InstructionEditor
      value={value}
      onChange={onChange}
      editorKey={editorKey}
      generatorType={generatorType}
      availableVars={availableVars}
      availableNodes={availableNodes}
      getVarType={getVarType}
      isShowCurrentBlock={isShowCurrentBlock}
      isShowLastRunBlock
    />
  )
}
export default React.memo(InstructionEditorInWorkflow)
