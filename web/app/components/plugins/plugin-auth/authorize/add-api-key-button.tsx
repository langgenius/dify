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
  const [isApiKeyModalMounted, setIsApiKeyModalMounted] = useState(false)

  return (
    <>
      <Button
        className="w-full"
        variant={buttonVariant}
        onClick={() => {
          setIsApiKeyModalMounted(true)
          setIsApiKeyModalOpen(true)
        }}
        disabled={disabled}
      >
        {buttonText}
      </Button>
      {
        isApiKeyModalMounted && (
          <ApiKeyModal
            open={isApiKeyModalOpen}
            onOpenChange={setIsApiKeyModalOpen}
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
