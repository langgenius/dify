import Button from '@/app/components/base/button'
import { RiInstallLine, RiLoader2Line } from '@remixicon/react'
import type { ComponentProps } from 'react'
import classNames from '@/utils/classnames'
import { useTranslation } from 'react-i18next'

type InstallPluginButtonProps = Omit<ComponentProps<typeof Button>, 'children'>

export const InstallPluginButton = (props: InstallPluginButtonProps) => {
  const { loading, className, ...rest } = props
  const { t } = useTranslation()
  return <Button variant={'secondary'} disabled={loading} className={classNames('flex items-center', className)} {...rest}>
    {loading ? t('workflow.nodes.agent.pluginInstaller.install') : t('workflow.nodes.agent.pluginInstaller.installing')}
    {!loading ? <RiInstallLine className='size-4 ml-1' /> : <RiLoader2Line className='size-4 ml-1 animate-spin' />}
  </Button>
}
