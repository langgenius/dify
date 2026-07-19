'use client'
import type { FC } from 'react'
import type {
  Dependency,
  InstallStatus,
  InstallStatusResponse,
  Plugin,
  VersionInfo,
  VersionProps,
} from '../../../types'
import type { ExposeRefs } from './install-multi'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { RiLoader2Line } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanInstallPluginFromMarketplace } from '@/app/components/plugins/plugin-page/use-reference-setting'
import { useMittContextSelector } from '@/context/mitt-context'
import { useInstallOrUpdate, usePluginTaskList } from '@/service/use-plugins'
import { TaskStatus } from '../../../types'
import checkTaskStatus from '../../base/check-task-status'
import useRefreshPluginList from '../../hooks/use-refresh-plugin-list'
import { getPluginKey } from './hooks/use-install-multi-state'
import InstallMulti from './install-multi'

const i18nPrefix = 'installModal'

type Props = Readonly<{
  allPlugins: Dependency[]
  onStartToInstall?: () => void
  onInstalled: (
    plugins: Plugin[],
    installStatus: InstallStatus[],
    versionInfo: VersionProps[],
  ) => void
  onCancel: () => void
  isFromMarketPlace?: boolean
  isHideButton?: boolean
}>

type SelectedEntry = {
  dependency: Dependency
  plugin: Plugin
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
  const emit = useMittContextSelector((s) => s.emit)
  const [selectedEntries, setSelectedEntries] = React.useState<SelectedEntry[]>([])
  const selectedPlugins = selectedEntries.map(({ plugin }) => plugin)
  const selectedPluginsNum = selectedEntries.length
  const installMultiRef = useRef<ExposeRefs>(null)
  const { refreshPluginList } = useRefreshPluginList()
  const [isSelectAll, setIsSelectAll] = useState(false)
  const handleClickSelectAll = useCallback(() => {
    if (isSelectAll) installMultiRef.current?.deSelectAllPlugins()
    else installMultiRef.current?.selectAllPlugins()
  }, [isSelectAll])
  const [canInstall, setCanInstall] = React.useState(false)
  const [installedInfo, setInstalledInfo] = useState<Record<string, VersionInfo> | undefined>(
    undefined,
  )

  const handleLoadedAllPlugin = useCallback(
    (installedInfo: Record<string, VersionInfo> | undefined) => {
      handleClickSelectAll()
      setInstalledInfo(installedInfo)
      setCanInstall(true)
    },
    [],
  )

  const { check, stop } = checkTaskStatus()

  const handleCancel = useCallback(() => {
    stop()
    onCancel()
  }, [onCancel, stop])

  const { handleRefetch } = usePluginTaskList()
  const getSelectedVersionInfo = useCallback(
    (plugins: Plugin[]) => {
      return plugins.map((plugin) => {
        const pluginDetail = installedInfo?.[getPluginKey(plugin)]
        return {
          hasInstalled: !!pluginDetail,
          installedVersion: pluginDetail?.installedVersion,
          toInstallVersion: plugin.version,
        }
      })
    },
    [installedInfo],
  )

  // Install from marketplace and github
  const { mutate: installOrUpdate, isPending: isInstalling } = useInstallOrUpdate({
    onSuccess: async (res: InstallStatusResponse[], variables) => {
      const { payload: selectedDependencies, plugin: installedPlugins } = variables
      const isAllSettled = res.every(
        (r) => r.status === TaskStatus.success || r.status === TaskStatus.failed,
      )
      // if all settled, return the install status
      if (isAllSettled) {
        onInstalled(
          installedPlugins,
          res.map((r, i) => {
            return {
              success: r.status === TaskStatus.success,
              isFromMarketPlace: selectedDependencies[i]?.type === 'marketplace',
            }
          }),
          getSelectedVersionInfo(installedPlugins),
        )
        const hasInstallSuccess = res.some((r) => r.status === TaskStatus.success)
        if (hasInstallSuccess) {
          refreshPluginList(undefined, true)
          emit(
            'plugin:install:success',
            installedPlugins.flatMap((plugin, index) =>
              res[index]?.status === TaskStatus.success
                ? [`${plugin.plugin_id}/${plugin.name}`]
                : [],
            ),
          )
        }
        return
      }
      // if not all settled, keep checking the status of the plugins
      handleRefetch()
      const installStatus = await Promise.all(
        res.map(async (item, index) => {
          if (item.status !== TaskStatus.running) {
            return {
              success: item.status === TaskStatus.success,
              isFromMarketPlace: selectedDependencies[index]?.type === 'marketplace',
            }
          }
          const { status } = await check({
            taskId: item.taskId,
            pluginUniqueIdentifier: item.uniqueIdentifier,
          })
          return {
            success: status === TaskStatus.success,
            isFromMarketPlace: selectedDependencies[index]?.type === 'marketplace',
          }
        }),
      )
      onInstalled(installedPlugins, installStatus, getSelectedVersionInfo(installedPlugins))
      const hasInstallSuccess = installStatus.some((r) => r.success)
      if (hasInstallSuccess) {
        emit(
          'plugin:install:success',
          installedPlugins.flatMap((plugin, index) =>
            installStatus[index]?.success ? [`${plugin.plugin_id}/${plugin.name}`] : [],
          ),
        )
      }
    },
  })
  const handleInstall = () => {
    onStartToInstall?.()
    installOrUpdate({
      payload: selectedEntries.map(({ dependency }) => dependency),
      plugin: selectedEntries.map(({ plugin }) => plugin),
      installedInfo: installedInfo!,
    })
  }
  const [isIndeterminate, setIsIndeterminate] = useState(false)
  const handleSelectAll = useCallback(
    (plugins: Plugin[], selectedIndexes: number[]) => {
      setSelectedEntries(
        selectedIndexes.map((selectedIndex, index) => ({
          dependency: allPlugins[selectedIndex]!,
          plugin: plugins[index]!,
        })),
      )
      setIsSelectAll(true)
      setIsIndeterminate(false)
    },
    [allPlugins],
  )
  const handleDeSelectAll = useCallback(() => {
    setSelectedEntries([])
    setIsSelectAll(false)
    setIsIndeterminate(false)
  }, [])

  const handleSelect = useCallback(
    (plugin: Plugin, selectedIndex: number, allPluginsLength: number) => {
      const isSelected = selectedEntries.some(
        ({ plugin: item }) => item.plugin_id === plugin.plugin_id,
      )
      const nextSelectedEntries = isSelected
        ? selectedEntries.filter(({ plugin: item }) => item.plugin_id !== plugin.plugin_id)
        : [...selectedEntries, { dependency: allPlugins[selectedIndex]!, plugin }]
      setSelectedEntries(nextSelectedEntries)
      if (nextSelectedEntries.length === 0) {
        setIsSelectAll(false)
        setIsIndeterminate(false)
      } else if (nextSelectedEntries.length === allPluginsLength) {
        setIsSelectAll(true)
        setIsIndeterminate(false)
      } else {
        setIsIndeterminate(true)
        setIsSelectAll(false)
      }
    },
    [allPlugins, selectedEntries],
  )

  const { canInstallPluginFromMarketplace } = useCanInstallPluginFromMarketplace()
  return (
    <div className="flex min-h-0 flex-1 flex-col self-stretch overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-4 self-stretch overflow-hidden px-6 py-3">
        <div className="system-md-regular text-text-secondary">
          <p>
            {t(
              ($) =>
                $[
                  `${i18nPrefix}.${selectedPluginsNum > 1 ? 'readyToInstallPackages' : 'readyToInstallPackage'}`
                ],
              { ns: 'plugin', num: selectedPluginsNum },
            )}
          </p>
        </div>
        <div className="flex min-h-0 w-full flex-1 flex-col gap-1 overflow-y-auto rounded-2xl bg-background-section-burn p-2">
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
        <div className="flex items-center justify-between gap-2 self-stretch p-6 pt-5">
          <div className="px-2">
            {canInstall && (
              <label className="flex cursor-pointer items-center gap-x-2">
                <Checkbox
                  checked={isSelectAll}
                  indeterminate={isIndeterminate}
                  onCheckedChange={() => handleClickSelectAll()}
                />
                <span className="system-sm-medium text-text-secondary">
                  {isSelectAll
                    ? t(($) => $['operation.deSelectAll'], { ns: 'common' })
                    : t(($) => $['operation.selectAll'], { ns: 'common' })}
                </span>
              </label>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 self-stretch">
            {!canInstall && (
              <Button variant="secondary" className="min-w-[72px]" onClick={handleCancel}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </Button>
            )}
            <Button
              variant="primary"
              className="flex min-w-[72px] space-x-0.5"
              disabled={
                !canInstall ||
                isInstalling ||
                selectedPlugins.length === 0 ||
                !canInstallPluginFromMarketplace
              }
              onClick={handleInstall}
            >
              {isInstalling && <RiLoader2Line className="size-4 animate-spin-slow" />}
              <span>
                {t(($) => $[`${i18nPrefix}.${isInstalling ? 'installing' : 'install'}`], {
                  ns: 'plugin',
                })}
              </span>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
export default React.memo(Install)
