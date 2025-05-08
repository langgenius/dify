import Button from '@/app/components/base/button'
import { InputField } from '@/app/components/base/icons/src/vender/pipeline'
import { useStore } from '@/app/components/workflow/store'
import { useCallback } from 'react'

const InputFieldButton = () => {
  const setShowInputFieldDialog = useStore(state => state.setShowInputFieldDialog)
  const handleClick = useCallback(() => {
    setShowInputFieldDialog?.(true)
  }, [setShowInputFieldDialog])

  return (
    <Button
      variant='secondary'
      className='flex gap-x-0.5'
      onClick={handleClick}
    >
      <InputField className='h-4 w-4' />
      {/* // TODO: i18n */}
      <span className='px-0.5'>Input Field</span>
    </Button>
  )
}

export default InputFieldButton
