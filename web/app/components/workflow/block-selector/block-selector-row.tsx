import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type SharedProps = {
  children: ReactNode
  className?: string
  disabled?: boolean
  hoverable?: boolean
}

type ButtonRowProps = SharedProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'disabled'> & {
    as?: 'button'
    nativeDisabled?: boolean
  }

type DivRowProps = SharedProps &
  Omit<HTMLAttributes<HTMLDivElement>, 'className'> & {
    as: 'div'
  }

type BlockSelectorRowProps = ButtonRowProps | DivRowProps

const rowClassName = (className?: string, disabled = false, hoverable = true) =>
  cn(
    'flex h-8 w-full items-center rounded-lg pr-2 pl-3',
    !disabled && hoverable && 'hover:bg-state-base-hover',
    disabled && 'cursor-not-allowed',
    className,
  )

const buttonClassName = (className?: string, disabled = false, hoverable = true) =>
  cn(
    rowClassName(className, disabled, hoverable),
    !disabled && 'cursor-pointer',
    'border-0 bg-transparent text-left focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden',
  )

export function BlockSelectorRow(props: BlockSelectorRowProps) {
  if (props.as === 'div') {
    const { as: _as, children, className, disabled = false, hoverable, ...rest } = props

    return (
      <div className={rowClassName(className, disabled, hoverable)} {...rest}>
        {children}
      </div>
    )
  }

  const {
    as: _as,
    children,
    className,
    disabled = false,
    hoverable,
    nativeDisabled,
    type = 'button',
    ...rest
  } = props

  return (
    <button
      type={type}
      disabled={nativeDisabled}
      className={buttonClassName(className, disabled, hoverable)}
      {...rest}
    >
      {children}
    </button>
  )
}
