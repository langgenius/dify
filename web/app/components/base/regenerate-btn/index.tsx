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
          className={'box-border p-0.5 flex items-center justify-center rounded-md bg-white cursor-pointer'}
          onClick={() => onClick?.()}
          style={{
            boxShadow: '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)',
          }}
        >
          <Refresh className="p-[3.5px] w-6 h-6 text-[#667085] hover:bg-gray-50" />
        </div>
      </Tooltip>
    </div>
  )
}

export default RegenerateBtn
