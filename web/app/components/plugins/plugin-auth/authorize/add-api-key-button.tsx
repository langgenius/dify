import {
  memo,
  useState,
} from 'react'
import Button from '@/app/components/base/button'
import type { ButtonProps } from '@/app/components/base/button'
import ApiKeyModal from './api-key-modal'
import type { PluginPayload } from '../types'

export type AddApiKeyButtonProps = {
  pluginPayload: PluginPayload
  buttonVariant?: ButtonProps['variant']
  buttonText?: string
  disabled?: boolean
}
const AddApiKeyButton = ({
  pluginPayload,
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
            pluginPayload={pluginPayload}
            onClose={() => setIsApiKeyModalOpen(false)}
          />
        )
      }
    </>

  )
}

export default memo(AddApiKeyButton)
