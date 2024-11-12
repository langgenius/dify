'use client'
import type { FC } from 'react'
import React from 'react'
import type { PluginDeclaration } from '../../../types'
import Card from '../../../card'
import Button from '@/app/components/base/button'
import { RiLoader2Line } from '@remixicon/react'
import Badge, { BadgeState } from '@/app/components/base/badge/index'
import { pluginManifestToCardPluginProps } from '../../utils'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'

const i18nPrefix = 'plugin.installModal'

type Props = {
  plugins: PluginDeclaration[],
  onCancel: () => void
}

const Install: FC<Props> = ({
  plugins,
  onCancel,
}) => {
  const { t } = useTranslation()
  const [selectedPlugins, setSelectedPlugins] = React.useState<PluginDeclaration[]>([])
  const selectedPluginsNum = selectedPlugins.length
  const handleSelect = (plugin: PluginDeclaration) => {
    return () => {
      const isSelected = !!selectedPlugins.find(p => p.plugin_unique_identifier === plugin.plugin_unique_identifier)
      let nextSelectedPlugins
      if (isSelected)
        nextSelectedPlugins = selectedPlugins.filter(p => p.plugin_unique_identifier !== plugin.plugin_unique_identifier)
      else
        nextSelectedPlugins = [...selectedPlugins, plugin]
      setSelectedPlugins(nextSelectedPlugins)
    }
  }
  const [isInstalling, setIsInstalling] = React.useState(false)
  const handleInstall = () => {

  }
  return (
    <>
      <div className='flex flex-col px-6 py-3 justify-center items-start gap-4 self-stretch'>
        <div className='text-text-secondary system-md-regular'>
          <p>{t(`${i18nPrefix}.${selectedPluginsNum > 1 ? 'readyToInstallPackages' : 'readyToInstallPackage'}`, { num: selectedPluginsNum })}</p>
        </div>
        <div className='w-full p-2 rounded-2xl bg-background-section-burn space-y-1'>
          {plugins.map(plugin => (
            <div className='flex items-center space-x-2' key={plugin.plugin_unique_identifier}>
              <Checkbox
                className='shrink-0'
                checked={!!selectedPlugins.find(p => p.plugin_unique_identifier === plugin.plugin_unique_identifier)}
                onCheck={handleSelect(plugin)}
              />
              <Card
                className='grow'
                payload={pluginManifestToCardPluginProps(plugin)}
                titleLeft={<Badge className='mx-1' size="s" state={BadgeState.Default}>{plugin.version}</Badge>}
              />
            </div>
          ))}
        </div>
      </div>
      {/* Action Buttons */}
      <div className='flex p-6 pt-5 justify-end items-center gap-2 self-stretch'>
        {!isInstalling && (
          <Button variant='secondary' className='min-w-[72px]' onClick={onCancel}>
            {t('common.operation.cancel')}
          </Button>
        )}
        <Button
          variant='primary'
          className='min-w-[72px] flex space-x-0.5'
          disabled={isInstalling || selectedPlugins.length === 0}
          onClick={handleInstall}
        >
          {isInstalling && <RiLoader2Line className='w-4 h-4 animate-spin-slow' />}
          <span>{t(`${i18nPrefix}.${isInstalling ? 'installing' : 'install'}`)}</span>
        </Button>
      </div>
    </>
  )
}
export default React.memo(Install)
