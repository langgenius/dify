import { Button } from '@langgenius/dify-ui/button'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useTranslation } from 'react-i18next'
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
      className="z-100"
      onClick={(e) => {
        e.stopPropagation()
        handleOpenModal(modelProvider, ConfigurationMethodEnum.predefinedModel, undefined)
      }}
    >
      <div className="flex items-center justify-center gap-1 px-[3px]">
        {t('nodes.agent.notAuthorized', { ns: 'workflow' })}
      </div>
      <div className="flex h-[14px] w-[14px] items-center justify-center">
        <StatusDot status="warning" />
      </div>
    </Button>
  )
}

export default ConfigurationButton
