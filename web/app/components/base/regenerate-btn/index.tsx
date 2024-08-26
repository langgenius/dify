'use client'
import { t } from 'i18next'
import { MaterialSymbolsRefresh } from '../icons/src/vender/line/general'
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
        >
          <MaterialSymbolsRefresh className="p-[2px] w-6 h-6 text-[#667085]" />
        </div>
      </Tooltip>
    </div>
  )
}

export default RegenerateBtn
