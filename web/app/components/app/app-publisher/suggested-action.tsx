import type { PropsWithChildren, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useId } from 'react'
import Link from '@/next/link'

type SuggestedActionButton = {
  ariaLabel: string
  icon: ReactNode
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
}

type SuggestedActionProps = PropsWithChildren<{
  icon?: ReactNode
  link?: string
  external?: boolean
  disabled?: boolean
  focusableWhenDisabled?: boolean
  description?: ReactNode
  endIcon?: ReactNode
  actionButton?: SuggestedActionButton
  className?: string
  onClick?: () => void
}>

const SuggestedAction = ({
  icon,
  link,
  external = false,
  disabled = false,
  focusableWhenDisabled = false,
  description,
  endIcon,
  actionButton,
  children,
  className,
  onClick,
}: SuggestedActionProps) => {
  const id = useId()
  const labelId = `${id}-label`
  const descriptionId = `${id}-description`
  const interactiveClassName = cn(
    'group flex min-h-10 min-w-0 items-center gap-2 border-0 bg-transparent p-1 text-left outline-hidden transition-[min-height,background-color] duration-200 ease-out motion-reduce:transition-none',
    actionButton ? 'flex-1 rounded-l-lg' : 'w-full rounded-lg',
    disabled
      ? cn(
          'cursor-not-allowed',
          !actionButton && 'opacity-30',
          focusableWhenDisabled && 'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        )
      : 'cursor-pointer hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
    !actionButton && className,
  )
  const content = (
    <>
      <span
        aria-hidden
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-components-panel-on-panel-item-bg text-text-secondary shadow-xs transition-colors',
          !disabled && 'group-hover:text-text-accent group-focus-visible:text-text-accent',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          id={labelId}
          className={cn(
            'block truncate system-sm-medium text-text-secondary transition-colors',
            !disabled && 'group-hover:text-text-primary group-focus-visible:text-text-primary',
          )}
        >
          {children}
        </span>
        {!!description && (
          <span
            className={cn(
              'grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
              !disabled &&
                'group-hover:grid-rows-[1fr] group-hover:opacity-100 group-focus-visible:grid-rows-[1fr] group-focus-visible:opacity-100',
            )}
          >
            <span
              id={descriptionId}
              className="min-h-0 truncate system-xs-regular text-text-tertiary"
            >
              {description}
            </span>
          </span>
        )}
      </span>
      <span className="flex min-h-4 min-w-4 shrink-0 items-center justify-center text-text-quaternary">
        {endIcon ?? <span aria-hidden className="i-ri-arrow-right-up-line size-3.5" />}
      </span>
    </>
  )
  const accessibilityProps = {
    'aria-labelledby': labelId,
    'aria-describedby': description ? descriptionId : undefined,
  }

  let mainAction: ReactNode

  if (disabled) {
    mainAction = (
      <button
        type="button"
        disabled={!focusableWhenDisabled}
        aria-disabled={focusableWhenDisabled || undefined}
        className={interactiveClassName}
        onClick={
          focusableWhenDisabled
            ? (event) => {
                event.preventDefault()
                event.stopPropagation()
              }
            : undefined
        }
        onKeyDown={
          focusableWhenDisabled
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') event.preventDefault()
              }
            : undefined
        }
        {...accessibilityProps}
      >
        {content}
      </button>
    )
  } else if (!link) {
    mainAction = (
      <button
        type="button"
        className={interactiveClassName}
        onClick={onClick}
        {...accessibilityProps}
      >
        {content}
      </button>
    )
  } else if (external) {
    mainAction = (
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        className={interactiveClassName}
        onClick={onClick}
        {...accessibilityProps}
      >
        {content}
      </a>
    )
  } else {
    mainAction = (
      <Link href={link} className={interactiveClassName} onClick={onClick} {...accessibilityProps}>
        {content}
      </Link>
    )
  }

  if (!actionButton) return mainAction

  return (
    <div
      className={cn(
        'flex w-full min-w-0 items-stretch rounded-lg',
        disabled && 'opacity-30',
        className,
      )}
    >
      {mainAction}
      <button
        type="button"
        aria-label={actionButton.ariaLabel}
        disabled={disabled}
        className={cn(
          'flex w-9 shrink-0 items-center justify-center rounded-r-lg border-l-[0.5px] border-divider-subtle text-text-tertiary outline-hidden transition-colors',
          disabled
            ? 'cursor-not-allowed'
            : 'cursor-pointer hover:bg-state-base-hover hover:text-text-accent focus-visible:bg-state-base-hover focus-visible:text-text-accent focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        )}
        onClick={actionButton.onClick}
      >
        <span aria-hidden className="flex size-4 items-center justify-center">
          {actionButton.icon}
        </span>
      </button>
    </div>
  )
}

export default SuggestedAction
