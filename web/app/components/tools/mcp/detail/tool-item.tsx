'use client'
import type { Tool } from '@/app/components/tools/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/context/i18n'
import { getLanguage } from '@/i18n-config/language'

type Props = {
  tool: Tool
}

const MCPToolItem = ({
  tool,
}: Props) => {
  const locale = useLocale()
  const language = getLanguage(locale)
  const { t } = useTranslation()

  const renderParameters = () => {
    const parameters = tool.parameters

    if (parameters.length === 0)
      return null

    return (
      <div className="mt-2">
        <div className="mb-1 title-xs-semi-bold text-text-primary">
          {t('mcp.toolItem.parameters', { ns: 'tools' })}
          :
        </div>
        <ul className="space-y-1">
          {parameters.map((parameter) => {
            const descriptionContent = parameter.human_description[language] || t('mcp.toolItem.noDescription', { ns: 'tools' })
            return (
              <li key={parameter.name} className="pl-2">
                <span className="system-xs-regular font-bold text-text-secondary">{parameter.name}</span>
                <span className="mr-1 system-xs-regular text-text-tertiary">
                  (
                  {parameter.type}
                  ):
                </span>
                <span className="system-xs-regular text-text-tertiary">{descriptionContent}</span>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <Popover key={tool.name}>
      <PopoverTrigger
        openOnHover
        aria-label={tool.label[language]}
        render={(
          <button
            type="button"
            className={cn('bg-components-panel-item-bg w-full cursor-pointer rounded-xl border-[0.5px] border-components-panel-border-subtle px-4 py-3 text-left shadow-xs outline-hidden hover:bg-components-panel-on-panel-item-bg-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover')}
          >
            <div className="pb-0.5 system-md-semibold text-text-secondary">{tool.label[language]}</div>
            <div className="line-clamp-2 system-xs-regular text-text-tertiary" title={tool.description[language]}>{tool.description[language]}</div>
          </button>
        )}
      />
      <PopoverContent
        placement="left"
        popupClassName="w-[360px]! rounded-xl! border-[0.5px]! border-components-panel-border! px-4! py-3.5! shadow-lg!"
      >
        <div>
          <div className="mb-1 title-xs-semi-bold text-text-primary">{tool.label[language]}</div>
          <div className="body-xs-regular text-text-secondary">{tool.description[language]}</div>
          {renderParameters()}
        </div>
      </PopoverContent>
    </Popover>
  )
}
export default MCPToolItem
