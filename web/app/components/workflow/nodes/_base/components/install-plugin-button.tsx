import Button from '@/app/components/base/button'
import { RiInstallLine, RiLoader2Line } from '@remixicon/react'
import type { ComponentProps } from 'react'
import classNames from '@/utils/classnames'

type InstallPluginButtonProps = Omit<ComponentProps<typeof Button>, 'children'>

export const InstallPluginButton = (props: InstallPluginButtonProps) => {
  const { loading, className, ...rest } = props
  // TODO: add i18n label
  return <Button variant={'secondary'} disabled={loading} className={classNames('flex items-center', className)} {...rest}>
    {loading ? 'Installing' : 'Install'}
    {!loading ? <RiInstallLine className='size-4 ml-1' /> : <RiLoader2Line className='size-4 ml-1 animate-spin' />}
  </Button>
}
