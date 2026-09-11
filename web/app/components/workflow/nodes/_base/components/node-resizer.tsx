import type { OnResize } from 'reactflow'
import type { CommonNodeType } from '../../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { memo, useCallback, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { NodeResizeControl, useReactFlow } from 'reactflow'
import { getKeyboardResizeValue } from '@/app/components/base/resize-handle/keyboard'
import { ITERATION_PADDING, LOOP_PADDING } from '../../../constants'
import { useNodesInteractions } from '../../../hooks/use-nodes-interactions'
import { useNodesReadOnly } from '../../../hooks/use-workflow'
import { BlockEnum } from '../../../types'

const Icon = () => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M5.19009 11.8398C8.26416 10.6196 10.7144 8.16562 11.9297 5.08904"
        stroke="black"
        strokeOpacity="0.16"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

type NodeResizerProps = {
  nodeId: string
  nodeData: CommonNodeType
  icon?: React.JSX.Element
  minWidth?: number
  minHeight?: number
  maxWidth?: number
}
const NodeResizer = ({
  nodeId,
  nodeData,
  icon = <Icon />,
  minWidth = 258,
  minHeight = 152,
  maxWidth,
}: NodeResizerProps) => {
  const { t } = useTranslation('common')
  const descriptionId = useId()
  const didDragRef = useRef(false)
  const { getNode, getNodes } = useReactFlow<CommonNodeType>()
  const { nodesReadOnly } = useNodesReadOnly()
  const { handleNodeResize } = useNodesInteractions()

  const handleResize = useCallback<OnResize>(
    (_, params) => {
      didDragRef.current = true
      handleNodeResize(nodeId, params)
    },
    [nodeId, handleNodeResize],
  )

  const resizeWithKeyboard = (
    event: Pick<React.KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>,
  ) => {
    if (nodesReadOnly) return false
    const node = getNode(nodeId)
    if (!node) return false

    const padding = node.data.type === BlockEnum.Iteration ? ITERATION_PADDING : LOOP_PADDING
    const children = getNodes().filter((child) =>
      node.data._children?.some(({ nodeId }) => nodeId === child.id),
    )
    const requiredWidth = Math.max(
      minWidth,
      ...children.map(
        (child) => child.position.x + (child.width ?? child.data.width ?? 0) + padding.right,
      ),
    )
    const requiredHeight = Math.max(
      minHeight,
      ...children.map(
        (child) => child.position.y + (child.height ?? child.data.height ?? 0) + padding.bottom,
      ),
    )
    const width = node.data.width ?? node.width ?? minWidth
    const height = node.data.height ?? node.height ?? minHeight
    const nextWidth = getKeyboardResizeValue(event, {
      side: 'right',
      value: width,
      min: requiredWidth,
      max: maxWidth,
    })
    const nextHeight = getKeyboardResizeValue(event, {
      side: 'bottom',
      value: height,
      min: requiredHeight,
    })
    if (nextWidth === undefined && nextHeight === undefined) return false
    handleNodeResize(nodeId, {
      ...node.position,
      width: nextWidth ?? width,
      height: nextHeight ?? height,
      direction: [nextWidth === undefined ? 0 : 1, nextHeight === undefined ? 0 : 1],
    })
    return true
  }

  if (nodesReadOnly) return null

  return (
    <div
      className={cn(
        'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
        nodeData.selected && 'pointer-events-auto opacity-100',
      )}
    >
      <NodeResizeControl
        nodeId={nodeId}
        position="bottom-right"
        className="border-none! bg-transparent!"
        onResize={handleResize}
        onResizeStart={() => {
          didDragRef.current = false
        }}
        minWidth={minWidth}
        minHeight={minHeight}
        maxWidth={maxWidth}
      >
        <IconButton
          aria-label={t(($) => $['resize.node'])}
          aria-describedby={descriptionId}
          className="nodrag nopan absolute right-px bottom-px"
          onClick={(event) => {
            event.stopPropagation()
            if (event.detail > 0 && didDragRef.current) {
              didDragRef.current = false
              return
            }
            didDragRef.current = false
            resizeWithKeyboard({
              key: 'Home',
              shiftKey: false,
              altKey: false,
              ctrlKey: false,
              metaKey: false,
            })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
            if (!resizeWithKeyboard(event)) return
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <span aria-hidden="true">{icon}</span>
        </IconButton>
      </NodeResizeControl>
      <span id={descriptionId} className="sr-only" aria-live="polite">
        {t(($) => $['resize.size'], {
          width: Math.round(nodeData.width ?? minWidth),
          height: Math.round(nodeData.height ?? minHeight),
        })}{' '}
        {t(($) => $['resize.nodeHelp'])}
      </span>
    </div>
  )
}

export default memo(NodeResizer)
