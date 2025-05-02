'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import type { Dependency, InstallStatusResponse, Plugin, VersionInfo } from '../../../types'
import Button from '@/app/components/base/button'
import { RiLoader2Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import InstallMulti from './install-multi'
import { useInstallOrUpdate } from '@/service/use-plugins'
import useRefreshPluginList from '../../hooks/use-refresh-plugin-list'
const i18nPrefix = 'plugin.installModal'

type Props = {
  allPlugins: Dependency[]
  onStartToInstall?: () => void
  onInstalled: (plugins: Plugin[], installStatus: InstallStatusResponse[]) => void
  onCancel: () => void
  isFromMarketPlace?: boolean
  isHideButton?: boolean
}

const Install: FC<Props> = ({
  allPlugins,
  onStartToInstall,
  onInstalled,
  onCancel,
  isFromMarketPlace,
  isHideButton,
}) => {
  const { t } = useTranslation()
  const [selectedPlugins, setSelectedPlugins] = React.useState<Plugin[]>([])
  const [selectedIndexes, setSelectedIndexes] = React.useState<number[]>([])
  const selectedPluginsNum = selectedPlugins.length
  const { refreshPluginList } = useRefreshPluginList()
  const handleSelect = (plugin: Plugin, selectedIndex: number) => {
    const isSelected = !!selectedPlugins.find(p => p.plugin_id === plugin.plugin_id)
    let nextSelectedPlugins
    if (isSelected)
      nextSelectedPlugins = selectedPlugins.filter(p => p.plugin_id !== plugin.plugin_id)
    else
      nextSelectedPlugins = [...selectedPlugins, plugin]
    setSelectedPlugins(nextSelectedPlugins)
    const nextSelectedIndexes = isSelected ? selectedIndexes.filter(i => i !== selectedIndex) : [...selectedIndexes, selectedIndex]
    setSelectedIndexes(nextSelectedIndexes)
  }

  const [canInstall, setCanInstall] = React.useState(false)
  const [installedInfo, setInstalledInfo] = useState<Record<string, VersionInfo> | undefined>(undefined)

  const handleLoadedAllPlugin = useCallback((installedInfo: Record<string, VersionInfo> | undefined) => {
    setInstalledInfo(installedInfo)
    setCanInstall(true)
  }, [])

  // Install from marketplace and github
  const { mutate: installOrUpdate, isPending: isInstalling } = useInstallOrUpdate({
    onSuccess: (res: InstallStatusResponse[]) => {
      onInstalled(selectedPlugins, res.map((r, i) => {
        return ({
          ...r,
          isFromMarketPlace: allPlugins[selectedIndexes[i]].type === 'marketplace',
        })
      }))
      const hasInstallSuccess = res.some(r => r.success)
      if (hasInstallSuccess)
        refreshPluginList(undefined, true)
    },
  })
  const handleInstall = () => {
    onStartToInstall?.()
    installOrUpdate({
      payload: allPlugins.filter((_d, index) => selectedIndexes.includes(index)),
      plugin: selectedPlugins,
      installedInfo: installedInfo!,
    })
  }
  return (
    <>
      <div className='flex flex-col px-6 py-3 justify-center items-start gap-4 self-stretch'>
        <div className='text-text-secondary system-md-regular'>
          <p>{t(`${i18nPrefix}.${selectedPluginsNum > 1 ? 'readyToInstallPackages' : 'readyToInstallPackage'}`, { num: selectedPluginsNum })}</p>
        </div>
        <div className='w-full p-2 rounded-2xl bg-background-section-burn space-y-1'>
          <InstallMulti
            allPlugins={allPlugins}
            selectedPlugins={selectedPlugins}
            onSelect={handleSelect}
            onLoadedAllPlugin={handleLoadedAllPlugin}
            isFromMarketPlace={isFromMarketPlace}
          />
        </div>
      </div>
      {/* Action Buttons */}
      {!isHideButton && (
        <div className='flex p-6 pt-5 justify-end items-center gap-2 self-stretch'>
          {!canInstall && (
            <Button variant='secondary' className='min-w-[72px]' onClick={onCancel}>
              {t('common.operation.cancel')}
            </Button>
          )}
          <Button
            variant='primary'
            className='min-w-[72px] flex space-x-0.5'
            disabled={!canInstall || isInstalling || selectedPlugins.length === 0}
            onClick={handleInstall}
          >
            {isInstalling && <RiLoader2Line className='w-4 h-4 animate-spin-slow' />}
            <span>{t(`${i18nPrefix}.${isInstalling ? 'installing' : 'install'}`)}</span>
          </Button>
        </div>
      )}

    </>
  )
}
export default React.memo(Install)
