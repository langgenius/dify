'use client'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'

type Props = {
  value: string
  onSelect: (type: string) => void
}

const Types = ({
  value,
  onSelect,
}: Props) => {
  const { t } = useTranslation()

  return (
    <div className='mb-3'>
      <div className='px-3 py-0.5 text-gray-500 text-xs leading-[18px] font-medium'>{t('tools.addToolModal.type').toLocaleUpperCase()}</div>
      <div className={cn('mb-0.5 p-1 pl-3 flex items-center cursor-pointer text-gray-700 text-sm leading-5 rounded-lg hover:bg-white', value === 'all' && '!bg-white !text-primary-600 font-medium')} onClick={() => onSelect('all')}>{t('tools.type.all')}</div>
      <div className={cn('mb-0.5 p-1 pl-3 flex items-center cursor-pointer text-gray-700 text-sm leading-5 rounded-lg hover:bg-white', value === 'builtin' && '!bg-white !text-primary-600 font-medium')} onClick={() => onSelect('builtin')}>{t('tools.type.builtIn')}</div>
      <div className={cn('mb-0.5 p-1 pl-3 flex items-center cursor-pointer text-gray-700 text-sm leading-5 rounded-lg hover:bg-white', value === 'custom' && '!bg-white !text-primary-600 font-medium')} onClick={() => onSelect('api')}>{t('tools.type.custom')}</div>
      <div className={cn('mb-0.5 p-1 pl-3 flex items-center cursor-pointer text-gray-700 text-sm leading-5 rounded-lg hover:bg-white', value === 'workflow' && '!bg-white !text-primary-600 font-medium')} onClick={() => onSelect('workflow')}>{t('tools.type.workflow')}</div>
    </div>
  )
}
export default Types
