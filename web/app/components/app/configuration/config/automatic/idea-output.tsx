'use client'
import type { FC } from 'react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownRoundFill } from '@/app/components/base/icons/src/vender/solid/general'
import Textarea from '@/app/components/base/textarea'
import { cn } from '@/utils/classnames'

const i18nPrefix = 'generate'

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
    <div className="mt-4 text-[0px]">
      <div
        className="mb-1.5 flex  cursor-pointer items-center text-sm font-medium leading-5 text-text-primary"
        onClick={toggleFoldIdeaOutput}
      >
        <div className="system-sm-semibold-uppercase mr-1 text-text-secondary">{t(`${i18nPrefix}.idealOutput`, { ns: 'appDebug' })}</div>
        <div className="system-xs-regular text-text-tertiary">
          (
          {t(`${i18nPrefix}.optional`, { ns: 'appDebug' })}
          )
        </div>
        <ArrowDownRoundFill className={cn('size text-text-quaternary', isFoldIdeaOutput && 'relative top-[1px] rotate-[-90deg]')} />
      </div>
      {!isFoldIdeaOutput && (
        <Textarea
          className="h-[80px]"
          placeholder={t(`${i18nPrefix}.idealOutputPlaceholder`, { ns: 'appDebug' })}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  )
}
export default React.memo(IdeaOutput)
