import type { StartNodeType } from '../../nodes/start/types'
import {
  memo,
} from 'react'
import { useNodes } from 'reactflow'
import { cn } from '@/utils/classnames'
import FormItem from '../../nodes/_base/components/before-run-form/form-item'
import {
  useStore,
  useWorkflowStore,
} from '../../store'
import { BlockEnum } from '../../types'

const UserInput = () => {
  const workflowStore = useWorkflowStore()
  const inputs = useStore(s => s.inputs)
  const showDebugAndPreviewPanel = useStore(s => s.showDebugAndPreviewPanel)
  const nodes = useNodes<StartNodeType>()
  const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
  const variables = startNode?.data.variables || []
  const visibleVariables = showDebugAndPreviewPanel ? variables : variables.filter(v => v.hide !== true)

  const handleValueChange = (variable: string, v: string) => {
    const {
      inputs,
      setInputs,
    } = workflowStore.getState()
    setInputs({
      ...inputs,
      [variable]: v,
    })
  }

  if (!visibleVariables.length)
    return null

  return (
    <div className={cn('relative z-[1] rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg shadow-xs')}>
      <div className="px-4 pb-4 pt-3">
        {visibleVariables.map((variable, index) => (
          <div
            key={variable.variable}
            className="mb-4 last-of-type:mb-0"
          >
            <FormItem
              autoFocus={index === 0}
              payload={variable}
              value={inputs[variable.variable]}
              onChange={v => handleValueChange(variable.variable, v)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default memo(UserInput)
