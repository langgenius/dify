'use client'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import { Exchange02, FileCode } from '@/app/components/base/icons/src/vender/line/others'

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
      <div className={cn('mb-0.5 flex cursor-pointer items-center rounded-lg p-1 pl-3 text-sm leading-5 hover:bg-white', value === 'builtin' && '!bg-white font-medium')} onClick={() => onSelect('builtin')}>
        <div className="mr-2 h-4 w-4 shrink-0 bg-[url('~@/app/components/tools/add-tool-modal/D.png')] bg-cover bg-no-repeat" />
        <span className={cn('text-gray-700', value === 'builtin' && '!text-primary-600')}>{t('tools.type.builtIn')}</span>
      </div>
      <div className={cn('mb-0.5 flex cursor-pointer items-center rounded-lg p-1 pl-3 text-sm leading-5 text-gray-700 hover:bg-white', value === 'api' && '!bg-white font-medium !text-primary-600')} onClick={() => onSelect('api')}>
        <FileCode className='mr-2 h-4 w-4 shrink-0' />
        {t('tools.type.custom')}
      </div>
      <div className={cn('mb-0.5 flex cursor-pointer items-center rounded-lg p-1 pl-3 text-sm leading-5 text-gray-700 hover:bg-white', value === 'workflow' && '!bg-white font-medium !text-primary-600')} onClick={() => onSelect('workflow')}>
        <Exchange02 className='mr-2 h-4 w-4 shrink-0' />
        {t('tools.type.workflow')}
      </div>
    </div>
  )
}
export default Types
