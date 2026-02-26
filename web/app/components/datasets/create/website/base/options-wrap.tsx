'use client'
import type { FC } from 'react'
import { RiEqualizer2Line } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'
import { cn } from '@/utils/classnames'

const I18N_PREFIX = 'stepOne.website'

type Props = {
  className?: string
  children: React.ReactNode
  controlFoldOptions?: number
}

const OptionsWrap: FC<Props> = ({
  className = '',
  children,
  controlFoldOptions,
}) => {
  const { t } = useTranslation()

  const [fold, {
    toggle: foldToggle,
    setTrue: foldHide,
  }] = useBoolean(false)

  useEffect(() => {
    if (controlFoldOptions)
      foldHide()
  }, [controlFoldOptions])
  return (
    <div className={cn(className, !fold ? 'mb-0' : 'mb-3')}>
      <div
        className="flex h-[26px] cursor-pointer select-none items-center gap-x-1 py-1"
        onClick={foldToggle}
      >
        <div className="flex grow items-center">
          <RiEqualizer2Line className="mr-1 h-4 w-4 text-text-secondary" />
          <span className="text-[13px] font-semibold uppercase leading-[16px] text-text-secondary">{t(`${I18N_PREFIX}.options`, { ns: 'datasetCreation' })}</span>
        </div>
        <ChevronRight className={cn(!fold && 'rotate-90', 'h-4 w-4 shrink-0 text-text-tertiary')} />
      </div>
      {!fold && (
        <div className="mb-4">
          {children}
        </div>
      )}

    </div>
  )
}
export default React.memo(OptionsWrap)
