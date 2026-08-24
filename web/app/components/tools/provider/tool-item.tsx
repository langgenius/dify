'use client'
import type { Collection, Tool } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useState } from 'react'
import SettingBuiltInTool from '@/app/components/app/configuration/config/agent/agent-tools/setting-built-in-tool'
import { useLocale } from '@/context/i18n'
import { getLanguage } from '@/i18n-config/language'

type Props = Readonly<{
  disabled?: boolean
  collection: Collection
  tool: Tool
  isBuiltIn: boolean
  isModel: boolean
}>

const ToolItem = ({ disabled, collection, tool, isBuiltIn, isModel }: Props) => {
  const locale = useLocale()
  const language = getLanguage(locale)
  const [showDetail, setShowDetail] = useState(false)

  return (
    <>
      <button
        type="button"
        aria-label={tool.label[language]}
        disabled={disabled}
        className={cn(
          'bg-components-panel-item-bg w-full cursor-pointer appearance-none rounded-xl border-[0.5px] border-components-panel-border-subtle px-4 py-3 text-start shadow-xs outline-hidden hover:bg-components-panel-on-panel-item-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          disabled && 'cursor-not-allowed! opacity-50',
        )}
        onClick={() => setShowDetail(true)}
      >
        <span className="block pb-0.5 system-md-semibold text-text-secondary">
          {tool.label[language]}
        </span>
        <span
          className="line-clamp-2 block system-xs-regular text-text-tertiary"
          title={tool.description[language]}
        >
          {tool.description[language]}
        </span>
      </button>
      {showDetail && (
        <SettingBuiltInTool
          showBackButton
          collection={collection}
          toolName={tool.name}
          readonly
          showReadOnlySettingDetails
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
