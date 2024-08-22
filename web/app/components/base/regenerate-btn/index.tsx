'use client'
import { useRef } from 'react'
import { t } from 'i18next'
import { MaterialSymbolsRefresh } from '../icons/src/vender/line/general'
import Tooltip from '@/app/components/base/tooltip'
import { randomString } from '@/utils'

type Props = {
  className?: string
  onClick?: () => void
}

const RegenerateBtn = ({ className, onClick }: Props) => {
  const selector = useRef(`copy-tooltip-${randomString(4)}`)

  return (
    <div className={`${className}`}>
      <Tooltip
        selector={selector.current}
        content={t('appApi.regenerate') as string}
        className='z-10'
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
