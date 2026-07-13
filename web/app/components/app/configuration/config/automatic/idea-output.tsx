'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownRoundFill } from '@/app/components/base/icons/src/vender/solid/general'

const i18nPrefix = 'generate'

type Props = Readonly<{
  value: string
  onChange: (value: string) => void
}>

const IdeaOutput: FC<Props> = ({ value, onChange }) => {
  const { t } = useTranslation()

  const [isFoldIdeaOutput, { toggle: toggleFoldIdeaOutput }] = useBoolean(true)

  return (
    <div className="mt-4 text-[0px]">
      <div
        className="mb-1.5 flex cursor-pointer items-center text-sm/5 font-medium text-text-primary"
        onClick={toggleFoldIdeaOutput}
      >
        <div className="mr-1 system-sm-semibold-uppercase text-text-secondary">
          {t(($) => $[`${i18nPrefix}.idealOutput`], { ns: 'appDebug' })}
        </div>
        <div className="system-xs-regular text-text-tertiary">
          ({t(($) => $[`${i18nPrefix}.optional`], { ns: 'appDebug' })})
        </div>
        <ArrowDownRoundFill
          className={cn(
            'size text-text-quaternary',
            isFoldIdeaOutput && 'relative top-px -rotate-90',
          )}
        />
      </div>
      {!isFoldIdeaOutput && (
        <Textarea
          aria-label={t(($) => $[`${i18nPrefix}.idealOutput`], { ns: 'appDebug' })}
          className="h-[80px]"
          placeholder={t(($) => $[`${i18nPrefix}.idealOutputPlaceholder`], { ns: 'appDebug' })}
          value={value}
          onValueChange={(value) => onChange(value)}
        />
      )}
    </div>
  )
}
export default React.memo(IdeaOutput)
