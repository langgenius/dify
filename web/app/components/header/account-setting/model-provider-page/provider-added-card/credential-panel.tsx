import { useTranslation } from 'react-i18next'
import Indicator from '@/app/components/header/indicator'
import { Settings01 } from '@/app/components/base/icons/src/vender/line/general'

const CredentialPanel = () => {
  const { t } = useTranslation()

  return (
    <div className='shrink-0 p-1 rounded-lg bg-white/[0.3] border-[0.5px] border-black/5'>
      <div className='flex items-center justify-between mb-1 pt-1 pl-2 pr-[7px]'>
        API-KEY
        <Indicator />
      </div>
      <div className={`
        w-[104px] h-6 flex justify-center items-center
        rounded-md bg-white border-[0.5px] border-gray-200
        shadow-xs text-xs font-medium text-gray-500 cursor-pointer
      `}>
        <Settings01 className='mr-1 w-3 h-3' />
        {t('common.operation.setup')}
      </div>
    </div>
  )
}

export default CredentialPanel
