'use client'
import type { FC, ReactNode } from 'react'
import cn from '@/utils/classnames'

type StartNodeOptionProps = {
  icon: ReactNode
  title: string
  subtitle?: string
  description: string
  onClick: () => void
}

const StartNodeOption: FC<StartNodeOptionProps> = ({
  icon,
  title,
  subtitle,
  description,
  onClick,
}) => {
  return (
    <div
      onClick={onClick}
      className={cn(
        'flex max-w-xs flex-col items-center p-6',
        'rounded-2xl border border-components-panel-border',
        'bg-components-panel-bg hover:bg-state-base-hover',
        'cursor-pointer transition-colors',
        'hover:border-components-panel-border-active',
      )}
    >
      <div className="mb-4">
        {icon}
      </div>

      <div className="text-center">
        <div className="mb-1">
          <h3 className="title-lg-semi-bold text-text-primary">
            {title}
          </h3>
          {subtitle && (
            <p className="body-md-regular text-text-tertiary">
              {subtitle}
            </p>
          )}
        </div>

        <p className="body-sm-regular leading-relaxed text-text-secondary">
          {description}
        </p>
      </div>
    </div>
  )
}

export default StartNodeOption
