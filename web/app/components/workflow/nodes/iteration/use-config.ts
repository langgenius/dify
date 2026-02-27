import type { ErrorHandleMode, ValueSelector, Var } from '../../types'
import type { IterationNodeType } from './types'
import type { Item } from '@/app/components/base/select'
import type { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { isEqual } from 'es-toolkit/predicate'
import { produce } from 'immer'
import { useCallback } from 'react'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
} from '../../hooks'
import useInspectVarsCrud from '../../hooks/use-inspect-vars-crud'
import { useStore } from '../../store'
import { VarType } from '../../types'
import { toNodeOutputVars } from '../_base/components/variable/utils'
import useNodeCrud from '../_base/hooks/use-node-crud'

const useConfig = (id: string, payload: IterationNodeType) => {
  const {
    deleteNodeInspectorVars,
  } = useInspectVarsCrud()
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()

  const { inputs, setInputs } = useNodeCrud<IterationNodeType>(id, payload)

  const filterInputVar = useCallback((varPayload: Var) => {
    return [VarType.array, VarType.arrayString, VarType.arrayBoolean, VarType.arrayNumber, VarType.arrayObject, VarType.arrayFile].includes(varPayload.type)
  }, [])

  const handleInputChange = useCallback((input: ValueSelector | string, _varKindType: VarKindType, varInfo?: Var) => {
    const newInputs = produce(inputs, (draft) => {
      draft.iterator_selector = input as ValueSelector || []
      draft.iterator_input_type = varInfo?.type || VarType.arrayString
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // output
  const { getIterationNodeChildren } = useWorkflow()
  const iterationChildrenNodes = getIterationNodeChildren(id)
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const dataSourceList = useStore(s => s.dataSourceList)
  const allPluginInfoList = {
    buildInTools: buildInTools || [],
    customTools: customTools || [],
    workflowTools: workflowTools || [],
    mcpTools: mcpTools || [],
    dataSourceList: dataSourceList || [],
  }
  const childrenNodeVars = toNodeOutputVars(iterationChildrenNodes, isChatMode, undefined, [], [], [], allPluginInfoList)

  const handleOutputVarChange = useCallback((output: ValueSelector | string, _varKindType: VarKindType, varInfo?: Var) => {
    if (isEqual(inputs.output_selector, output as ValueSelector))
      return

    const newInputs = produce(inputs, (draft) => {
      draft.output_selector = output as ValueSelector || []
      const outputItemType = varInfo?.type || VarType.string

      draft.output_type = ({
        [VarType.string]: VarType.arrayString,
        [VarType.number]: VarType.arrayNumber,
        [VarType.object]: VarType.arrayObject,
        [VarType.file]: VarType.arrayFile,
        // list operator node can output array
        [VarType.array]: VarType.array,
        [VarType.arrayFile]: VarType.arrayFile,
        [VarType.arrayString]: VarType.arrayString,
        [VarType.arrayNumber]: VarType.arrayNumber,
        [VarType.arrayObject]: VarType.arrayObject,
      } as Record<VarType, VarType>)[outputItemType] || VarType.arrayString
    })
    setInputs(newInputs)
    deleteNodeInspectorVars(id)
  }, [deleteNodeInspectorVars, id, inputs, setInputs])

  const changeParallel = useCallback((value: boolean) => {
    const newInputs = produce(inputs, (draft) => {
      draft.is_parallel = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const changeErrorResponseMode = useCallback((item: Item) => {
    const newInputs = produce(inputs, (draft) => {
      draft.error_handle_mode = item.value as ErrorHandleMode
    })
    setInputs(newInputs)
  }, [inputs, setInputs])
  const changeParallelNums = useCallback((num: number) => {
    const newInputs = produce(inputs, (draft) => {
      draft.parallel_nums = num
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const changeFlattenOutput = useCallback((value: boolean) => {
    const newInputs = produce(inputs, (draft) => {
      draft.flatten_output = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    readOnly,
    inputs,
    filterInputVar,
    handleInputChange,
    childrenNodeVars,
    iterationChildrenNodes,
    handleOutputVarChange,
    changeParallel,
    changeErrorResponseMode,
    changeParallelNums,
    changeFlattenOutput,
  }
}

export default useConfig
