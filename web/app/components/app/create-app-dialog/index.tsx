'use client'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import NewAppDialog from './newAppDialog'
import AppList, { PageType } from '@/app/components/explore/app-list'

type CreateAppDialogProps = {
  show: boolean
  onSuccess: () => void
  onClose: () => void
}

const CreateAppTemplateDialog = ({ show, onSuccess, onClose }: CreateAppDialogProps) => {
  const { t } = useTranslation()

  return (
    <NewAppDialog
      className='flex'
      show={show}
      onClose={() => {}}
    >
      {/* template list */}
      <div className='grow flex flex-col h-full bg-gray-100'>
        <div className='shrink-0 pl-8 pr-6 pt-6 pb-3 bg-gray-100 rounded-se-xl text-xl leading-[30px] font-semibold text-gray-900 z-10'>{t('app.newApp.startFromTemplate')}</div>
        <AppList onSuccess={() => {
          onSuccess()
          onClose()
        }} pageType={PageType.CREATE} />
      </div>
      <div className='absolute right-6 top-6 p-2 cursor-pointer z-20' onClick={onClose}>
        <RiCloseLine className='w-4 h-4 text-gray-500' />
      </div>
    </NewAppDialog>
  )
}

export default CreateAppTemplateDialog
