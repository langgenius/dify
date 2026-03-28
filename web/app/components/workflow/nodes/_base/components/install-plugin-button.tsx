import type { ComponentProps, MouseEventHandler } from 'react'
import { RiInstallLine, RiLoader2Line } from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import checkTaskStatus from '@/app/components/plugins/install-plugin/base/check-task-status'
import { TaskStatus } from '@/app/components/plugins/types'
import { useCheckInstalled, useInstallPackageFromMarketPlace } from '@/service/use-plugins'
import { cn } from '@/utils/classnames'

type InstallPluginButtonProps = Omit<ComponentProps<typeof Button>, 'children' | 'loading'> & {
  uniqueIdentifier: string
  extraIdentifiers?: string[]
  onSuccess?: () => void
}

export const InstallPluginButton = (props: InstallPluginButtonProps) => {
  const {
    className,
    uniqueIdentifier,
    extraIdentifiers = [],
    onSuccess,
    ...rest
  } = props
  const { t } = useTranslation()
  const identifiers = Array.from(new Set(
    [uniqueIdentifier, ...extraIdentifiers].filter((item): item is string => Boolean(item)),
  ))
  const manifest = useCheckInstalled({
    pluginIds: identifiers,
    enabled: identifiers.length > 0,
  })
  const install = useInstallPackageFromMarketPlace()
  const [isTracking, setIsTracking] = useState(false)
  const isLoading = manifest.isLoading || install.isPending || isTracking
  const handleInstall: MouseEventHandler = (e) => {
    e.stopPropagation()
    if (isLoading)
      return
    setIsTracking(true)
    install.mutate(uniqueIdentifier, {
      onSuccess: async (response) => {
        const finish = async () => {
          await manifest.refetch()
          onSuccess?.()
          setIsTracking(false)
          install.reset()
        }

        if (!response) {
          await finish()
          return
        }

        if (response.all_installed) {
          await finish()
          return
        }

        const { check } = checkTaskStatus()
        try {
          const { status } = await check({
            taskId: response.task_id,
            pluginUniqueIdentifier: uniqueIdentifier,
          })

          if (status === TaskStatus.failed) {
            setIsTracking(false)
            install.reset()
            return
          }

          await finish()
        }
        catch {
          setIsTracking(false)
          install.reset()
        }
      },
      onError: () => {
        setIsTracking(false)
        install.reset()
      },
    })
  }
  if (!manifest.data)
    return null
  const identifierSet = new Set(identifiers)
  const isInstalled = manifest.data.plugins.some(plugin => (
    identifierSet.has(plugin.id)
    || (plugin.plugin_unique_identifier && identifierSet.has(plugin.plugin_unique_identifier))
    || (plugin.plugin_id && identifierSet.has(plugin.plugin_id))
  ))
  if (isInstalled)
    return null
  return (
    <Button
      variant="secondary"
      disabled={isLoading}
      {...rest}
      onClick={handleInstall}
      className={cn('flex items-center', className)}
    >
      {!isLoading ? t('nodes.agent.pluginInstaller.install', { ns: 'workflow' }) : t('nodes.agent.pluginInstaller.installing', { ns: 'workflow' })}
      {!isLoading ? <RiInstallLine className="ml-1 size-3.5" /> : <RiLoader2Line className="ml-1 size-3.5 animate-spin" />}
    </Button>
  )
}
