import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import FormItem from '../../nodes/_base/components/before-run-form/form-item'
import { BlockEnum } from '../../types'
import {
  useStore,
  useWorkflowStore,
} from '../../store'
import type { StartNodeType } from '../../nodes/start/types'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'

const UserInput = () => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const [expanded, setExpanded] = useState(true)
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
    <div
      className={`
        relative rounded-xl border z-[1]
        ${!expanded ? 'bg-indigo-25 border-indigo-100 shadow-none' : 'bg-white shadow-xs border-transparent'}
      `}
    >
      <div
        className={`
          flex items-center px-2 pt-4 h-[18px] text-[13px] font-semibold cursor-pointer
          ${!expanded ? 'text-indigo-800' : 'text-gray-800'}
        `}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronDown
          className={`mr-1 w-3 h-3 ${!expanded ? '-rotate-90 text-indigo-600' : 'text-gray-300'}`}
        />
        {t('workflow.panel.userInputField').toLocaleUpperCase()}
      </div>
      <div className='px-2 pt-1 pb-3'>
        {
          expanded && (
            <div className='py-2 text-[13px] text-gray-900'>
              {
                variables.map(variable => (
                  <div
                    key={variable.variable}
                    className='mb-2 last-of-type:mb-0'
                  >
                    <FormItem
                      payload={variable}
                      value={inputs[variable.variable]}
                      onChange={v => handleValueChange(variable.variable, v)}
                    />
                  </div>
                ))
              }
            </div>
          )
        }
      </div>
    </div>
  )
}

export default memo(UserInput)
