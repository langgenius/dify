import type { VariantProps } from 'class-variance-authority'
import type { CSSProperties } from 'react'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/utils/classnames'

enum ActionButtonState {
  Destructive = 'destructive',
  Active = 'active',
  Disabled = 'disabled',
  Default = '',
  Hover = 'hover',
}

const actionButtonVariants = cva(
  'action-btn',
  {
    variants: {
      size: {
        xs: 'action-btn-xs',
        m: 'action-btn-m',
        l: 'action-btn-l',
        xl: 'action-btn-xl',
      },
    },
    defaultVariants: {
      size: 'm',
    },
  },
)

export type ActionButtonProps = {
  size?: 'xs' | 's' | 'm' | 'l' | 'xl'
  state?: ActionButtonState
  styleCss?: CSSProperties
  ref?: React.Ref<HTMLButtonElement>
} & React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof actionButtonVariants>

function getActionButtonState(state: ActionButtonState) {
  switch (state) {
    case ActionButtonState.Destructive:
      return 'action-btn-destructive'
    case ActionButtonState.Active:
      return 'action-btn-active'
    case ActionButtonState.Disabled:
      return 'action-btn-disabled'
    case ActionButtonState.Hover:
      return 'action-btn-hover'
    default:
      return ''
  }
}

const ActionButton = ({ className, size, state = ActionButtonState.Default, styleCss, children, ref, disabled, ...props }: ActionButtonProps) => {
  return (
    <button
      type="button"
      className={cn(
        actionButtonVariants({ className, size }),
        getActionButtonState(state),
        disabled && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled',
      )}
      disabled={disabled}
      ref={ref}
      style={styleCss}
      {...props}
    >
      {children}
    </button>
  )
}
ActionButton.displayName = 'ActionButton'

export default ActionButton
export { ActionButton, ActionButtonState, actionButtonVariants }
