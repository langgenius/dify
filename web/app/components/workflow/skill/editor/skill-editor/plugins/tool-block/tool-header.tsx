'use client'

import type { FC } from 'react'
import type { Emoji } from '@/app/components/tools/types'
import { RiBookOpenLine, RiCloseLine } from '@remixicon/react'
import AppIcon from '@/app/components/base/app-icon'

type ToolHeaderProps = {
  icon: string | Emoji | undefined
  providerLabel: string
  toolLabel: string
  description: string
  onClose: () => void
}

const ToolHeader: FC<ToolHeaderProps> = ({
  icon,
  providerLabel,
  toolLabel,
  description,
  onClose,
}) => {
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
            {renderHeaderIcon()}
            <span className="system-xs-medium text-text-tertiary">
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
            }}
          >
            <RiBookOpenLine className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-[6px] text-text-tertiary hover:bg-state-base-hover"
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
          >
            <RiCloseLine className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-1.5 px-3 pb-2">
        <div className="system-md-semibold text-text-primary">
          {toolLabel}
        </div>
        <div className="system-sm-regular mt-2.5 text-text-secondary">
          {description}
        </div>
      </div>
    </>
  )
}

export default ToolHeader
