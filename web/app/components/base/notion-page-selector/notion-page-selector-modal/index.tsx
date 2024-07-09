import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { XMarkIcon } from '@heroicons/react/24/outline'
import NotionPageSelector from '../base'
import type { NotionPageSelectorValue } from '../base'
import s from './index.module.css'
import cn from '@/utils/classnames'
import Modal from '@/app/components/base/modal'

type NotionPageSelectorModalProps = {
  isShow: boolean
  onClose: () => void
  onSave: (selectedPages: NotionPageSelectorValue[]) => void
  datasetId: string
}
const NotionPageSelectorModal = ({
  isShow,
  onClose,
  onSave,
  datasetId,
}: NotionPageSelectorModalProps) => {
  const { t } = useTranslation()
  const [selectedPages, setSelectedPages] = useState<NotionPageSelectorValue[]>([])

  const handleClose = () => {
    onClose()
  }
  const handleSelectPage = (newSelectedPages: NotionPageSelectorValue[]) => {
    setSelectedPages(newSelectedPages)
  }
  const handleSave = () => {
    onSave(selectedPages)
  }

  return (
    <Modal
      className={s.modal}
      isShow={isShow}
      onClose={() => { }}
    >
      <div className='flex items-center justify-between mb-6 h-8'>
        <div className='text-xl font-semibold text-gray-900'>{t('common.dataSource.notion.selector.addPages')}</div>
        <div
          className='flex items-center justify-center -mr-2 w-8 h-8 cursor-pointer'
          onClick={handleClose}>
          <XMarkIcon className='w-4 h-4' />
        </div>
      </div>
      <NotionPageSelector
        onSelect={handleSelectPage}
        canPreview={false}
        datasetId={datasetId}
      />
      <div className='mt-8 flex justify-end'>
        <div className={s.operate} onClick={handleClose}>{t('common.operation.cancel')}</div>
        <div className={cn(s.operate, s['operate-save'])} onClick={handleSave}>{t('common.operation.save')}</div>
      </div>
    </Modal>
  )
}

export default NotionPageSelectorModal
