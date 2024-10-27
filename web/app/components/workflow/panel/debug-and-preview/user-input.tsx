import {
  memo,
} from 'react'
import { useNodes } from 'reactflow'
import FormItem from '../../nodes/_base/components/before-run-form/form-item'
import { BlockEnum } from '../../types'
import {
  useStore,
  useWorkflowStore,
} from '../../store'
import type { StartNodeType } from '../../nodes/start/types'
import cn from '@/utils/classnames'

const UserInput = () => {
  const workflowStore = useWorkflowStore()
  const inputs = useStore(s => s.inputs)
  const nodes = useNodes<StartNodeType>()
  const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
  const variables = startNode?.data.variables || []

  const handleValueChange = (variable: string, v: string) => {
    workflowStore.getState().setInputs({
      ...inputs,
      [variable]: v,
    })
  }

  if (!variables.length)
    return null

  return (
    <div className={cn('relative bg-components-panel-on-panel-item-bg rounded-xl border-[0.5px] border-components-panel-border-subtle shadow-xs z-[1]')}>
      <div className='px-4 pt-3 pb-4'>
        {variables.map((variable, index) => (
          <div
            key={variable.variable}
            className='mb-4 last-of-type:mb-0'
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
