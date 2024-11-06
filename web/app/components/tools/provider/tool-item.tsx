'use client'
import React, { useState } from 'react'
import { useContext } from 'use-context-selector'
import type { Collection, Tool } from '../types'
import cn from '@/utils/classnames'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
import SettingBuiltInTool from '@/app/components/app/configuration/config/agent/agent-tools/setting-built-in-tool'

type Props = {
  disabled?: boolean
  collection: Collection
  tool: Tool
  isBuiltIn: boolean
  isModel: boolean
}

const ToolItem = ({
  disabled,
  collection,
  tool,
  isBuiltIn,
  isModel,
}: Props) => {
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)
  const [showDetail, setShowDetail] = useState(false)

  return (
    <>
      <div
        className={cn('mb-2 px-4 py-3 bg-components-panel-item-bg rounded-xl border-[0.5px] border-components-panel-border-subtle shadow-xs cursor-pointer hover:bg-components-panel-on-panel-item-bg-hover', disabled && 'opacity-50 !cursor-not-allowed')}
        onClick={() => !disabled && setShowDetail(true)}
      >
        <div className='pb-0.5 text-text-secondary system-md-semibold'>{tool.label[language]}</div>
        <div className='text-text-tertiary system-xs-regular line-clamp-2' title={tool.description[language]}>{tool.description[language]}</div>
      </div>
      {showDetail && (
        <SettingBuiltInTool
          showBackButton
          collection={collection}
          toolName={tool.name}
          readonly
          onHide={() => {
            setShowDetail(false)
          }}
          isBuiltIn={isBuiltIn}
          isModel={isModel}
        />
      )}
    </>
  )
}
export default ToolItem
