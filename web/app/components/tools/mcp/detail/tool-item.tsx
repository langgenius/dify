'use client'
import type { Tool } from '@/app/components/tools/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { useLocale } from '@/context/i18n'
import { getLanguage } from '@/i18n-config/language'
import { cn } from '@/utils/classnames'

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
        <div className="mb-1 text-text-primary title-xs-semi-bold">
          {t('mcp.toolItem.parameters', { ns: 'tools' })}
          :
        </div>
        <ul className="space-y-1">
          {parameters.map((parameter) => {
            const descriptionContent = parameter.human_description[language] || t('mcp.toolItem.noDescription', { ns: 'tools' })
            return (
              <li key={parameter.name} className="pl-2">
                <span className="font-bold text-text-secondary system-xs-regular">{parameter.name}</span>
                <span className="mr-1 text-text-tertiary system-xs-regular">
                  (
                  {parameter.type}
                  ):
                </span>
                <span className="text-text-tertiary system-xs-regular">{descriptionContent}</span>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <Tooltip
      key={tool.name}
      position="left"
      popupClassName="!p-0 !px-4 !py-3.5 !w-[360px] !border-[0.5px] !border-components-panel-border !rounded-xl !shadow-lg"
      popupContent={(
        <div>
          <div className="mb-1 text-text-primary title-xs-semi-bold">{tool.label[language]}</div>
          <div className="text-text-secondary body-xs-regular">{tool.description[language]}</div>
          {renderParameters()}
        </div>
      )}
    >
      <div
        className={cn('bg-components-panel-item-bg cursor-pointer rounded-xl border-[0.5px] border-components-panel-border-subtle px-4 py-3 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover')}
      >
        <div className="pb-0.5 text-text-secondary system-md-semibold">{tool.label[language]}</div>
        <div className="line-clamp-2 text-text-tertiary system-xs-regular" title={tool.description[language]}>{tool.description[language]}</div>
      </div>
    </Tooltip>
  )
}
export default MCPToolItem
