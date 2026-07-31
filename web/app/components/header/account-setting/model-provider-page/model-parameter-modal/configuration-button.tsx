import { Button } from '@langgenius/dify-ui/button'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useTranslation } from 'react-i18next'
type ConfigurationButtonProps = {
  loading: boolean
  onConfigure: () => void
}

const ConfigurationButton = ({ loading, onConfigure }: ConfigurationButtonProps) => {
  const { t } = useTranslation()
  return (
    <Button
      size="small"
      loading={loading}
      onClick={(e) => {
        e.stopPropagation()
        onConfigure()
      }}
    >
      <div className="flex items-center justify-center gap-1 px-0.75">
        {t(($) => $['nodes.agent.notAuthorized'], { ns: 'workflow' })}
      </div>
      <div className="flex h-3.5 w-3.5 items-center justify-center">
        <StatusDot status="warning" />
      </div>
    </Button>
  )
}

export default ConfigurationButton
