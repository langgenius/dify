import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { ConfigurationMethodEnum } from '../declarations'

type ConfigurationButtonProps = {
  modelProvider: any
  handleOpenModal: any
}

const ConfigurationButton = ({ modelProvider, handleOpenModal }: ConfigurationButtonProps) => {
  const { t } = useTranslation()
  return (
    <Button
      size="small"
      className="z-[100]"
      onClick={(e) => {
        e.stopPropagation()
        handleOpenModal(modelProvider, ConfigurationMethodEnum.predefinedModel, undefined)
      }}
    >
      <div className="flex items-center justify-center gap-1 px-[3px]">
        {t('nodes.agent.notAuthorized', { ns: 'workflow' })}
      </div>
      <div className="flex h-[14px] w-[14px] items-center justify-center">
        <div className="h-2 w-2 shrink-0 rounded-[3px] border border-components-badge-status-light-warning-border-inner
          bg-components-badge-status-light-warning-bg shadow-components-badge-status-light-warning-halo"
        />
      </div>
    </Button>
  )
}

export default ConfigurationButton
