import type { HTMLProps, PropsWithChildren, MouseEvent as ReactMouseEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { RiArrowRightUpLine } from '@remixicon/react'

type SuggestedActionButton = {
  ariaLabel: string
  icon: React.ReactNode
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
}

type SuggestedActionProps = PropsWithChildren<HTMLProps<HTMLAnchorElement> & {
  icon?: React.ReactNode
  link?: string
  disabled?: boolean
  actionButton?: SuggestedActionButton
}>

const SuggestedAction = ({
  icon,
  link,
  disabled,
  children,
  className,
  onClick,
  actionButton,
  ...props
}: SuggestedActionProps) => {
  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (disabled) {
      event.preventDefault()
      return
    }

    onClick?.(event)
  }

  const handleActionClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault()
      return
    }

    actionButton?.onClick(event)
  }

  const mainAction = (
    <a
      href={disabled ? undefined : link}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'flex min-w-0 items-center justify-start gap-2 px-2.5 py-2 text-text-secondary transition-colors',
        actionButton ? 'flex-1 rounded-l-lg' : 'rounded-lg bg-background-section-burn not-first:mt-1',
        disabled ? 'cursor-not-allowed opacity-30 shadow-xs' : 'cursor-pointer hover:bg-state-accent-hover hover:text-text-accent',
      )}
      onClick={handleClick}
      {...props}
    >
      <div className="relative h-4 w-4 shrink-0">{icon}</div>
      <div className="shrink grow basis-0 system-sm-medium">{children}</div>
      <RiArrowRightUpLine className="h-3.5 w-3.5 shrink-0" />
    </a>
  )

  if (!actionButton)
    return mainAction

  return (
    <div
      className={cn(
        'flex items-stretch rounded-lg bg-background-section-burn not-first:mt-1',
        disabled ? 'opacity-30 shadow-xs' : '',
        className,
      )}
    >
      {mainAction}
      <button
        type="button"
        aria-label={actionButton.ariaLabel}
        disabled={disabled}
        className={cn(
          'flex w-9 shrink-0 items-center justify-center rounded-r-lg border-l-[0.5px] border-divider-subtle text-text-tertiary transition-colors',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-state-accent-hover hover:text-text-accent',
        )}
        onClick={handleActionClick}
      >
        {actionButton.icon}
      </button>
    </div>
  )
}

export default SuggestedAction
