import { Button } from '@langgenius/dify-ui/button'

type DifyBuilderEntryProps = {
  description: string
  disabled?: boolean
  label: string
  onClick: () => void
}

const DifyBuilderEntry = ({
  description,
  disabled = false,
  label,
  onClick,
}: DifyBuilderEntryProps) => {
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        size="medium"
        variant="primary"
        disabled={disabled}
        className="bg-components-button-debug-bg! px-3! text-components-button-debug-text! inset-ring-components-button-debug-border! hover:bg-components-button-debug-bg-hover! hover:inset-ring-components-button-debug-border-hover! data-disabled:bg-components-button-debug-bg-disabled! data-disabled:text-components-button-debug-text-disabled! data-disabled:inset-ring-components-button-debug-border-disabled!"
        onClick={onClick}
      >
        {label}
      </Button>
      <p className="text-left system-xs-regular text-text-tertiary">{description}</p>
    </div>
  )
}

export default DifyBuilderEntry
