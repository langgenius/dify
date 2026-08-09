import type { FC } from 'react'
import type { CommonNodeType } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import { scrollToWorkflowNode } from '../utils/node-navigation'

const ScrollToSelectedNodeButton: FC = () => {
  const { t } = useTranslation()
  const nodes = useNodes<CommonNodeType>()
  const selectedNode = nodes.find((node) => node.data.selected)

  if (!selectedNode) return null

  return (
    <button
      type="button"
      className={cn(
        'flex h-6 cursor-pointer appearance-none items-center justify-center rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-3 system-xs-medium whitespace-nowrap text-text-tertiary shadow-lg backdrop-blur-xs transition-colors duration-200 hover:text-text-accent focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
      )}
      onClick={() => scrollToWorkflowNode(selectedNode.id)}
    >
      {t(($) => $['panel.scrollToSelectedNode'], { ns: 'workflow' })}
    </button>
  )
}

export default ScrollToSelectedNodeButton
