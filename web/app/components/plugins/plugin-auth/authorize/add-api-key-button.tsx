import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { PluginPayload } from '../types'
import type { FormSchema } from '@/app/components/base/form/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  memo,
  useState,
} from 'react'
import ApiKeyModal from './api-key-modal'

export type AddApiKeyButtonProps = {
  pluginPayload: PluginPayload
  buttonVariant?: ButtonProps['variant']
  buttonText?: string
  disabled?: boolean
  onUpdate?: () => void
  formSchemas?: FormSchema[]
  onOpenModal?: () => void
}
const AddApiKeyButton = ({
  pluginPayload,
  buttonVariant = 'secondary-accent',
  buttonText = 'Use Api Key',
  disabled,
  onUpdate,
  formSchemas = [],
  onOpenModal,
}: AddApiKeyButtonProps) => {
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)

  return (
    <>
      <Button
        className="w-full"
        variant={buttonVariant}
        onClick={() => {
          if (onOpenModal) {
            onOpenModal()
            return
          }

          setIsApiKeyModalOpen(true)
        }}
        disabled={disabled}
      >
        {buttonText}
      </Button>
      {
        !onOpenModal && isApiKeyModalOpen && (
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
