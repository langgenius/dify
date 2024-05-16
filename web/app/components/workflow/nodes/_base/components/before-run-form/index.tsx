'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import type { Props as FormProps } from './form'
import Form from './form'
import Button from '@/app/components/base/button'
import { StopCircle } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import { Loading02, XClose } from '@/app/components/base/icons/src/vender/line/general'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import { InputVarType, NodeRunningStatus } from '@/app/components/workflow/types'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import Toast from '@/app/components/base/toast'
import { TransferMethod } from '@/types/app'

const i18nPrefix = 'workflow.singleRun'

type BeforeRunFormProps = {
  nodeName: string
  onHide: () => void
  onRun: (submitData: Record<string, any>) => void
  onStop: () => void
  runningStatus: NodeRunningStatus
  result?: JSX.Element
  forms: FormProps[]
}

function formatValue(value: string | any, type: InputVarType) {
  if (type === InputVarType.number)
    return parseFloat(value)
  if (type === InputVarType.json)
    return JSON.parse(value)
  if (type === InputVarType.contexts) {
    return value.map((item: any) => {
      return JSON.parse(item)
    })
  }

  return value
}
const BeforeRunForm: FC<BeforeRunFormProps> = ({
  nodeName,
  onHide,
  onRun,
  onStop,
  runningStatus,
  result,
  forms,
}) => {
  const { t } = useTranslation()

  const isFinished = runningStatus === NodeRunningStatus.Succeeded || runningStatus === NodeRunningStatus.Failed
  const isRunning = runningStatus === NodeRunningStatus.Running
  const isFileLoaded = (() => {
    // system files
    const filesForm = forms.find(item => !!item.values['#files#'])
    if (!filesForm)
      return true

    const files = filesForm.values['#files#'] as any
    if (files?.some((item: any) => item.transfer_method === TransferMethod.local_file && !item.upload_file_id))
      return false

    return true
  })()
  const handleRun = useCallback(() => {
    let errMsg = ''
    forms.forEach((form) => {
      form.inputs.forEach((input) => {
        const value = form.values[input.variable]
        if (!errMsg && input.required && (value === '' || value === undefined || value === null || (input.type === InputVarType.files && value.length === 0)))
          errMsg = t('workflow.errorMsg.fieldRequired', { field: typeof input.label === 'object' ? input.label.variable : input.label })
      })
    })
    if (errMsg) {
      Toast.notify({
        message: errMsg,
        type: 'error',
      })
      return
    }

    const submitData: Record<string, any> = {}
    let parseErrorJsonField = ''
    forms.forEach((form) => {
      form.inputs.forEach((input) => {
        try {
          const value = formatValue(form.values[input.variable], input.type)
          submitData[input.variable] = value
        }
        catch (e) {
          parseErrorJsonField = input.variable
        }
      })
    })
    if (parseErrorJsonField) {
      Toast.notify({
        message: t('workflow.errorMsg.invalidJson', { field: parseErrorJsonField }),
        type: 'error',
      })
      return
    }

    onRun(submitData)
  }, [forms, onRun, t])
  return (
    <div className='absolute inset-0 z-10 rounded-2xl pt-10' style={{
      backgroundColor: 'rgba(16, 24, 40, 0.20)',
    }}>
      <div className='h-full rounded-2xl bg-white flex flex-col'>
        <div className='shrink-0 flex justify-between items-center h-8 pl-4 pr-3 pt-3'>
          <div className='text-base font-semibold text-gray-900 truncate'>
            {t(`${i18nPrefix}.testRun`)} {nodeName}
          </div>
          <div className='ml-2 shrink-0 p-1 cursor-pointer' onClick={onHide}>
            <XClose className='w-4 h-4 text-gray-500 ' />
          </div>
        </div>

        <div className='h-0 grow overflow-y-auto pb-4'>
          <div className='mt-3 px-4 space-y-4'>
            {forms.map((form, index) => (
              <div key={index}>
                <Form
                  key={index}
                  className={cn(index < forms.length - 1 && 'mb-4')}
                  {...form}
                />
                {index < forms.length - 1 && <Split />}
              </div>
            ))}
          </div>

          <div className='mt-4 flex justify-between space-x-2 px-4' >
            {isRunning && (
              <div
                className='p-2 rounded-lg border border-gray-200 bg-white shadow-xs cursor-pointer'
                onClick={onStop}
              >
                <StopCircle className='w-4 h-4 text-gray-500' />
              </div>
            )}
            <Button disabled={!isFileLoaded || isRunning} type='primary' className='w-0 grow !h-8 flex items-center space-x-2 text-[13px]' onClick={handleRun}>
              {isRunning && <Loading02 className='animate-spin w-4 h-4 text-white' />}
              <div>{t(`${i18nPrefix}.${isRunning ? 'running' : 'startRun'}`)}</div>
            </Button>
          </div>
          {isRunning && (
            <ResultPanel status='running' showSteps={false} />
          )}
          {isFinished && (
            <>
              {result}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
export default React.memo(BeforeRunForm)
