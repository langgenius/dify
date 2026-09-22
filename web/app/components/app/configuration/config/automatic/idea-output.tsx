'use client'
import type { FC } from 'react'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { Textarea } from '@langgenius/dify-ui/textarea'
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

  return (
    <Collapsible className="mt-4 text-[0px]">
      <CollapsibleTrigger className="group mb-1.5 flex cursor-pointer flex-wrap items-center text-left text-sm/5 font-medium text-text-primary focus-visible:ring-2 focus-visible:ring-components-input-border-active focus-visible:outline-hidden">
        <span className="mr-1 system-sm-semibold-uppercase text-text-secondary">
          {t(($) => $[`${i18nPrefix}.idealOutput`], { ns: 'appDebug' })}
        </span>
        <span className="system-xs-regular text-text-tertiary">
          ({t(($) => $[`${i18nPrefix}.optional`], { ns: 'appDebug' })})
        </span>
        <ArrowDownRoundFill
          aria-hidden
          className="size relative top-px -rotate-90 text-text-quaternary group-data-panel-open:top-0 group-data-panel-open:rotate-0"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <Textarea
          aria-label={t(($) => $[`${i18nPrefix}.idealOutput`], { ns: 'appDebug' })}
          className="h-20"
          placeholder={t(($) => $[`${i18nPrefix}.idealOutputPlaceholder`], { ns: 'appDebug' })}
          value={value}
          onValueChange={(value) => onChange(value)}
        />
      </CollapsiblePanel>
    </Collapsible>
  )
}
export default React.memo(IdeaOutput)
