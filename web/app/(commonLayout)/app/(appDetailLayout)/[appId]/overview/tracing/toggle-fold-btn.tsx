'use client'
import { ChevronDoubleDownIcon } from '@heroicons/react/20/solid'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import React, { useCallback } from 'react'
import Tooltip from '@/app/components/base/tooltip'

const I18N_PREFIX = 'app.tracing'

type Props = {
  isFold: boolean
  onFoldChange: (isFold: boolean) => void
}

const ToggleFoldBtn: FC<Props> = ({
  isFold,
  onFoldChange,
}) => {
  const { t } = useTranslation()

  const handleFoldChange = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    onFoldChange(!isFold)
  }, [isFold, onFoldChange])
  return (
    // text-[0px] to hide spacing between tooltip elements
    <div className='shrink-0 cursor-pointer text-[0px]' onClick={handleFoldChange}>
      <Tooltip
        popupContent={t(`${I18N_PREFIX}.${isFold ? 'expand' : 'collapse'}`)}
      >
        {isFold && (
          <div className='p-1 rounded-md text-gray-500 hover:text-gray-800 hover:bg-black/5'>
            <ChevronDoubleDownIcon className='w-4 h-4' />
          </div>
        )}
        {!isFold && (
          <div className='p-2 rounded-lg text-gray-500 border-[0.5px] border-gray-200 hover:text-gray-800 hover:bg-black/5'>
            <ChevronDoubleDownIcon className='w-4 h-4 transform rotate-180' />
          </div>
        )}
      </Tooltip>
    </div>
  )
}
export default React.memo(ToggleFoldBtn)
