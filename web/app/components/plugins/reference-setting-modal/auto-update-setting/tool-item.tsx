'use client'
import type { FC } from 'react'
import type { PluginDetail } from '@/app/components/plugins/types'
import * as React from 'react'
import Checkbox from '@/app/components/base/checkbox'
import Icon from '@/app/components/plugins/card/base/card-icon'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { useGetLanguage } from '@/context/i18n'
import { renderI18nObject } from '@/i18n-config'

type Props = {
  payload: PluginDetail
  isChecked?: boolean
  onCheckChange: () => void
}

const ToolItem: FC<Props> = ({
  payload,
  isChecked,
  onCheckChange,
}) => {
  const language = useGetLanguage()

  const { plugin_id, declaration } = payload
  const { label, author: org } = declaration
  return (
    <div className="p-1">
      <div
        className="flex w-full select-none items-center rounded-lg pr-2 hover:bg-state-base-hover"
      >
        <div className="flex h-8 grow items-center space-x-2 pl-3 pr-2">
          <Icon size="tiny" src={`${MARKETPLACE_API_PREFIX}/plugins/${plugin_id}/icon`} />
          <div className="system-sm-medium max-w-[150px] shrink-0 truncate text-text-primary">{renderI18nObject(label, language)}</div>
          <div className="system-xs-regular max-w-[150px] shrink-0  truncate text-text-quaternary">{org}</div>
        </div>
        <Checkbox
          checked={isChecked}
          onCheck={onCheckChange}
          className="shrink-0"
        />
      </div>
    </div>
  )
}
export default React.memo(ToolItem)
