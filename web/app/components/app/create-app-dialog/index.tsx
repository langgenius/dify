'use client'

import { useTranslation } from 'react-i18next'
import NewAppDialog from './newAppDialog'
import AppForm from './appForm'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'

type CreateAppDialogProps = {
  show: boolean
  onSuccess: () => void
  onClose: () => void
}

const CreateAppDialog = ({ show, onSuccess, onClose }: CreateAppDialogProps) => {
  const { t } = useTranslation()

  return (
    <NewAppDialog
      className='flex'
      show={show}
      onClose={() => {}}
    >
      {/* blank form */}
      <div className='shrink-0 max-w-[480px] h-full bg-white overflow-y-auto'>
        {/* Heading */}
        <div className='sticky top-0 pl-8 pr-6 pt-6 pb-3 rounded-ss-xl text-xl leading-[30px] font-semibold text-gray-900'>{t('app.newApp.startFromBlank')}</div>
        {/* app form */}
        <AppForm onHide={onClose} onConfirm={onSuccess}/>
      </div>
      {/* template list */}
      <div className='grow bg-gray-100'>
        <div className='sticky top-0 pl-8 pr-6 pt-6 pb-3 rounded-se-xl text-xl leading-[30px] font-semibold text-gray-900'>{t('app.newApp.startFromTemplate')}</div>
      </div>
      <div className='absolute top-6 left-[464px] w-8 h-8 p-1 bg-white border-2 border-gray-200 rounded-2xl text-xs leading-[20px] font-medium text-gray-500 cursor-default'>OR</div>
      <div className='absolute right-6 top-6 p-2 cursor-pointer' onClick={onClose}>
        <XClose className='w-4 h-4 text-gray-500' />
      </div>
    </NewAppDialog>
  )
}

export default CreateAppDialog
