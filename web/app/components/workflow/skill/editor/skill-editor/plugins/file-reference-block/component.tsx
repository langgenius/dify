import type { LexicalNode } from 'lexical'
import type { FileAppearanceType } from '@/app/components/base/file-uploader/types'
import type { TreeNodeData } from '@/app/components/workflow/skill/type'
import type { AppAssetTreeView } from '@/types/app-asset'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getNodeByKey } from 'lexical'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useSelectOrDelete } from '@/app/components/base/prompt-editor/hooks'
import Tooltip from '@/app/components/base/tooltip'
import { START_TAB_ID } from '@/app/components/workflow/skill/constants'
import { useSkillAssetNodeMap } from '@/app/components/workflow/skill/hooks/file-tree/data/use-skill-asset-tree'
import { getFileIconType } from '@/app/components/workflow/skill/utils/file-utils'
import { useStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'
import { FilePickerPanel } from '../file-picker-panel'
import FilePreviewPanel from './file-preview-panel'
import { useFilePreviewContext } from './preview-context'

type FileReferenceBlockProps = {
  nodeKey: string
  resourceId: string
}

type SkillFileMetadata = {
  files?: Record<string, AppAssetTreeView>
}

const FileReferenceBlock = ({ nodeKey, resourceId }: FileReferenceBlockProps) => {
  const [editor] = useLexicalComposerContext()
  const [ref, isSelected] = useSelectOrDelete(nodeKey)
  const { data: nodeMap, isLoading: isNodeMapLoading } = useSkillAssetNodeMap()
  const activeTabId = useStore(s => s.activeTabId)
  const fileMetadata = useStore(s => s.fileMetadata)
  const [open, setOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewStyle, setPreviewStyle] = useState<React.CSSProperties | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPreviewEnabled = useFilePreviewContext(context => context.enabled)
  const { t } = useTranslation()
  const isInteractive = editor.isEditable()

  const metadataFiles = useMemo(() => {
    if (!activeTabId || activeTabId === START_TAB_ID)
      return undefined
    const metadata = fileMetadata.get(activeTabId) as SkillFileMetadata | undefined
    return metadata?.files
  }, [activeTabId, fileMetadata])

  const treeNode = useMemo(() => nodeMap?.get(resourceId), [nodeMap, resourceId])
  const metadataNode = useMemo(() => metadataFiles?.[resourceId], [metadataFiles, resourceId])
  const currentNode = useMemo(() => treeNode ?? metadataNode, [metadataNode, treeNode])

  const fallbackName = useMemo(() => {
    if (resourceId.includes('/')) {
      const segments = resourceId.split('/').filter(Boolean)
      return segments[segments.length - 1] ?? resourceId.slice(0, 8)
    }
    return resourceId.slice(0, 8)
  }, [resourceId])
  const isFolder = currentNode?.node_type === 'folder'
  const isMissing = !isNodeMapLoading && !treeNode
  const shouldPreview = isPreviewEnabled && !isFolder && !isMissing
  const displayName = currentNode?.name ?? fallbackName
  const iconType = !isFolder && currentNode
    ? getFileIconType(currentNode?.name || '', currentNode?.extension)
    : null
  const pathForTooltip = (currentNode?.path ?? (resourceId.includes('/') ? resourceId : undefined))?.slice(1) // remove leading slash for better display
  const missingMessage = isFolder
    ? t('skillEditor.folderNotFound', { ns: 'workflow' })
    : t('skillEditor.fileNotFound', { ns: 'workflow' })
  const tooltipContent = isMissing
    ? (
        <div className="space-y-1">
          <div className="text-text-secondary system-xs-medium">{missingMessage}</div>
          {pathForTooltip && (
            <div>{pathForTooltip}</div>
          )}
        </div>
      )
    : (<div className="text-text-secondary system-xs-medium">{pathForTooltip ?? displayName}</div>)

  const handleSelect = useCallback((node: TreeNodeData) => {
    editor.update(() => {
      const targetNode = $getNodeByKey(nodeKey)
      if (targetNode?.getType() === 'file-reference-block') {
        const fileNode = targetNode as LexicalNode & { setResourceId?: (resourceId: string) => void }
        fileNode.setResourceId?.(node.id)
      }
    })
    setOpen(false)
  }, [editor, nodeKey])

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const handlePreviewEnter = useCallback(() => {
    clearCloseTimer()
    setPreviewOpen(true)
  }, [clearCloseTimer])

  const handlePreviewLeave = useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      setPreviewOpen(false)
    }, 120)
  }, [clearCloseTimer])

  useEffect(() => {
    return () => {
      clearCloseTimer()
    }
  }, [clearCloseTimer])

  const updatePreviewPosition = useCallback(() => {
    const anchor = ref.current?.closest('[data-workflow-node-panel="true"]') as HTMLElement | null
      || ref.current?.closest('[data-prompt-editor-panel="true"]') as HTMLElement | null
      || ref.current?.closest('[data-skill-editor-root="true"]') as HTMLElement | null
    if (!anchor)
      return
    const rect = anchor.getBoundingClientRect()
    const width = 400
    const gap = 4
    const left = Math.max(8, rect.left - gap - width)
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setPreviewStyle(_prev => ({
      position: 'fixed',
      top: rect.top,
      left,
      height: rect.height,
    }))
  }, [ref])

  useEffect(() => {
    if (!previewOpen || !shouldPreview)
      return
    updatePreviewPosition()
    const handleUpdate = () => updatePreviewPosition()
    window.addEventListener('scroll', handleUpdate, true)
    window.addEventListener('resize', handleUpdate)
    const anchor = ref.current?.closest('[data-skill-editor-root="true"]') as HTMLElement | null
    const resizeObserver = anchor ? new ResizeObserver(handleUpdate) : null
    if (anchor && resizeObserver)
      resizeObserver.observe(anchor)
    return () => {
      window.removeEventListener('scroll', handleUpdate, true)
      window.removeEventListener('resize', handleUpdate)
      resizeObserver?.disconnect()
    }
  }, [previewOpen, ref, shouldPreview, updatePreviewPosition])

  const fileBlock = (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      offset={4}
    >
      <PortalToFollowElemTrigger ref={ref} className="inline-flex">
        <Tooltip popupContent={tooltipContent} disabled={!tooltipContent}>
          <span
            className={cn(
              'inline-flex min-w-[18px] select-none items-center gap-[2px] overflow-hidden rounded-[5px] border py-[1px] pl-[1px] pr-[4px] shadow-xs',
              isInteractive ? 'cursor-pointer' : 'cursor-default',
              isMissing ? 'border-state-warning-active bg-state-warning-hover' : 'border-state-accent-hover-alt bg-state-accent-hover',
              isSelected && 'border-text-accent',
            )}
            onMouseDown={() => {
              if (!isInteractive)
                return
              setOpen(prev => !prev)
            }}
          >
            <span className="flex items-center justify-center p-px">
              {isFolder
                ? <span className={cn('i-ri-folder-line size-[14px]', isMissing ? 'text-text-warning' : 'text-text-accent')} aria-hidden="true" />
                : (
                    <FileTypeIcon
                      type={(iconType || 'document') as FileAppearanceType}
                      size="sm"
                      className={cn('!size-[14px]', isMissing && '!text-text-warning')}
                    />
                  )}
            </span>
            <span className={cn('max-w-[180px] truncate text-[12px] font-medium leading-4', isMissing ? 'text-text-warning' : 'text-text-accent')}>
              {displayName}
            </span>
            {
              isMissing && (
                <span className="i-ri-alert-fill size-3 text-text-warning" />
              )
            }
          </span>
        </Tooltip>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1000]">
        <FilePickerPanel
          onSelectNode={handleSelect}
          focusNodeId={resourceId}
        />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )

  if (!shouldPreview)
    return fileBlock

  return (
    <>
      <span
        className="inline-flex"
        onMouseEnter={handlePreviewEnter}
        onMouseLeave={handlePreviewLeave}
      >
        {fileBlock}
      </span>
      {previewOpen && previewStyle && typeof document !== 'undefined' && createPortal(
        <div
          className="z-[1001]"
          style={previewStyle}
          onMouseEnter={handlePreviewEnter}
          onMouseLeave={handlePreviewLeave}
        >
          <FilePreviewPanel
            resourceId={resourceId}
            currentNode={currentNode}
            onClose={() => setPreviewOpen(false)}
          />
        </div>,
        document.body,
      )}
    </>
  )
}

export default React.memo(FileReferenceBlock)
