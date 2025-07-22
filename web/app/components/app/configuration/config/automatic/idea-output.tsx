'use client'
import { ArrowDownRoundFill } from '@/app/components/base/icons/src/vender/solid/general'
import { useBoolean } from 'ahooks'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'
import Textarea from '@/app/components/base/textarea'
import { useTranslation } from 'react-i18next'

const i18nPrefix = 'appDebug.generate'

type Props = {
  value: string
  onChange: (value: string) => void
}

const IdeaOutput: FC<Props> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()

  const [isFoldIdeaOutput, {
    toggle: toggleFoldIdeaOutput,
  }] = useBoolean(true)

  return (
    <div className='mt-4 text-[0px]'>
      <div
        className='mb-1.5 flex  cursor-pointer items-center text-sm font-medium leading-5 text-text-primary'
        onClick={toggleFoldIdeaOutput}
      >
        <div className='system-sm-semibold-uppercase mr-1 text-text-secondary'>{t(`${i18nPrefix}.idealOutput`)}</div>
        <div className='system-xs-regular text-text-tertiary'>({t(`${i18nPrefix}.optional`)})</div>
        <ArrowDownRoundFill className={cn('size text-text-quaternary', isFoldIdeaOutput && 'relative top-[1px] rotate-[-90deg]')} />
      </div>
      {!isFoldIdeaOutput && (
        <Textarea
          className="h-[80px]"
          placeholder={t(`${i18nPrefix}.idealOutputPlaceholder`)}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  )
}
export default React.memo(IdeaOutput)
