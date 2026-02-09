'use client'

import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import { ROOT_ID } from '../../constants'
import { useSkillAssetNodeMap } from '../../hooks/file-tree/data/use-skill-asset-tree'

export type DragAction = 'upload' | 'move'

type DragActionTooltipProps = {
  action: DragAction
}

const DragActionTooltip = ({ action }: DragActionTooltipProps) => {
  const { t } = useTranslation('workflow')
  const dragOverFolderId = useStore(s => s.dragOverFolderId)
  const { data: nodeMap } = useSkillAssetNodeMap()

  // Resolve target path from dragOverFolderId
  const targetPath = useMemo(() => {
    if (!dragOverFolderId)
      return null

    if (dragOverFolderId === ROOT_ID)
      return t('skillSidebar.rootFolder')

    const node = nodeMap?.get(dragOverFolderId)
    // Strip leading slash from path (e.g., "/skills/assets" -> "skills/assets")
    const path = node?.path
    return path?.startsWith('/') ? path.slice(1) : path ?? null
  }, [dragOverFolderId, nodeMap, t])

  // Don't render if not dragging over a valid target
  if (!targetPath)
    return null

  const actionText = action === 'upload'
    ? t('skillSidebar.dragAction.uploadTo')
    : t('skillSidebar.dragAction.moveTo')

  return (
    <div className="flex shrink-0 items-center justify-center py-3">
      <div className="rounded-lg bg-components-tooltip-bg p-1.5 shadow-lg backdrop-blur-[5px]">
        <p className="px-0.5 text-text-secondary system-xs-regular">
          {actionText}
          <span className="system-xs-medium">{targetPath}</span>
        </p>
      </div>
    </div>
  )
}

export default React.memo(DragActionTooltip)
