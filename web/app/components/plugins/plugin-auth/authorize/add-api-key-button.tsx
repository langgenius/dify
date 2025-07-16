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
  onUpdate?: () => void
}
const AddApiKeyButton = ({
  pluginPayload,
  buttonVariant = 'secondary-accent',
  buttonText = 'use api key',
  disabled,
  onUpdate,
}: AddApiKeyButtonProps) => {
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)

  return (
    <>
      <Button
        className='w-full'
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
            onUpdate={onUpdate}
          />
        )
      }
    </>

  )
}

export default memo(AddApiKeyButton)
