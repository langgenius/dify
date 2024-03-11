import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import FormItem from '../nodes/_base/components/before-run-form/form-item'
import { BlockEnum } from '../types'
import { useStore } from '../store'
import { useWorkflowRun } from '../hooks'
import type { StartNodeType } from '../nodes/start/types'
import Button from '@/app/components/base/button'

const InputsPanel = () => {
  const { t } = useTranslation()
  const nodes = useNodes<StartNodeType>()
  const run = useWorkflowRun()
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
  const variables = startNode?.data.variables || []

  const handleValueChange = (variable: string, v: string) => {
    setInputs({
      ...inputs,
      [variable]: v,
    })
  }

  const handleCancel = useCallback(() => {
    useStore.setState({ showInputsPanel: false })
  }, [])

  const handleRun = () => {
    run(inputs)
  }

  return (
    <div className='absolute top-0 right-2 w-[420px] pb-2 rounded-2xl border-[0.5px] border-gray-200 bg-white shadow-xl z-[11]'>
      <div className='flex items-center pt-3 px-4 h-[44px] text-base font-semibold text-gray-900'>
        {t('workflow.singleRun.testRun')}
      </div>
      <div className='px-4 pb-2'>
        {
          variables.map(variable => (
            <div
              key={variable.variable}
              className='mb-2 last-of-type:mb-0'
            >
              <FormItem
                className='!block'
                payload={variable}
                value={inputs[variable.variable]}
                onChange={v => handleValueChange(variable.variable, v)}
              />
            </div>
          ))
        }
      </div>
      <div className='flex items-center justify-between px-4 py-2'>
        <Button
          className='py-0 w-[190px] h-8 rounded-lg border-[0.5px] border-gray-200 shadow-xs text-[13px] font-medium text-gray-700'
          onClick={handleCancel}
        >
          {t('common.operation.cancel')}
        </Button>
        <Button
          type='primary'
          className='py-0 w-[190px] h-8 rounded-lg text-[13px] font-medium'
          onClick={handleRun}
        >
          {t('workflow.singleRun.startRun')}
        </Button>
      </div>
    </div>
  )
}

export default memo(InputsPanel)
