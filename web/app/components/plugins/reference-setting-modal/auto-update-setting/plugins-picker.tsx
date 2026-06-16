'use client'
import type { FC } from 'react'
import type { PluginCategoryEnum } from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import { RiAddLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useInstalledPluginList } from '@/service/use-plugins'
import NoPluginSelected from './no-plugin-selected'
import PluginsSelected from './plugins-selected'
import ToolPicker from './tool-picker'
import { AUTO_UPDATE_MODE } from './types'

const i18nPrefix = 'autoUpdate'

type Props = Readonly<{
  updateMode: AUTO_UPDATE_MODE
  value: string[] // plugin ids
  onChange: (value: string[]) => void
  integrationCategory?: PluginCategoryEnum
}>

const PluginsPicker: FC<Props> = ({
  updateMode,
  value,
  onChange,
  integrationCategory,
}) => {
  const { t } = useTranslation()
  const { data } = useInstalledPluginList()
  const pluginCategoryById = useMemo(() => {
    return new Map(data?.plugins.map(plugin => [plugin.plugin_id, plugin.declaration.category]))
  }, [data?.plugins])
  const isCurrentCategoryPlugin = useCallback((pluginId: string) => {
    if (!integrationCategory)
      return true

    return pluginCategoryById.get(pluginId) === integrationCategory
  }, [integrationCategory, pluginCategoryById])
  const visiblePlugins = useMemo(() => {
    return value.filter(isCurrentCategoryPlugin)
  }, [isCurrentCategoryPlugin, value])
  const hiddenPlugins = useMemo(() => {
    if (!integrationCategory)
      return []

    return value.filter(plugin => !isCurrentCategoryPlugin(plugin))
  }, [integrationCategory, isCurrentCategoryPlugin, value])
  const hasSelected = visiblePlugins.length > 0
  const isExcludeMode = updateMode === AUTO_UPDATE_MODE.exclude
  const handleClear = () => {
    onChange(hiddenPlugins)
  }
  const handleVisiblePluginsChange = useCallback((newVisiblePlugins: string[]) => {
    onChange(integrationCategory
      ? [...hiddenPlugins, ...newVisiblePlugins.filter(plugin => !hiddenPlugins.includes(plugin))]
      : newVisiblePlugins)
  }, [hiddenPlugins, integrationCategory, onChange])

  const [isShowToolPicker, {
    set: setToolPicker,
  }] = useBoolean(false)
  return (
    <div className="mt-2 flex w-full flex-col gap-2 rounded-[10px] bg-background-section-burn p-2.5">
      {hasSelected
        ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1 system-xs-medium text-text-tertiary">
                {t(`${i18nPrefix}.${isExcludeMode ? 'excludeUpdate' : 'partialUPdate'}`, {
                  ns: 'plugin',
                  count: visiblePlugins.length,
                  num: visiblePlugins.length,
                })}
              </div>
              <button
                type="button"
                className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-left system-xs-medium text-text-tertiary hover:text-text-secondary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
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
          className="h-6 w-full gap-1"
          plugins={visiblePlugins}
        />
      )}

      <ToolPicker
        trigger={(
          <Button className="h-6 w-full gap-1" size="small" variant="secondary-accent">
            <RiAddLine className="size-3.5" />
            {t(`${i18nPrefix}.operation.select`, { ns: 'plugin' })}
          </Button>
        )}
        value={visiblePlugins}
        onChange={handleVisiblePluginsChange}
        isShow={isShowToolPicker}
        onShowChange={setToolPicker}
        integrationCategory={integrationCategory}
      />
    </div>
  )
}
export default React.memo(PluginsPicker)
