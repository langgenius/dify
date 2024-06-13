'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TracingTool } from './type'
import TracingIcon from './tracing-icon'
import ToggleExpandBtn from './toggle-fold-btn'
import ConfigButton from './config-button'
import { LangfuseIcon, LangsmithIcon } from '@/app/components/base/icons/src/public/tracing'
const I18N_PREFIX = 'app.tracing'
// const ConfigBtn = ({
//   className,
// }: {
//   className?: string
// }) => {

//   return (
//     <Button type='primary'
//       className={cn(className, '!h-8 !px-3')}
//     >
//       <Settings04 className='mr-1 w-4 h-4' />
//       <span className='text-[13px]'>{t(`${I18N_PREFIX}.config`)}</span>
//     </Button>
//   )
// }

const Panel: FC = () => {
  const { t } = useTranslation()

  const inUseTracingTool: TracingTool | undefined = undefined
  const hasConfiguredTracing = !!inUseTracingTool
  const [isFold, setFold] = useState(true)

  if (!isFold && !hasConfiguredTracing) {
    return (
      <div className='flex justify-between p-3 pr-4 items-center bg-white border-[0.5px] border-black/8 rounded-xl shadow-md'>
        <div className='flex space-x-2'>
          <TracingIcon size='lg' className='m-1' />
          <div>
            <div className='mb-0.5 leading-6 text-base font-semibold text-gray-900'>{t(`${I18N_PREFIX}.title`)}</div>
            <div className='flex justify-between leading-4 text-xs font-normal text-gray-500'>
              <span className='mr-2'>{t(`${I18N_PREFIX}.description`)}</span>
              <div className='flex space-x-3'>
                <LangsmithIcon className='h-4' />
                <LangfuseIcon className='h-4' />
              </div>
            </div>
          </div>
        </div>

        <div className='flex items-center space-x-1'>
          <ConfigButton hasConfigured={false} />
          <ToggleExpandBtn isFold={isFold} onFoldChange={setFold} />
        </div>
      </div>
    )
  }

  return (
    <div className='inline-flex items-center p-2 rounded-xl border-[0.5px] border-gray-200 shadow-xs hover:bg-gray-200'>
      <TracingIcon size='md' className='mr-2' />
      <div className='leading-5 text-sm font-semibold text-gray-700'>{t(`${I18N_PREFIX}.title`)}</div>
      <div className='ml-2 p-1'>
        <ConfigButton hasConfigured />
      </div>
      <div className='mx-2 w-px h-3.5 bg-gray-200'></div>
      <ToggleExpandBtn isFold={isFold} onFoldChange={setFold} />
    </div>
  )
}
export default React.memo(Panel)
