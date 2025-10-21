import { memo } from 'react'
import Button from '@/app/components/base/button'
import { GlobalVariable } from '@/app/components/base/icons/src/vender/line/others'
import { useStore } from '@/app/components/workflow/store'

const GlobalVariableButton = ({ disabled }: { disabled: boolean }) => {
  const setShowPanel = useStore(s => s.setShowGlobalVariablePanel)

  const handleClick = () => {
    setShowPanel(true)
  }

  return (
    <Button className='p-2' disabled={disabled} onClick={handleClick}>
      <GlobalVariable className='h-4 w-4 text-components-button-secondary-text' />
    </Button>
  )
}

export default memo(GlobalVariableButton)
