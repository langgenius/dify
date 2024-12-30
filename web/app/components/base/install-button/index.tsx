import Button from '../button'
import { RiInstallLine, RiLoader2Line } from '@remixicon/react'

type InstallButtonProps = {
  loading: boolean
  onInstall: () => void
  t: any
}

const InstallButton = ({ loading, onInstall, t }: InstallButtonProps) => {
  return (
    <Button size='small' className='z-[100]' onClick={onInstall}>
      <div className={`flex px-[3px] justify-center items-center gap-1 
        ${loading ? 'text-components-button-secondary-text-disabled' : 'text-components-button-secondary-text'} 
        system-xs-medium`}
      >
        {loading ? t('workflow.nodes.agent.pluginInstaller.installing') : t('workflow.nodes.agent.pluginInstaller.install')}
      </div>
      {loading
        ? <RiLoader2Line className='w-3.5 h-3.5 text-text-quaternary' />
        : <RiInstallLine className='w-3.5 h-3.5 text-text-secondary' />
      }
    </Button>
  )
}

export default InstallButton
