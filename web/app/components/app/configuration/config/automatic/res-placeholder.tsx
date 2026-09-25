'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

const ResPlaceholder: FC = () => {
  const { t } = useTranslation(['appGeneration'])
  return (
    <div className="flex min-w-0 flex-col items-center justify-center space-y-3 px-8 xl:h-full xl:flex-1">
      <span aria-hidden className="i-custom-vender-other-generator size-8 text-text-quaternary" />
      <div className="text-center text-[13px] leading-5 font-normal text-text-tertiary">
        <div>{t(($) => $['generate.newNoDataLine1'], { ns: 'appGeneration' })}</div>
      </div>
    </div>
  )
}
export default React.memo(ResPlaceholder)
