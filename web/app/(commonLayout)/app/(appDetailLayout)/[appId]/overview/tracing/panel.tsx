'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import cn from 'classnames'
import type { TracingTool } from './type'
import TracingIcon from './tracing-icon'
import Button from '@/app/components/base/button'
import { LangfuseIcon, LangsmithIcon } from '@/app/components/base/icons/src/public/tracing'

const ConfigBtn = ({
  className,
}: {
  className?: string
}) => {
  const { t } = useTranslation()

  return (
    <Button type='primary' className={cn(className)}>Config</Button>
  )
}

const Panel: FC = () => {
  const { t } = useTranslation()

  const inUseTracingTool: TracingTool | undefined = undefined
  const hasConfiguredTracing = !!inUseTracingTool
  const [isFold, {
    toggle: toggleFold,
  }] = useBoolean(false)

  if (!isFold) {
    return (
      <div className='flex justify-between p-3 pr-4 items-center bg-white border-[0.5px] border-black/8 rounded-xl shadow-md'>
        <div className='flex space-x-2'>
          <TracingIcon size='lg' className='m-1' />
          <div>
            <div className='mb-0.5 leading-6 text-base font-semibold text-gray-900'>Tracing app performance</div>
            <div className='flex justify-between leading-4 text-xs font-normal text-gray-500'>
              <span className='mr-2'>Configuring a Third-Party LLMOps provider and tracing app performance.</span>
              <div className='flex space-x-3'>
                <LangsmithIcon className='h-4' />
                <LangfuseIcon className='h-4' />
              </div>
            </div>
          </div>
        </div>

        <div>
          <ConfigBtn />

        </div>
      </div>
    )
  }

  return (
    <div>
    </div>
  )
}
export default React.memo(Panel)
