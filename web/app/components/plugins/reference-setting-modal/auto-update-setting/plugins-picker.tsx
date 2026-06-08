'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { RiAddLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import NoPluginSelected from './no-plugin-selected'
import PluginsSelected from './plugins-selected'
import ToolPicker from './tool-picker'
import { AUTO_UPDATE_MODE } from './types'

const i18nPrefix = 'autoUpdate'

type Props = {
  updateMode: AUTO_UPDATE_MODE
  value: string[] // plugin ids
  onChange: (value: string[]) => void
}

const PluginsPicker: FC<Props> = ({
  updateMode,
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const hasSelected = value.length > 0
  const isExcludeMode = updateMode === AUTO_UPDATE_MODE.exclude
  const handleClear = () => {
    onChange([])
  }

  const [isShowToolPicker, {
    set: setToolPicker,
  }] = useBoolean(false)
  return (
    <div className="mt-2 rounded-[10px] bg-background-section-burn p-2.5">
      {hasSelected
        ? (
            <div className="flex justify-between text-text-tertiary">
              <div className="system-xs-medium">{t(`${i18nPrefix}.${isExcludeMode ? 'excludeUpdate' : 'partialUPdate'}`, { ns: 'plugin', num: value.length })}</div>
              <button
                type="button"
                className="cursor-pointer border-none bg-transparent p-0 text-left system-xs-medium text-text-tertiary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                onClick={handleClear}
              >
                {t(`${i18nPrefix}.operation.clearAll`, { ns: 'plugin' })}
              </button>
            </div>
          )
        : (
            <NoPluginSelected updateMode={updateMode} />
          )}

      {hasSelected && (
        <PluginsSelected
          className="mt-2"
          plugins={value}
        />
      )}

      <ToolPicker
        trigger={(
          <Button className="mt-2 w-full" size="small" variant="secondary-accent">
            <RiAddLine className="size-3.5" />
            {t(`${i18nPrefix}.operation.select`, { ns: 'plugin' })}
          </Button>
        )}
        value={value}
        onChange={onChange}
        isShow={isShowToolPicker}
        onShowChange={setToolPicker}
      />
    </div>
  )
}
export default React.memo(PluginsPicker)
