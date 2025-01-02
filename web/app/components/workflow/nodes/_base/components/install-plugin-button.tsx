import Button from '@/app/components/base/button'
import { RiInstallLine, RiLoader2Line } from '@remixicon/react'
import type { ComponentProps } from 'react'
import classNames from '@/utils/classnames'
import { useTranslation } from 'react-i18next'
import { useCheckInstalled, useInstallPackageFromMarketPlace } from '@/service/use-plugins'

type InstallPluginButtonProps = Omit<ComponentProps<typeof Button>, 'children' | 'loading'> & {
  uniqueIdentifier: string
}

export const InstallPluginButton = (props: InstallPluginButtonProps) => {
  const { className, uniqueIdentifier, ...rest } = props
  const { t } = useTranslation()
  const manifest = useCheckInstalled({
    pluginIds: [uniqueIdentifier],
    enabled: !!uniqueIdentifier,
  })
  const install = useInstallPackageFromMarketPlace({
    onSuccess() {
      manifest.refetch()
    },
  })
  const handleInstall = () => {
    install.mutate(uniqueIdentifier)
  }
  if (!manifest.data) return null
  if (manifest.data.plugins.some(plugin => plugin.id === uniqueIdentifier)) return null
  return <Button variant={'secondary'} disabled={install.isPending} {...rest} onClick={handleInstall} className={classNames('flex items-center', className)} >
    {install.isPending ? t('workflow.nodes.agent.pluginInstaller.install') : t('workflow.nodes.agent.pluginInstaller.installing')}
    {!install.isPending ? <RiInstallLine className='size-4 ml-1' /> : <RiLoader2Line className='size-4 ml-1 animate-spin' />}
  </Button>
}
