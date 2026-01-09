import type { FC } from 'react'
import type { CommonNodeType } from '../types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import { cn } from '@/utils/classnames'
import { scrollToWorkflowNode } from '../utils/node-navigation'

const ScrollToSelectedNodeButton: FC = () => {
  const { t } = useTranslation()
  const nodes = useNodes<CommonNodeType>()
  const selectedNode = nodes.find(node => node.data.selected)

  const handleScrollToSelectedNode = useCallback(() => {
    if (!selectedNode)
      return
    scrollToWorkflowNode(selectedNode.id)
  }, [selectedNode])

  if (!selectedNode)
    return null

  return (
    <div
      className={cn(
        'system-xs-medium flex h-6 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-3 text-text-tertiary shadow-lg backdrop-blur-sm transition-colors duration-200 hover:text-text-accent',
      )}
      onClick={handleScrollToSelectedNode}
    >
      {t('panel.scrollToSelectedNode', { ns: 'workflow' })}
    </div>
  )
}

export default ScrollToSelectedNodeButton
