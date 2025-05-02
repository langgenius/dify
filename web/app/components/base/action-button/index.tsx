import type { CSSProperties } from 'react'
import React from 'react'
import { type VariantProps, cva } from 'class-variance-authority'
import classNames from '@/utils/classnames'

enum ActionButtonState {
  Destructive = 'destructive',
  Active = 'active',
  Disabled = 'disabled',
  Default = '',
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
} & React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof actionButtonVariants>

function getActionButtonState(state: ActionButtonState) {
  switch (state) {
    case ActionButtonState.Destructive:
      return 'action-btn-destructive'
    case ActionButtonState.Active:
      return 'action-btn-active'
    case ActionButtonState.Disabled:
      return 'action-btn-disabled'
    default:
      return ''
  }
}

const ActionButton = React.forwardRef<HTMLButtonElement, ActionButtonProps>(
  ({ className, size, state = ActionButtonState.Default, styleCss, children, ...props }, ref) => {
    return (
      <button
        type='button'
        className={classNames(
          actionButtonVariants({ className, size }),
          getActionButtonState(state),
        )}
        ref={ref}
        style={styleCss}
        {...props}
      >
        {children}
      </button>
    )
  },
)
ActionButton.displayName = 'ActionButton'

export default ActionButton
export { ActionButton, ActionButtonState, actionButtonVariants }
