import Button from '../button'
import { RiInstallLine, RiLoader2Line } from '@remixicon/react'

type InstallButtonProps = {
  loading: boolean
  onInstall: (e: React.MouseEvent) => void
  t: any
}

const InstallButton = ({ loading, onInstall, t }: InstallButtonProps) => {
  return (
    <Button size='small' className='z-[100]' onClick={onInstall}>
      <div className={`flex items-center justify-center gap-1 px-[3px] 
        ${loading ? 'text-components-button-secondary-text-disabled' : 'text-components-button-secondary-text'} 
        system-xs-medium`}
      >
        {loading ? t('workflow.nodes.agent.pluginInstaller.installing') : t('workflow.nodes.agent.pluginInstaller.install')}
      </div>
      {loading
        ? <RiLoader2Line className='text-text-quaternary h-3.5 w-3.5 animate-spin' />
        : <RiInstallLine className='text-text-secondary h-3.5 w-3.5' />
      }
    </Button>
  )
}

export default InstallButton
