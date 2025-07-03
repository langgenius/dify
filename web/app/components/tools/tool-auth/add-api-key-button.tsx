import {
  memo,
  useState,
} from 'react'
import Button from '@/app/components/base/button'
import type { ButtonProps } from '@/app/components/base/button'
import ApiKeyModal from './api-key-modal'

type AddApiKeyButtonProps = {
  buttonVariant?: ButtonProps['variant']
  buttonText?: string
}
const AddApiKeyButton = ({
  buttonVariant = 'secondary-accent',
  buttonText = 'use api key',
}: AddApiKeyButtonProps) => {
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)

  return (
    <>
      <Button
        className='grow'
        variant={buttonVariant}
        onClick={() => setIsApiKeyModalOpen(true)}
      >
        {buttonText}
      </Button>
      {
        isApiKeyModalOpen && (
          <ApiKeyModal
            onClose={() => setIsApiKeyModalOpen(false)}
          />
        )
      }
    </>

  )
}

export default memo(AddApiKeyButton)
