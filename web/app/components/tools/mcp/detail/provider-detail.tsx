'use client'
import type { FC } from 'react'
import type { ToolWithProvider } from '../../../workflow/types'
import * as React from 'react'
import Drawer from '@/app/components/base/drawer'
import { cn } from '@/utils/classnames'
import MCPDetailContent from './content'

type Props = {
  detail?: ToolWithProvider
  onUpdate: () => void
  onHide: () => void
  isTriggerAuthorize: boolean
  onFirstCreate: () => void
}

const MCPDetailPanel: FC<Props> = ({
  detail,
  onUpdate,
  onHide,
  isTriggerAuthorize,
  onFirstCreate,
}) => {
  const handleUpdate = (isDelete = false) => {
    if (isDelete)
      onHide()
    onUpdate()
  }

  if (!detail)
    return null

  return (
    <Drawer
      isOpen={!!detail}
      clickOutsideNotOpen={false}
      onClose={onHide}
      footer={null}
      mask={false}
      positionCenter={false}
      panelClassName={cn('mb-2 mr-2 mt-[64px] !w-[420px] !max-w-[420px] justify-start rounded-2xl border-[0.5px] border-components-panel-border !bg-components-panel-bg !p-0 shadow-xl')}
    >
      {detail && (
        <MCPDetailContent
          detail={detail}
          onHide={onHide}
          onUpdate={handleUpdate}
          isTriggerAuthorize={isTriggerAuthorize}
          onFirstCreate={onFirstCreate}
        />
      )}
    </Drawer>
  )
}

export default MCPDetailPanel
