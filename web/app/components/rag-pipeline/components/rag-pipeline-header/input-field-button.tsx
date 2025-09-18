import Button from '@/app/components/base/button'
import { InputField } from '@/app/components/base/icons/src/vender/pipeline'
import { useStore } from '@/app/components/workflow/store'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const InputFieldButton = () => {
  const { t } = useTranslation()
  const setShowInputFieldPanel = useStore(state => state.setShowInputFieldPanel)
  const setShowEnvPanel = useStore(state => state.setShowEnvPanel)
  const handleClick = useCallback(() => {
    setShowInputFieldPanel?.(true)
    setShowEnvPanel(false)
  }, [setShowInputFieldPanel, setShowEnvPanel])

  return (
    <Button
      variant='secondary'
      className='flex gap-x-0.5'
      onClick={handleClick}
    >
      <InputField className='h-4 w-4' />
      <span className='px-0.5'>{t('datasetPipeline.inputField')}</span>
    </Button>
  )
}

export default InputFieldButton
