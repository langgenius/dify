'use client'
import type { FC } from 'react'
import { useRef } from 'react'
import React, { useCallback, useState } from 'react'
import {
  type Dependency,
  type InstallStatus,
  type InstallStatusResponse,
  type Plugin,
  TaskStatus,
  type VersionInfo,
} from '../../../types'
import Button from '@/app/components/base/button'
import { RiLoader2Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import type { ExposeRefs } from './install-multi'
import InstallMulti from './install-multi'
import { useInstallOrUpdate, usePluginTaskList } from '@/service/use-plugins'
import useRefreshPluginList from '../../hooks/use-refresh-plugin-list'
import { useCanInstallPluginFromMarketplace } from '@/app/components/plugins/plugin-page/use-reference-setting'
import { useMittContextSelector } from '@/context/mitt-context'
import Checkbox from '@/app/components/base/checkbox'
import checkTaskStatus from '../../base/check-task-status'
const i18nPrefix = 'plugin.installModal'

type Props = {
  allPlugins: Dependency[]
  onStartToInstall?: () => void
  onInstalled: (plugins: Plugin[], installStatus: InstallStatus[]) => void
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
  const emit = useMittContextSelector(s => s.emit)
  const [selectedPlugins, setSelectedPlugins] = React.useState<Plugin[]>([])
  const [selectedIndexes, setSelectedIndexes] = React.useState<number[]>([])
  const selectedPluginsNum = selectedPlugins.length
  const installMultiRef = useRef<ExposeRefs>(null)
  const { refreshPluginList } = useRefreshPluginList()
  const [isSelectAll, setIsSelectAll] = useState(false)
  const handleClickSelectAll = useCallback(() => {
    if (isSelectAll)
      installMultiRef.current?.deSelectAllPlugins()
    else
      installMultiRef.current?.selectAllPlugins()
  }, [isSelectAll])
  const [canInstall, setCanInstall] = React.useState(false)
  const [installedInfo, setInstalledInfo] = useState<Record<string, VersionInfo> | undefined>(undefined)

  const handleLoadedAllPlugin = useCallback((installedInfo: Record<string, VersionInfo> | undefined) => {
    handleClickSelectAll()
    setInstalledInfo(installedInfo)
    setCanInstall(true)
  }, [])

  const {
    check,
    stop,
  } = checkTaskStatus()

  const handleCancel = useCallback(() => {
    stop()
    onCancel()
  }, [onCancel, stop])

  const { handleRefetch } = usePluginTaskList()

  // Install from marketplace and github
  const { mutate: installOrUpdate, isPending: isInstalling } = useInstallOrUpdate({
    onSuccess: async (res: InstallStatusResponse[]) => {
      const isAllSettled = res.every(r => r.status === TaskStatus.success || r.status === TaskStatus.failed)
      // if all settled, return the install status
      if (isAllSettled) {
        onInstalled(selectedPlugins, res.map((r, i) => {
          return ({
            success: r.status === TaskStatus.success,
            isFromMarketPlace: allPlugins[selectedIndexes[i]].type === 'marketplace',
          })
        }))
        const hasInstallSuccess = res.some(r => r.status === TaskStatus.success)
        if (hasInstallSuccess) {
          refreshPluginList(undefined, true)
          emit('plugin:install:success', selectedPlugins.map((p) => {
            return `${p.plugin_id}/${p.name}`
          }))
        }
        return
      }
      // if not all settled, keep checking the status of the plugins
      handleRefetch()
      const installStatus = await Promise.all(res.map(async (item, index) => {
        if (item.status !== TaskStatus.running) {
          return {
            success: item.status === TaskStatus.success,
            isFromMarketPlace: allPlugins[selectedIndexes[index]].type === 'marketplace',
          }
        }
        const { status } = await check({
          taskId: item.taskId,
          pluginUniqueIdentifier: item.uniqueIdentifier,
        })
        return {
          success: status === TaskStatus.success,
          isFromMarketPlace: allPlugins[selectedIndexes[index]].type === 'marketplace',
        }
      }))
      onInstalled(selectedPlugins, installStatus)
      const hasInstallSuccess = installStatus.some(r => r.success)
      if (hasInstallSuccess) {
        emit('plugin:install:success', selectedPlugins.map((p) => {
          return `${p.plugin_id}/${p.name}`
        }))
      }
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
  const [isIndeterminate, setIsIndeterminate] = useState(false)
  const handleSelectAll = useCallback((plugins: Plugin[], selectedIndexes: number[]) => {
    setSelectedPlugins(plugins)
    setSelectedIndexes(selectedIndexes)
    setIsSelectAll(true)
    setIsIndeterminate(false)
  }, [])
  const handleDeSelectAll = useCallback(() => {
    setSelectedPlugins([])
    setSelectedIndexes([])
    setIsSelectAll(false)
    setIsIndeterminate(false)
  }, [])

  const handleSelect = useCallback((plugin: Plugin, selectedIndex: number, allPluginsLength: number) => {
    const isSelected = !!selectedPlugins.find(p => p.plugin_id === plugin.plugin_id)
    let nextSelectedPlugins
    if (isSelected)
      nextSelectedPlugins = selectedPlugins.filter(p => p.plugin_id !== plugin.plugin_id)
    else
      nextSelectedPlugins = [...selectedPlugins, plugin]
    setSelectedPlugins(nextSelectedPlugins)
    const nextSelectedIndexes = isSelected ? selectedIndexes.filter(i => i !== selectedIndex) : [...selectedIndexes, selectedIndex]
    setSelectedIndexes(nextSelectedIndexes)
    if (nextSelectedPlugins.length === 0) {
      setIsSelectAll(false)
      setIsIndeterminate(false)
    }
    else if (nextSelectedPlugins.length === allPluginsLength) {
      setIsSelectAll(true)
      setIsIndeterminate(false)
    }
    else {
      setIsIndeterminate(true)
      setIsSelectAll(false)
    }
  }, [selectedPlugins, selectedIndexes])

  const { canInstallPluginFromMarketplace } = useCanInstallPluginFromMarketplace()
  return (
    <>
      <div className='flex flex-col items-start justify-center gap-4 self-stretch px-6 py-3'>
        <div className='system-md-regular text-text-secondary'>
          <p>{t(`${i18nPrefix}.${selectedPluginsNum > 1 ? 'readyToInstallPackages' : 'readyToInstallPackage'}`, { num: selectedPluginsNum })}</p>
        </div>
        <div className='w-full space-y-1 rounded-2xl bg-background-section-burn p-2'>
          <InstallMulti
            ref={installMultiRef}
            allPlugins={allPlugins}
            selectedPlugins={selectedPlugins}
            onSelect={handleSelect}
            onSelectAll={handleSelectAll}
            onDeSelectAll={handleDeSelectAll}
            onLoadedAllPlugin={handleLoadedAllPlugin}
            isFromMarketPlace={isFromMarketPlace}
          />
        </div>
      </div>
      {/* Action Buttons */}
      {!isHideButton && (
        <div className='flex items-center justify-between gap-2 self-stretch p-6 pt-5'>
          <div className='px-2'>
            {canInstall && <div className='flex items-center gap-x-2' onClick={handleClickSelectAll}>
              <Checkbox checked={isSelectAll} indeterminate={isIndeterminate} />
              <p className='system-sm-medium cursor-pointer text-text-secondary'>{isSelectAll ? t('common.operation.deSelectAll') : t('common.operation.selectAll')}</p>
            </div>}
          </div>
          <div className='flex items-center justify-end gap-2 self-stretch'>
            {!canInstall && (
              <Button variant='secondary' className='min-w-[72px]' onClick={handleCancel}>
                {t('common.operation.cancel')}
              </Button>
            )}
            <Button
              variant='primary'
              className='flex min-w-[72px] space-x-0.5'
              disabled={!canInstall || isInstalling || selectedPlugins.length === 0 || !canInstallPluginFromMarketplace}
              onClick={handleInstall}
            >
              {isInstalling && <RiLoader2Line className='h-4 w-4 animate-spin-slow' />}
              <span>{t(`${i18nPrefix}.${isInstalling ? 'installing' : 'install'}`)}</span>
            </Button>
          </div>
        </div>
      )}

    </>
  )
}
export default React.memo(Install)
