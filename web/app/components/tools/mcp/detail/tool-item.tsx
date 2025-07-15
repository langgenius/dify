'use client'
import React from 'react'
import { useContext } from 'use-context-selector'
import type { Tool } from '@/app/components/tools/types'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'

type Props = {
  tool: Tool
}

const MCPToolItem = ({
  tool,
}: Props) => {
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)

  return (
    <Tooltip
      key={tool.name}
      position='left'
      popupClassName='!p-0 !px-4 !py-3.5 !w-[360px] !border-[0.5px] !border-components-panel-border !rounded-xl !shadow-lg'
      popupContent={(
        <div>
          <div className='title-xs-semi-bold mb-1 text-text-primary'>{tool.label[language]}</div>
          <div className='body-xs-regular text-text-secondary'>{tool.description[language]}</div>
        </div>
      )}
    >
      <div
        className={cn('bg-components-panel-item-bg cursor-pointer rounded-xl border-[0.5px] border-components-panel-border-subtle px-4 py-3 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover')}
      >
        <div className='system-md-semibold pb-0.5 text-text-secondary'>{tool.label[language]}</div>
        <div className='system-xs-regular line-clamp-2 text-text-tertiary' title={tool.description[language]}>{tool.description[language]}</div>
      </div>
    </Tooltip>
  )
}
export default MCPToolItem
