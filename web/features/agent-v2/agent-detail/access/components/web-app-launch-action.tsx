import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'

type WebAppLaunchActionProps = {
  href?: string
  label: string
  disabledReason?: string
}

export function WebAppLaunchAction({ href, label, disabledReason }: WebAppLaunchActionProps) {
  const content = (
    <>
      <span aria-hidden className="i-ri-external-link-line size-4" />
      {label}
    </>
  )

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={label}
        className={buttonVariants({ variant: 'secondary', size: 'medium' })}
      >
        {content}
      </a>
    )
  }

  const disabledButton = (
    <Button
      variant="secondary"
      size="medium"
      className="data-disabled:inset-ring-components-button-secondary-border"
      disabled
      focusableWhenDisabled={Boolean(disabledReason)}
    >
      {content}
    </Button>
  )

  if (!disabledReason) return disabledButton

  return (
    <Tooltip>
      <TooltipTrigger render={disabledButton} />
      <TooltipContent role="tooltip">{disabledReason}</TooltipContent>
    </Tooltip>
  )
}
