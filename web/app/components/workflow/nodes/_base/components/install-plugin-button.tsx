import Button from '@/app/components/base/button'
import { RiInstallLine, RiLoader2Line } from '@remixicon/react'
import type { ComponentProps, MouseEventHandler } from 'react'
import classNames from '@/utils/classnames'
import { useTranslation } from 'react-i18next'
import { useCheckInstalled, useInstallPackageFromMarketPlace } from '@/service/use-plugins'

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
  const isLoading = manifest.isLoading || install.isPending
  // await for refetch to get the new installed plugin, when manifest refetch, this component will unmount
  || install.isSuccess
  const handleInstall: MouseEventHandler = (e) => {
    e.stopPropagation()
    install.mutate(uniqueIdentifier, {
      onSuccess: async () => {
        await manifest.refetch()
        onSuccess?.()
      },
    })
  }
  if (!manifest.data) return null
  const identifierSet = new Set(identifiers)
  const isInstalled = manifest.data.plugins.some(plugin => (
    identifierSet.has(plugin.id)
    || (plugin.plugin_unique_identifier && identifierSet.has(plugin.plugin_unique_identifier))
    || (plugin.plugin_id && identifierSet.has(plugin.plugin_id))
  ))
  if (isInstalled) return null
  return <Button
    variant={'secondary'}
    disabled={isLoading}
    {...rest}
    onClick={handleInstall}
    className={classNames('flex items-center', className)}
  >
    {!isLoading ? t('workflow.nodes.agent.pluginInstaller.install') : t('workflow.nodes.agent.pluginInstaller.installing')}
    {!isLoading ? <RiInstallLine className='ml-1 size-3.5' /> : <RiLoader2Line className='ml-1 size-3.5 animate-spin' />}
  </Button>
}
