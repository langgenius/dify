import { Button } from '@langgenius/dify-ui/button'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'

const InputFieldButton = () => {
  const { t } = useTranslation()
  const setShowInputFieldPanel = useStore((state) => state.setShowInputFieldPanel)
  const setShowEnvPanel = useStore((state) => state.setShowEnvPanel)
  const handleClick = useCallback(() => {
    setShowInputFieldPanel?.(true)
    setShowEnvPanel(false)
  }, [setShowInputFieldPanel, setShowEnvPanel])

  return (
    <Button variant="secondary" className="flex" onClick={handleClick}>
      <span aria-hidden className="i-custom-vender-pipeline-input-field size-4" />
      <span>{t(($) => $.inputField, { ns: 'datasetPipeline' })}</span>
    </Button>
  )
}

export default InputFieldButton
