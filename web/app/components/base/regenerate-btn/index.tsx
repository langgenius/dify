'use client'
import { t } from 'i18next'
import { Refresh } from '../icons/src/vender/line/general'
import Tooltip from '@/app/components/base/tooltip'

type Props = {
  className?: string
  onClick?: () => void
}

const RegenerateBtn = ({ className, onClick }: Props) => {
  return (
    <div className={`${className}`}>
      <Tooltip
        popupContent={t('appApi.regenerate') as string}
      >
        <div
          className={'box-border flex cursor-pointer items-center justify-center rounded-md bg-white p-0.5'}
          onClick={() => onClick?.()}
          style={{
            boxShadow: '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)',
          }}
        >
          <Refresh className="h-6 w-6 p-[3.5px] text-[#667085] hover:bg-gray-50" />
        </div>
      </Tooltip>
    </div>
  )
}

export default RegenerateBtn
