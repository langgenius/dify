'use client'
import type { FC } from 'react'
import {
  RiDeleteBinLine,
  RiEditLine,
  RiMoreFill,
} from '@remixicon/react'
import * as React from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'

type Props = {
  inCard?: boolean
  onOpenChange?: (open: boolean) => void
  onEdit: () => void
  onRemove: () => void
}

const OperationDropdown: FC<Props> = ({
  inCard,
  onOpenChange,
  onEdit,
  onRemove,
}) => {
  const { t } = useTranslation()
  const [open, doSetOpen] = useState(false)
  const openRef = useRef(open)
  const setOpen = useCallback((v: boolean) => {
    doSetOpen(v)
    openRef.current = v
    onOpenChange?.(v)
  }, [doSetOpen])

  const handleTrigger = useCallback(() => {
    setOpen(!openRef.current)
  }, [setOpen])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={{
        mainAxis: !inCard ? -12 : 0,
        crossAxis: !inCard ? 36 : 0,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        <div>
          <ActionButton size={inCard ? 'l' : 'm'} className={cn(open && 'bg-state-base-hover')}>
            <RiMoreFill className={cn('h-4 w-4', inCard && 'h-5 w-5')} />
          </ActionButton>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-50">
        <div className="w-[160px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-sm">
          <div
            className="flex cursor-pointer items-center rounded-lg px-3 py-1.5 hover:bg-state-base-hover"
            onClick={() => {
              onEdit()
              handleTrigger()
            }}
          >
            <RiEditLine className="h-4 w-4 text-text-tertiary" />
            <div className="system-md-regular ml-2 text-text-secondary">{t('mcp.operation.edit', { ns: 'tools' })}</div>
          </div>
          <div
            className="group flex cursor-pointer items-center rounded-lg px-3 py-1.5 hover:bg-state-destructive-hover"
            onClick={() => {
              onRemove()
              handleTrigger()
            }}
          >
            <RiDeleteBinLine className="h-4 w-4 text-text-tertiary group-hover:text-text-destructive-secondary" />
            <div className="system-md-regular ml-2 text-text-secondary group-hover:text-text-destructive">{t('mcp.operation.remove', { ns: 'tools' })}</div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(OperationDropdown)
