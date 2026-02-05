import type { LexicalNode } from 'lexical'
import type { FileAppearanceType } from '@/app/components/base/file-uploader/types'
import type { TreeNodeData } from '@/app/components/workflow/skill/type'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RiFolderLine } from '@remixicon/react'
import { $getNodeByKey } from 'lexical'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import FileTypeIcon from '@/app/components/base/file-uploader/file-type-icon'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useSelectOrDelete } from '@/app/components/base/prompt-editor/hooks'
import { useSkillAssetNodeMap } from '@/app/components/workflow/skill/hooks/use-skill-asset-tree'
import { getFileIconType } from '@/app/components/workflow/skill/utils/file-utils'
import { cn } from '@/utils/classnames'
import { FilePickerPanel } from '../file-picker-panel'
import FilePreviewPanel from './file-preview-panel'
import { useFilePreviewContext } from './preview-context'

type FileReferenceBlockProps = {
  nodeKey: string
  resourceId: string
}

const FileReferenceBlock = ({ nodeKey, resourceId }: FileReferenceBlockProps) => {
  const [editor] = useLexicalComposerContext()
  const [ref, isSelected] = useSelectOrDelete(nodeKey)
  const { data: nodeMap } = useSkillAssetNodeMap()
  const [open, setOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewStyle, setPreviewStyle] = useState<React.CSSProperties | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { enabled: isPreviewEnabled } = useFilePreviewContext()
  const isInteractive = editor.isEditable()

  const currentNode = useMemo(() => nodeMap?.get(resourceId), [nodeMap, resourceId])
  const isFolder = currentNode?.node_type === 'folder'
  const displayName = currentNode?.name ?? resourceId
  const iconType = !isFolder && currentNode ? getFileIconType(currentNode.name, currentNode.extension) : null
  const title = currentNode?.path ?? displayName

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
    if (!previewOpen || !isPreviewEnabled)
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
  }, [isPreviewEnabled, previewOpen, ref, updatePreviewPosition])

  const fileBlock = (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      offset={4}
    >
      <PortalToFollowElemTrigger asChild ref={ref}>
        <span
          className={cn(
            'inline-flex min-w-[18px] select-none items-center gap-[2px] overflow-hidden rounded-[5px] border border-state-accent-hover-alt bg-state-accent-hover py-[1px] pl-[1px] pr-[4px] shadow-xs',
            isInteractive ? 'cursor-pointer' : 'cursor-default',
            isSelected && 'border-text-accent',
          )}
          title={title}
          onMouseDown={() => {
            if (!isInteractive)
              return
            setOpen(prev => !prev)
          }}
        >
          <span className="flex items-center justify-center p-px">
            {isFolder
              ? <RiFolderLine className="size-[14px] text-text-accent" aria-hidden="true" />
              : (
                  <FileTypeIcon
                    type={(iconType || 'document') as FileAppearanceType}
                    size="sm"
                    className="!size-[14px]"
                  />
                )}
          </span>
          <span className="max-w-[180px] truncate text-[12px] font-medium leading-4 text-text-accent">
            {displayName}
          </span>
        </span>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1000]">
        <FilePickerPanel
          onSelectNode={handleSelect}
          focusNodeId={resourceId}
        />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )

  if (!isPreviewEnabled)
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
