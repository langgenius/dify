'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import type { Props as FormProps } from './form'
import Form from './form'
import Button from '@/app/components/base/button'
import { StopCircle } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import { Loading02, XClose } from '@/app/components/base/icons/src/vender/line/general'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import { NodeRunningStatus } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.singleRun'

type BeforeRunFormProps = {
  nodeName: string
  onHide: () => void
  onRun: () => void
  onStop: () => void
  runningStatus: NodeRunningStatus
  result?: JSX.Element
  forms: FormProps[]
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
            <Button disabled={isRunning} type='primary' className='w-0 grow !h-8 flex items-center space-x-2' onClick={onRun}>
              {isRunning && <Loading02 className='animate-spin w-4 h-4 text-white' />}
              <div>{t(`${i18nPrefix}.${isRunning ? 'running' : 'startRun'}`)}</div>
            </Button>
          </div>

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
