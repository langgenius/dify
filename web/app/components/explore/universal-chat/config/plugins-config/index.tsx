'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Item from './item'
import FeaturePanel from '@/app/components/app/configuration/base/feature-panel'
import { Google, WebReader, Wikipedia } from '@/app/components/base/icons/src/public/plugins'
export type IPluginsProps = {
  readonly?: boolean
  config: Record<string, boolean>
  onChange?: (key: string, value: boolean) => void
}

const plugins = [
  { key: 'google_search', icon: <Google /> },
  { key: 'web_reader', icon: <WebReader /> },
  { key: 'wikipedia', icon: <Wikipedia /> },
]
const Plugins: FC<IPluginsProps> = ({
  readonly,
  config,
  onChange,
}) => {
  const { t } = useTranslation()

  const itemConfigs = plugins.map((plugin) => {
    const res: Record<string, any> = { ...plugin }
    const { key } = plugin
    res.name = t(`explore.universalChat.plugins.${key}.name`)
    if (key === 'web_reader')
      res.description = t(`explore.universalChat.plugins.${key}.description`)

    if (key === 'google_search' && !readonly) {
      res.more = (
        <div className='border-t border-[#FEF0C7] flex items-center h-[34px] pl-2 bg-[#FFFAEB] text-gray-700 text-xs '>
          <span className='whitespace-pre'>{t('explore.universalChat.plugins.google_search.more.left')}</span>
          <span className='cursor-pointer text-[#155EEF]'>{t('explore.universalChat.plugins.google_search.more.link')}</span>
          <span className='whitespace-pre'>{t('explore.universalChat.plugins.google_search.more.right')}</span>
        </div>
      )
    }
    return res
  })

  const enabledPluginNum = Object.values(config).filter(v => v).length

  return (
    <FeaturePanel
      className='mt-3'
      title={
        <div className='flex space-x-1'>
          <div>{t('explore.universalChat.plugins.name')}</div>
          <div className='text-[13px] font-normal text-gray-500'>({enabledPluginNum}/{plugins.length})</div>
        </div>}
      hasHeaderBottomBorder={false}
    >
      <div className='space-y-2'>
        {itemConfigs.map(item => (
          <Item
            key={item.key}
            icon={item.icon}
            name={item.name}
            description={item.description}
            more={item.more}
            enabled={config[item.key]}
            onChange={enabled => onChange?.(item.key, enabled)}
            readonly={readonly}
          />
        ))}
      </div>
    </FeaturePanel>
  )
}
export default React.memo(Plugins)
