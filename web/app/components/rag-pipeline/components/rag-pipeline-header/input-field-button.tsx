import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { InputField } from '@/app/components/base/icons/src/vender/pipeline'
import { useWorkflowStore } from '@/app/components/workflow/store'

const InputFieldButton = () => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const handleClick = useCallback(() => {
    const { setShowInputFieldPanel, setShowEnvPanel } = workflowStore.getState()
    setShowInputFieldPanel?.(true)
    setShowEnvPanel(false)
  }, [workflowStore])

  return (
    <Button
      variant="secondary"
      className="flex gap-x-0.5"
      onClick={handleClick}
    >
      <InputField className="h-4 w-4" />
      <span className="px-0.5">{t('inputField', { ns: 'datasetPipeline' })}</span>
    </Button>
  )
}

export default InputFieldButton
