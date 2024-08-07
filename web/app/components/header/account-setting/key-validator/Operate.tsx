import { useTranslation } from 'react-i18next'
import Indicator from '../../indicator'
import type { Status } from './declarations'

type OperateProps = {
  isOpen: boolean
  status: Status
  disabled?: boolean
  onCancel: () => void
  onSave: () => void
  onAdd: () => void
  onEdit: () => void
}

const Operate = ({
  isOpen,
  status,
  disabled,
  onCancel,
  onSave,
  onAdd,
  onEdit,
}: OperateProps) => {
  const { t } = useTranslation()

  if (isOpen) {
    return (
      <div className='flex items-center'>
        <div className='
          flex items-center
          mr-[5px] px-3 h-7 rounded-md cursor-pointer
          text-xs font-medium text-gray-700
        ' onClick={onCancel} >
          {t('common.operation.cancel')}
        </div>
        <div className='
          flex items-center
          px-3 h-7 rounded-md cursor-pointer bg-primary-700
          text-xs font-medium text-white
        ' onClick={onSave}>
          {t('common.operation.save')}
        </div>
      </div>
    )
  }

  if (status === 'add') {
    return (
      <div className={
        `px-3 h-[28px] bg-white border border-gray-200 rounded-md cursor-pointer
        text-xs font-medium text-gray-700 flex items-center ${disabled && 'opacity-50 cursor-default'}}`
      } onClick={() => !disabled && onAdd()}>
        {t('common.provider.addKey')}
      </div>
    )
  }

  if (status === 'fail' || status === 'success') {
    return (
      <div className='flex items-center'>
        {
          status === 'fail' && (
            <div className='flex items-center mr-4'>
              <div className='text-xs text-[#D92D20]'>{t('common.provider.invalidApiKey')}</div>
              <Indicator color='red' className='ml-2' />
            </div>
          )
        }
        {
          status === 'success' && (
            <Indicator color='green' className='mr-4' />
          )
        }
        <div className={
          `px-3 h-[28px] bg-white border border-gray-200 rounded-md cursor-pointer
          text-xs font-medium text-gray-700 flex items-center ${disabled && 'opacity-50 cursor-default'}}`
        } onClick={() => !disabled && onEdit()}>
          {t('common.provider.editKey')}
        </div>
      </div>
    )
  }

  return null
}

export default Operate
