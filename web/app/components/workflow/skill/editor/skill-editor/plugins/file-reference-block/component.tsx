import type { LexicalNode } from 'lexical'
import type { FC } from 'react'
import type { FileAppearanceType } from '@/app/components/base/file-uploader/types'
import type { TreeNodeData } from '@/app/components/workflow/skill/type'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RiFolderLine } from '@remixicon/react'
import { $getNodeByKey } from 'lexical'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
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

type FileReferenceBlockProps = {
  nodeKey: string
  resourceId: string
}

const FileReferenceBlock: FC<FileReferenceBlockProps> = ({ nodeKey, resourceId }) => {
  const [editor] = useLexicalComposerContext()
  const [ref, isSelected] = useSelectOrDelete(nodeKey)
  const { data: nodeMap } = useSkillAssetNodeMap()
  const [open, setOpen] = useState(false)

  const currentNode = useMemo(() => nodeMap?.get(resourceId), [nodeMap, resourceId])
  const isFolder = currentNode?.node_type === 'folder'
  const displayName = currentNode?.name ?? resourceId
  const iconType = !isFolder && currentNode ? getFileIconType(currentNode.name) : null
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

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      offset={4}
    >
      <PortalToFollowElemTrigger asChild ref={ref}>
        <span
          className={cn(
            'inline-flex min-w-[18px] cursor-pointer select-none items-center gap-[2px] overflow-hidden rounded-[5px] border border-state-accent-hover-alt bg-state-accent-hover py-[1px] pl-[1px] pr-[4px] shadow-xs',
            isSelected && 'border-text-accent',
          )}
          title={title}
          onMouseDown={() => setOpen(prev => !prev)}
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
          syncExpandedState={false}
        />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default React.memo(FileReferenceBlock)
