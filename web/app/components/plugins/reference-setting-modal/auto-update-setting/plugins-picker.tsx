'use client'
import type { FC } from 'react'
import React from 'react'
import NoPluginSelected from './no-plugin-selected'
import { AUTO_UPDATE_MODE } from './types'
import PluginsSelected from './plugins-selected'
import Button from '@/app/components/base/button'
import { RiAddLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import ToolPicker from './tool-picker'

const i18nPrefix = 'plugin.autoUpdate'

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
    <div className='mt-2 rounded-[10px] bg-background-section-burn p-2.5'>
      {hasSelected ? (
        <div className='flex justify-between text-text-tertiary'>
          <div className='system-xs-medium'>{t(`${i18nPrefix}.${isExcludeMode ? 'excludeUpdate' : 'partialUPdate'}`, { num: value.length })}</div>
          <div className='system-xs-medium cursor-pointer' onClick={handleClear}>{t(`${i18nPrefix}.operation.clearAll`)}</div>
        </div>
      ) : (
        <NoPluginSelected updateMode={updateMode} />
      )}

      {hasSelected && (
        <PluginsSelected
          className='mt-2'
          plugins={value}
        />
      )}

      <ToolPicker
        trigger={
          <Button className='mt-2 w-[412px]' size='small' variant='secondary-accent'>
            <RiAddLine className='size-3.5' />
            {t(`${i18nPrefix}.operation.select`)}
          </Button>
        }
        value={value}
        onChange={onChange}
        isShow={isShowToolPicker}
        onShowChange={setToolPicker}
      />
    </div>
  )
}
export default React.memo(PluginsPicker)
