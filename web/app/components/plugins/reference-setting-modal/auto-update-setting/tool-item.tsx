'use client'
import type { FC } from 'react'
import type { PluginDetail } from '@/app/components/plugins/types'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import * as React from 'react'
import Icon from '@/app/components/plugins/card/base/card-icon'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { useGetLanguage } from '@/context/i18n'
import { renderI18nObject } from '@/i18n-config'

type Props = Readonly<{
  payload: PluginDetail
  isChecked?: boolean
  onCheckChange: () => void
}>

const ToolItem: FC<Props> = ({ payload, isChecked, onCheckChange }) => {
  const language = useGetLanguage()

  const { plugin_id, declaration } = payload
  const { label, author: org } = declaration
  return (
    <div className="flex w-full items-center gap-1 rounded-lg py-1 pr-2 pl-3 select-none hover:bg-state-base-hover">
      <div className="flex min-w-0 grow items-center gap-2 pr-2">
        <Icon size="tiny" src={`${MARKETPLACE_API_PREFIX}/plugins/${plugin_id}/icon`} />
        <div className="min-w-0 truncate system-sm-medium text-text-secondary">
          {renderI18nObject(label, language)}
        </div>
        <div className="min-w-0 truncate system-xs-regular text-text-quaternary">{org}</div>
      </div>
      <Checkbox
        checked={isChecked}
        onCheckedChange={() => onCheckChange()}
        className="shrink-0"
        aria-label={renderI18nObject(label, language)}
      />
    </div>
  )
}
export default React.memo(ToolItem)
