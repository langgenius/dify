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
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'

const UserInput = () => {
  const { theme } = useTheme()
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
      <div className='px-4 pb-4 pt-3'>
        {visibleVariables.map((variable, index) => (
          <div
            key={variable.variable}
            className='mb-4 last-of-type:mb-0'
          >
            {showDebugAndPreviewPanel && variable.hide && (
              <div className={cn('mb-2 flex items-center text-xs', theme === Theme.light ? 'text-black' : 'text-white')}>
                <div className={cn('h-1 w-1 rounded-full mr-1.5', theme === Theme.light ? 'bg-black' : 'bg-white')}> </div>
                <span className={cn(theme === Theme.light ? 'text-black' : 'text-white')}>Hidden input (visible only in preview mode)</span>
              </div>
            )}
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
