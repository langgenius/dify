import type { Status } from './declarations'
import { useTranslation } from 'react-i18next'
import Indicator from '../../indicator'

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
      <div className="flex items-center">
        <div
          className="
          mr-[5px] flex
          h-7 cursor-pointer items-center rounded-md px-3
          text-xs font-medium text-gray-700
        "
          onClick={onCancel}
        >
          {t('operation.cancel', { ns: 'common' })}
        </div>
        <div
          className="
          flex h-7
          cursor-pointer items-center rounded-md bg-primary-700 px-3
          text-xs font-medium text-white
        "
          onClick={onSave}
        >
          {t('operation.save', { ns: 'common' })}
        </div>
      </div>
    )
  }

  if (status === 'add') {
    return (
      <div
        className={
          `flex h-[28px] cursor-pointer items-center rounded-md border border-gray-200
        bg-white px-3 text-xs font-medium text-gray-700 ${disabled && 'cursor-default opacity-50'}}`
        }
        onClick={() => !disabled && onAdd()}
      >
        {t('provider.addKey', { ns: 'common' })}
      </div>
    )
  }

  if (status === 'fail' || status === 'success') {
    return (
      <div className="flex items-center">
        {
          status === 'fail' && (
            <div className="mr-4 flex items-center">
              <div className="text-xs text-[#D92D20]">{t('provider.invalidApiKey', { ns: 'common' })}</div>
              <Indicator color="red" className="ml-2" />
            </div>
          )
        }
        {
          status === 'success' && (
            <Indicator color="green" className="mr-4" />
          )
        }
        <div
          className={
            `flex h-[28px] cursor-pointer items-center rounded-md border border-gray-200
          bg-white px-3 text-xs font-medium text-gray-700 ${disabled && 'cursor-default opacity-50'}}`
          }
          onClick={() => !disabled && onEdit()}
        >
          {t('provider.editKey', { ns: 'common' })}
        </div>
      </div>
    )
  }

  return null
}

export default Operate
