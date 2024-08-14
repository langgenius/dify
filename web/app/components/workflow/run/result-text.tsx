'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageIndentLeft } from '@/app/components/base/icons/src/vender/line/editor'
import { Markdown } from '@/app/components/base/markdown'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'

type ResultTextProps = {
  isRunning?: boolean
  outputs?: any
  error?: string
  onClick?: () => void
}

const ResultText: FC<ResultTextProps> = ({
  isRunning,
  outputs,
  error,
  onClick,
}) => {
  const { t } = useTranslation()
  return (
    <div className='bg-gray-50 py-2'>
      {isRunning && !outputs && (
        <div className='pt-4 pl-[26px]'>
          <LoadingAnim type='text' />
        </div>
      )}
      {!isRunning && error && (
        <div className='px-4'>
          <div className='px-3 py-[10px] rounded-lg !bg-[#fef3f2] border-[0.5px] border-[rbga(0,0,0,0.05)] shadow-xs'>
            <div className='text-xs leading-[18px] text-[#d92d20]'>{error}</div>
          </div>
        </div>
      )}
      {!isRunning && !outputs && !error && (
        <div className='mt-[120px] px-4 py-2 flex flex-col items-center text-[13px] leading-[18px] text-gray-500'>
          <ImageIndentLeft className='w-6 h-6 text-gray-400' />
          <div className='mr-2'>{t('runLog.resultEmpty.title')}</div>
          <div>
            {t('runLog.resultEmpty.tipLeft')}
            <span onClick={onClick} className='cursor-pointer text-primary-600'>{t('runLog.resultEmpty.link')}</span>
            {t('runLog.resultEmpty.tipRight')}
          </div>
        </div>
      )}
      {outputs && (
        <div className='px-4 py-2'>
          <Markdown content={outputs} />
        </div>
      )}
    </div>
  )
}

export default ResultText
