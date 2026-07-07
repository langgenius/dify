import type { PluginPayload } from '../types'
import type { ButtonProps } from '@/app/components/base/button'
import type { FormSchema } from '@/app/components/base/form/types'
import {
  memo,
  useState,
} from 'react'
import Button from '@/app/components/base/button'
import ApiKeyModal from './api-key-modal'

export type AddApiKeyButtonProps = {
  pluginPayload: PluginPayload
  buttonVariant?: ButtonProps['variant']
  buttonText?: string
  disabled?: boolean
  onUpdate?: () => void
  formSchemas?: FormSchema[]
  /**
   * If provided, clicking the button calls this callback instead of mounting
   * the modal inline. Use this when the button lives inside a Popover that
   * would unmount the modal on outside-click; the parent should render the
   * ApiKeyModal at a level above the Popover.
   */
  onClick?: () => void
}
const AddApiKeyButton = ({
  pluginPayload,
  buttonVariant = 'secondary-accent',
  buttonText = 'Use Api Key',
  disabled,
  onUpdate,
  formSchemas = [],
  onClick,
}: AddApiKeyButtonProps) => {
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)
  const [isApiKeyModalMounted, setIsApiKeyModalMounted] = useState(false)
  const handleClick = onClick ?? (() => {
    setIsApiKeyModalMounted(true)
    setIsApiKeyModalOpen(true)
  })

  return (
    <>
      <Button
        className="w-full"
        variant={buttonVariant}
        onClick={handleClick}
        disabled={disabled}
      >
        {buttonText}
      </Button>
      {
        // Only mount the modal here when in uncontrolled mode (no onClick prop).
        !onClick && isApiKeyModalMounted && (
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
