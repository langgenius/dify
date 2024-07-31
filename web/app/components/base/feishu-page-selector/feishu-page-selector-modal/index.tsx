import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { XMarkIcon } from '@heroicons/react/24/outline'
import FeishuPageSelector from '../base'
import type { FeishuPageSelectorValue } from '../base'
import s from './index.module.css'
import Modal from '@/app/components/base/modal'

type FeishuPageSelectorModalProps = {
  isShow: boolean
  onClose: () => void
  onSave: (selectedPages: FeishuPageSelectorValue[]) => void
  datasetId: string
}
const FeishuPageSelectorModal = ({
  isShow,
  onClose,
  onSave,
  datasetId,
}: FeishuPageSelectorModalProps) => {
  const { t } = useTranslation()
  const [selectedPages, setSelectedPages] = useState<FeishuPageSelectorValue[]>([])

  const handleClose = () => {
    onClose()
  }
  const handleSelectPage = (newSelectedPages: FeishuPageSelectorValue[]) => {
    setSelectedPages(newSelectedPages)
  }
  const handleSave = () => {
    onSave(selectedPages)
  }

  return (
    <Modal
      className={s.modal}
      isShow={isShow}
      onClose={() => {}}
    >
      <div className='flex items-center justify-between mb-6 h-8'>
        <div className='text-xl font-semibold text-gray-900'>{t('common.dataSource.notion.selector.addPages')}</div>
        <div
          className='flex items-center justify-center -mr-2 w-8 h-8 cursor-pointer'
          onClick={handleClose}>
          <XMarkIcon className='w-4 h-4' />
        </div>
      </div>
      <FeishuPageSelector
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

export default FeishuPageSelectorModal
