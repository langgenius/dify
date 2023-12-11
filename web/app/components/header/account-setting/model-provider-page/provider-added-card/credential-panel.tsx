import { useTranslation } from 'react-i18next'
import PrioritySelector from './priority-selector'
import Indicator from '@/app/components/header/indicator'
import { Settings01 } from '@/app/components/base/icons/src/vender/line/general'
import { ChevronDownDouble } from '@/app/components/base/icons/src/vender/line/arrows'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'
import { IS_CE_EDITION } from '@/config'

const CredentialPanel = () => {
  const { t } = useTranslation()

  return (
    <div className='shrink-0 relative ml-1 p-1 w-[112px] rounded-lg bg-white/[0.3] border-[0.5px] border-black/5'>
      <div className='flex items-center justify-between mb-1 pt-1 pl-2 pr-[7px] h-5 text-xs font-medium text-gray-500'>
        API-KEY
        <Indicator />
      </div>
      <div className='flex items-center gap-0.5'>
        <Button className='grow px-0 h-6 bg-white text-xs font-medium rounded-md'>
          <Settings01 className='mr-1 w-3 h-3' />
          {t('common.operation.setup')}
        </Button>
        {
          !IS_CE_EDITION && (
            <PrioritySelector
              onSelect={() => {}}
              value='custom'
            />
          )
        }
      </div>
      {
        !IS_CE_EDITION && (
          <Tooltip selector='provider-quota-credential-priority-using' content='Prioritize using'>
            <div className='absolute -right-[5px] -top-[5px] bg-indigo-50 rounded-[5px] border-[0.5px] border-indigo-100 cursor-pointer'>
              <ChevronDownDouble className='rotate-180 w-3 h-3 text-indigo-600' />
            </div>
          </Tooltip>
        )
      }
    </div>
  )
}

export default CredentialPanel
