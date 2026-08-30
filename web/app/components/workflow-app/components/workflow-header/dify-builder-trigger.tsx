import { Button } from '@langgenius/dify-ui/button'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'

const DifyBuilderTrigger = () => {
  const { t } = useTranslation()
  const showDifyBuilderPanel = useStore((state) => state.showDifyBuilderPanel)
  const setShowDifyBuilderPanel = useStore((state) => state.setShowDifyBuilderPanel)
  const label = t(($) => $['difyBuilder.buttonTooltip'], { ns: 'workflow' })

  if (showDifyBuilderPanel) return null

  return (
    <Button
      type="button"
      aria-label={label}
      className="rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg text-text-accent shadow-xs backdrop-blur-[10px]"
      variant="secondary"
      onClick={() => setShowDifyBuilderPanel(true)}
    >
      <span aria-hidden className="i-ri-chat-ai-line size-4" />
      <span className="system-xs-medium-uppercase">{label}</span>
    </Button>
  )
}

export default memo(DifyBuilderTrigger)
