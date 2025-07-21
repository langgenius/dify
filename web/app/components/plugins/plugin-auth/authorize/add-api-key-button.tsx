import {
  memo,
  useState,
} from 'react'
import Button from '@/app/components/base/button'
import type { ButtonProps } from '@/app/components/base/button'
import ApiKeyModal from './api-key-modal'
import type { PluginPayload } from '../types'
import type { FormSchema } from '@/app/components/base/form/types'

export type AddApiKeyButtonProps = {
  pluginPayload: PluginPayload
  buttonVariant?: ButtonProps['variant']
  buttonText?: string
  disabled?: boolean
  onUpdate?: () => void
  formSchemas?: FormSchema[]
}
const AddApiKeyButton = ({
  pluginPayload,
  buttonVariant = 'secondary-accent',
  buttonText = 'Use Api Key',
  disabled,
  onUpdate,
  formSchemas = [],
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
            formSchemas={formSchemas}
          />
        )
      }
    </>

  )
}

export default memo(AddApiKeyButton)
