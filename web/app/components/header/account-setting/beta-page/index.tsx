import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import {
  updateCurrentWorkspace,
} from '@/service/common'
import { useAppContext } from '@/context/app-context'

const BetaPage = () => {
  const { t } = useTranslation()
  const {
    currentWorkspace,
    mutateCurrentWorkspace,
  } = useAppContext()
  const workflowVarCheck = currentWorkspace.beta_config?.workflow_var_check

  const handleSwitch = async (checked: boolean) => {
    await updateCurrentWorkspace({
      url: '/workspaces/beta-config',
      body: {
        beta_config: {
          workflow_var_check: checked,
        },
      },
    })
    mutateCurrentWorkspace()
  }

  return (
    <div className='py-4'>
      <div className='system-md-medium mb-2 flex items-center justify-between rounded-xl bg-background-section-burn p-4 text-text-primary'>
        <div>
          <div className='system-md-medium text-text-primary'>{t('common.beta.workflowVarCheck')}</div>
          <div className='system-xs-regular text-text-tertiary'>{t('common.beta.workflowVarCheckTip')}</div>
        </div>
        <Switch
          size='l'
          defaultValue={workflowVarCheck}
          onChange={handleSwitch}
        />
      </div>
    </div>
  )
}

export default BetaPage
