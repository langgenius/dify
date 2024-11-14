'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { Dependency, Plugin } from '../../../types'
import Button from '@/app/components/base/button'
import { RiLoader2Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import InstallByDSLList from './install-by-dsl-list'

const i18nPrefix = 'plugin.installModal'

type Props = {
  fromDSLPayload: Dependency[]
  onCancel: () => void
}

const Install: FC<Props> = ({
  fromDSLPayload,
  onCancel,
}) => {
  const { t } = useTranslation()
  const [selectedPlugins, setSelectedPlugins] = React.useState<Plugin[]>([])
  const selectedPluginsNum = selectedPlugins.length

  const handleSelect = (plugin: Plugin) => {
    return () => {
      const isSelected = !!selectedPlugins.find(p => p.plugin_id === plugin.plugin_id)
      let nextSelectedPlugins
      if (isSelected)
        nextSelectedPlugins = selectedPlugins.filter(p => p.plugin_id !== plugin.plugin_id)
      else
        nextSelectedPlugins = [...selectedPlugins, plugin]
      setSelectedPlugins(nextSelectedPlugins)
    }
  }
  const [canInstall, setCanInstall] = React.useState(false)
  const handleLoadedAllPlugin = useCallback(() => {
    setCanInstall(true)
  }, [])
  const handleInstall = () => {

  }
  return (
    <>
      <div className='flex flex-col px-6 py-3 justify-center items-start gap-4 self-stretch'>
        <div className='text-text-secondary system-md-regular'>
          <p>{t(`${i18nPrefix}.${selectedPluginsNum > 1 ? 'readyToInstallPackages' : 'readyToInstallPackage'}`, { num: selectedPluginsNum })}</p>
        </div>
        <div className='w-full p-2 rounded-2xl bg-background-section-burn space-y-1'>
          <InstallByDSLList
            fromDSLPayload={fromDSLPayload}
            selectedPlugins={selectedPlugins}
            handleSelect={handleSelect}
            onLoadedAllPlugin={handleLoadedAllPlugin}
          />
        </div>
      </div>
      {/* Action Buttons */}
      <div className='flex p-6 pt-5 justify-end items-center gap-2 self-stretch'>
        {!canInstall && (
          <Button variant='secondary' className='min-w-[72px]' onClick={onCancel}>
            {t('common.operation.cancel')}
          </Button>
        )}
        <Button
          variant='primary'
          className='min-w-[72px] flex space-x-0.5'
          disabled={canInstall || selectedPlugins.length === 0}
          onClick={handleInstall}
        >
          {canInstall && <RiLoader2Line className='w-4 h-4 animate-spin-slow' />}
          <span>{t(`${i18nPrefix}.${canInstall ? 'installing' : 'install'}`)}</span>
        </Button>
      </div>
    </>
  )
}
export default React.memo(Install)
