import Button from '@/app/components/base/button'
import { InputField } from '@/app/components/base/icons/src/public/pipeline'
import { useStore } from '@/app/components/workflow/store'
import { useCallback } from 'react'

// TODO: i18n
const InputFieldButton = () => {
  const setShowInputFieldPanel = useStore(state => state.setShowInputFieldPanel)
  const handleClick = useCallback(() => {
    setShowInputFieldPanel?.(true)
  }, [setShowInputFieldPanel])

  return (
    <Button
      variant='secondary'
      className='flex gap-x-0.5'
      onClick={handleClick}
    >
      <InputField className='h-4 w-4' />
      <span className='px-0.5'>Input Field</span>
    </Button>
  )
}

export default InputFieldButton
