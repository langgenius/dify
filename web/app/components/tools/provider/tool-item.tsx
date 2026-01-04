'use client'
import type { Collection, Tool } from '../types'
import * as React from 'react'
import { useState } from 'react'
import SettingBuiltInTool from '@/app/components/app/configuration/config/agent/agent-tools/setting-built-in-tool'
import { useLocale } from '@/context/i18n'
import { getLanguage } from '@/i18n-config/language'
import { cn } from '@/utils/classnames'

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
  const locale = useLocale()
  const language = getLanguage(locale)
  const [showDetail, setShowDetail] = useState(false)

  return (
    <>
      <div
        className={cn('bg-components-panel-item-bg cursor-pointer rounded-xl border-[0.5px] border-components-panel-border-subtle px-4 py-3 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover', disabled && '!cursor-not-allowed opacity-50')}
        onClick={() => !disabled && setShowDetail(true)}
      >
        <div className="system-md-semibold pb-0.5 text-text-secondary">{tool.label[language]}</div>
        <div className="system-xs-regular line-clamp-2 text-text-tertiary" title={tool.description[language]}>{tool.description[language]}</div>
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
