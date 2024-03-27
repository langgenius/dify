import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import FormItem from '../nodes/_base/components/before-run-form/form-item'
import {
  BlockEnum,
  InputVarType,
} from '../types'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import { useWorkflowRun } from '../hooks'
import type { StartNodeType } from '../nodes/start/types'
import Button from '@/app/components/base/button'
import { useFeatures } from '@/app/components/base/features/hooks'

const InputsPanel = () => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const fileSettings = useFeatures(s => s.features.file)
  const nodes = useNodes<StartNodeType>()
  const inputs = useStore(s => s.inputs)
  const files = useStore(s => s.files)
  const {
    handleRun,
    handleRunSetting,
  } = useWorkflowRun()
  const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
  const startVariables = startNode?.data.variables

  const variables = useMemo(() => {
    const data = startVariables || []
    if (fileSettings?.image.enabled) {
      return [
        ...data,
        {
          type: InputVarType.files,
          variable: '__image',
          required: true,
          label: 'files',
        },
      ]
    }

    return data
  }, [fileSettings.image.enabled, startVariables])

  const handleValueChange = (variable: string, v: any) => {
    if (variable === '__image') {
      workflowStore.setState({
        files: v,
      })
    }
    else {
      workflowStore.getState().setInputs({
        ...inputs,
        [variable]: v,
      })
    }
  }

  const handleCancel = useCallback(() => {
    workflowStore.setState({ showInputsPanel: false })
  }, [workflowStore])

  const doRun = () => {
    handleCancel()
    handleRunSetting()
    handleRun({ inputs, files })
  }

  return (
    <div className='absolute top-0 right-2 w-[420px] h-full z-[11] overflow-y-auto'>
      <div className='pb-2 rounded-2xl border-[0.5px] border-gray-200 bg-white shadow-xl'>
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
            onClick={doRun}
          >
            {t('workflow.singleRun.startRun')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default memo(InputsPanel)
