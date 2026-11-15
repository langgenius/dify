'use client'
import type { FC } from 'react'
import type { Props } from './var-picker'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import VarPicker from './var-picker'

const ContextVar: FC<Props> = (props) => {
  const titleId = React.useId()

  const { t } = useTranslation(['appDebug'])
  const { value, options } = props
  const currItem = options.find((item) => item.value === value)
  const notSetVar = !currItem
  return (
    <div
      className={cn(
        notSetVar
          ? 'rounded-br-xl rounded-bl-xl border-[#FEF0C7] bg-[#FEF0C7]'
          : 'border-components-panel-border-subtle',
        'flex h-12 items-center justify-between border-t px-3',
      )}
    >
      <div className="flex shrink-0 items-center space-x-1">
        <div className="p-1">
          <span
            aria-hidden
            className="i-custom-vender-line-development-brackets-x size-4 text-text-accent"
          />
        </div>
        <div id={titleId} className="mr-1 text-sm font-medium text-text-secondary">
          {t(($) => $['feature.dataSet.queryVariable.title'], { ns: 'appDebug' })}
        </div>
        <Infotip>
          <InfotipTrigger aria-labelledby={titleId} />
          <InfotipContent aria-labelledby={titleId} className="w-45">
            {t(($) => $['feature.dataSet.queryVariable.tip'], { ns: 'appDebug' })}
          </InfotipContent>
        </Infotip>
      </div>

      <VarPicker {...props} />
    </div>
  )
}

export default React.memo(ContextVar)
