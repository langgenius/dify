'use client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import s from './style.module.css'
import NewAppDialog from './newAppDialog'
import AppForm from './appForm'
import AppList, { PageType } from '@/app/components/explore/app-list'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'

type CreateAppDialogProps = {
  show: boolean
  onSuccess: () => void
  onClose: () => void
}

const CreateAppDialog = ({ show, onSuccess, onClose }: CreateAppDialogProps) => {
  const { t } = useTranslation()
  const [showInstruction, setShowInstruction] = useState<string>('')

  return (
    <NewAppDialog
      className='flex'
      show={show}
      onClose={() => {}}
    >
      {/* blank form */}
      <div className='shrink-0 flex flex-col max-w-[520px] h-full bg-white'>
        {/* Heading */}
        <div className='shrink-0 pl-8 pr-6 pt-6 pb-3 bg-white rounded-ss-xl text-xl leading-[30px] font-semibold text-gray-900 z-10'>{t('app.newApp.startFromBlank')}</div>
        {/* app form */}
        <AppForm onHide={onClose} onConfirm={onSuccess} onTipChange={setShowInstruction}/>
      </div>
      {/* template list */}
      <div className='grow flex flex-col h-full bg-gray-100'>
        <div className='shrink-0 pl-8 pr-6 pt-6 pb-3 bg-gray-100 rounded-se-xl text-xl leading-[30px] font-semibold text-gray-900 z-10'>{t('app.newApp.startFromTemplate')}</div>
        <AppList pageType={PageType.CREATE} />
      </div>
      <div
        className={cn(
          'hidden absolute left-[452px] top-[68px] w-[376px] rounded-xl bg-white border-[0.5px] border-[rgba(0,0,0,0.05)] shadow-lg',
          showInstruction && '!block',
        )}
      >
        {showInstruction === 'BASIC' && (
          <>
            <div className={cn('w-full h-[256px] bg-center bg-no-repeat bg-contain', s.basicPic)}/>
            <div className='px-4 pb-2'>
              <div className='text-gray-700 text-md leading-6 font-semibold'>{t('app.newApp.basic')}</div>
              <div className='text-orange-500 text-xs leading-[18px] font-medium'>{t('app.newApp.basicFor')}</div>
              <div className='mt-1 text-gray-500 text-sm leading-5'>{t('app.newApp.basicDescription')}</div>
            </div>
          </>
        )}
        {showInstruction === 'ADVANCED' && (
          <>
            <div className={cn('w-full h-[256px] bg-center bg-no-repeat bg-contain', s.advancedPic)}/>
            <div className='px-4 pb-2'>
              <div className='flex items-center gap-1 text-gray-700 text-md leading-6 font-semibold'>
                {t('app.newApp.advanced')}
                <span className='px-1 rounded-[5px] bg-white border border-black/8 text-gray-500 text-[10px] leading-[18px] font-medium'>BETA</span>
              </div>
              <div className='text-orange-500 text-xs leading-[18px] font-medium'>{t('app.newApp.advancedFor')}</div>
              <div className='mt-1 text-gray-500 text-sm leading-5'>{t('app.newApp.advancedDescription')}</div>
            </div>
          </>
        )}
      </div>
      <div className='absolute top-6 left-[505px] w-8 h-8 p-1 bg-white border-2 border-gray-200 rounded-2xl text-xs leading-[20px] font-medium text-primary-600 cursor-default z-20'>OR</div>
      <div className='absolute right-6 top-6 p-2 cursor-pointer z-20' onClick={onClose}>
        <XClose className='w-4 h-4 text-gray-500' />
      </div>
    </NewAppDialog>
  )
}

export default CreateAppDialog
