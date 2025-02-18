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
  WorkflowRunningStatus,
} from '../types'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import { useWorkflowRun } from '../hooks'
import type { StartNodeType } from '../nodes/start/types'
import { TransferMethod } from '../../base/text-generation/types'
import Button from '@/app/components/base/button'
import { useFeatures } from '@/app/components/base/features/hooks'
import {
  getProcessedInputs,
} from '@/app/components/base/chat/chat/utils'
import { useCheckInputsForms } from '@/app/components/base/chat/chat/check-input-forms-hooks'

interface Props {
  onRun: () => void
}

const InputsPanel = ({ onRun }: Props) => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const fileSettings = useFeatures(s => s.features.file)
  const nodes = useNodes<StartNodeType>()
  const inputs = useStore(s => s.inputs)
  const files = useStore(s => s.files)
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const {
    handleRun,
  } = useWorkflowRun()
  const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
  const startVariables = startNode?.data.variables
  const { checkInputsForm } = useCheckInputsForms()

  const variables = useMemo(() => {
    const data = startVariables || []
    if (fileSettings?.image?.enabled) {
      return [
        ...data,
        {
          type: InputVarType.files,
          variable: '__image',
          required: false,
          label: 'files',
        },
      ]
    }

    return data
  }, [fileSettings?.image?.enabled, startVariables])

  const handleValueChange = (variable: string, v: any) => {
    const {
      inputs,
      setInputs,
    } = workflowStore.getState()
    if (variable === '__image') {
      workflowStore.setState({
        files: v,
      })
    }
    else {
      setInputs({
        ...inputs,
        [variable]: v,
      })
    }
  }

  const doRun = useCallback(() => {
    if (!checkInputsForm(inputs, variables as any))
      return
    onRun()
    handleRun({ inputs: getProcessedInputs(inputs, variables as any), files })
  }, [files, handleRun, inputs, onRun, variables, checkInputsForm])

  const canRun = useMemo(() => {
    if (files?.some(item => (item.transfer_method as any) === TransferMethod.local_file && !item.upload_file_id))
      return false

    return true
  }, [files])

  return (
    <>
      <div className='px-4 pb-2 pt-3'>
        {
          variables.map((variable, index) => (
            <div
              key={variable.variable}
              className='mb-2 last-of-type:mb-0'
            >
              <FormItem
                autoFocus={index === 0}
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
          variant='primary'
          disabled={!canRun || workflowRunningData?.result?.status === WorkflowRunningStatus.Running}
          className='w-full'
          onClick={doRun}
        >
          {t('workflow.singleRun.startRun')}
        </Button>
      </div>
    </>
  )
}

export default memo(InputsPanel)
