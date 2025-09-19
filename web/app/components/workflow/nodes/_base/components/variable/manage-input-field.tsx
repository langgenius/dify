import { useTranslation } from 'react-i18next'
import { RiAddLine } from '@remixicon/react'

type ManageInputFieldProps = {
  onManage: () => void
}

const ManageInputField = ({
  onManage,
}: ManageInputFieldProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center border-t border-divider-subtle pt-1'>
      <div
        className='flex h-8 grow cursor-pointer items-center px-3'
        onClick={onManage}
      >
        <RiAddLine className='mr-1 h-4 w-4 text-text-tertiary' />
        <div
          className='system-xs-medium truncate text-text-tertiary'
          title='Create user input field'
        >
          {t('pipeline.inputField.create')}
        </div>
      </div>
      <div className='mx-1 h-3 w-[1px] shrink-0 bg-divider-regular'></div>
      <div
        className='system-xs-medium flex h-8 shrink-0 cursor-pointer items-center justify-center px-3 text-text-tertiary'
        onClick={onManage}
      >
        {t('pipeline.inputField.manage')}
      </div>
    </div>
  )
}

export default ManageInputField
