import {
  memo,
  useState,
} from 'react'
import Button from '@/app/components/base/button'
import type { ButtonProps } from '@/app/components/base/button'
import ApiKeyModal from './api-key-modal'

export type AddApiKeyButtonProps = {
  provider?: string
  buttonVariant?: ButtonProps['variant']
  buttonText?: string
  disabled?: boolean
}
const AddApiKeyButton = ({
  provider = '',
  buttonVariant = 'secondary-accent',
  buttonText = 'use api key',
  disabled,
}: AddApiKeyButtonProps) => {
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)

  return (
    <>
      <Button
        className='grow'
        variant={buttonVariant}
        onClick={() => setIsApiKeyModalOpen(true)}
        disabled={disabled}
      >
        {buttonText}
      </Button>
      {
        isApiKeyModalOpen && (
          <ApiKeyModal
            provider={provider}
            onClose={() => setIsApiKeyModalOpen(false)}
          />
        )
      }
    </>

  )
}

export default memo(AddApiKeyButton)
