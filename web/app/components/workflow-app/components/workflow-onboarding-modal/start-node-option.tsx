'use client'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type StartNodeOptionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: ReactNode
  title: string
  subtitle?: string
  description: string
}

function StartNodeOption({
  icon,
  title,
  subtitle,
  description,
  className,
  ...buttonProps
}: StartNodeOptionProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-40 w-[280px] cursor-pointer flex-col gap-2 rounded-xl border-[0.5px] border-components-option-card-option-border bg-components-panel-on-panel-item-bg p-4 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        className,
      )}
      {...buttonProps}
    >
      <div className="shrink-0">{icon}</div>

      <div className="flex h-[74px] flex-col gap-1 py-0.5">
        <div className="h-5 leading-5">
          <h3 className="text-text-primary">
            {title}
            {subtitle && (
              <span className="system-md-regular text-text-quaternary"> {subtitle}</span>
            )}
          </h3>
        </div>

        <div className="h-12 leading-4">
          <p className="system-xs-regular text-text-tertiary">{description}</p>
        </div>
      </div>
    </button>
  )
}

export default StartNodeOption
