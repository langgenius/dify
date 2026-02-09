'use client'

import type { Emoji } from '@/app/components/tools/types'
import AppIcon from '@/app/components/base/app-icon'

type ToolHeaderProps = {
  icon: string | Emoji | undefined
  providerLabel: string
  toolLabel: string
  description: string
  onClose: () => void
  onBack?: () => void
  backLabel?: string
}

const ToolHeader = ({
  icon,
  providerLabel,
  toolLabel,
  description,
  onClose,
  onBack,
  backLabel,
}: ToolHeaderProps) => {
  const renderHeaderIcon = () => {
    if (!icon)
      return null
    if (typeof icon === 'string') {
      if (icon.startsWith('http') || icon.startsWith('/')) {
        return (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-divider-subtle bg-background-default-dodge">
            <span
              className="h-full w-full bg-cover bg-center"
              style={{ backgroundImage: `url(${icon})` }}
            />
          </span>
        )
      }
      return (
        <AppIcon
          size="xs"
          icon={icon}
          className="!h-5 !w-5 shrink-0 !rounded-[6px] !border border-divider-subtle bg-background-default-dodge"
        />
      )
    }
    return (
      <AppIcon
        size="xs"
        icon={icon.content}
        background={icon.background}
        className="!h-5 !w-5 shrink-0 !rounded-[6px] !border border-divider-subtle bg-background-default-dodge"
      />
    )
  }

  return (
    <>
      <div className="flex items-start gap-1 px-3 pb-2 pt-3">
        <div className="flex flex-1 flex-col items-start">
          <div className="flex items-center gap-1 rounded-md px-1 py-1">
            {onBack && (
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded-[6px] text-text-tertiary hover:bg-state-base-hover"
                aria-label={backLabel}
                title={backLabel}
                onClick={(event) => {
                  event.stopPropagation()
                  onBack()
                }}
              >
                <span className="i-ri-arrow-left-s-line h-4 w-4" />
              </button>
            )}
            {renderHeaderIcon()}
            <span className="text-text-tertiary system-xs-medium">
              {providerLabel}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 pt-1">
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-[6px] text-text-tertiary hover:bg-state-base-hover"
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
          >
            <span className="i-ri-close-line h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-1.5 px-3 pb-2">
        <div className="text-text-primary system-md-semibold">
          {toolLabel}
        </div>
        <div className="mt-2.5 text-text-secondary system-sm-regular">
          {description}
        </div>
      </div>
    </>
  )
}

export default ToolHeader
