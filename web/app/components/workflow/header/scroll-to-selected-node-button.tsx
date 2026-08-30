import type { FC } from 'react'
import type { CommonNodeType } from '../types'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import { scrollToWorkflowNode } from '../utils/node-navigation'

const ScrollToSelectedNodeButton: FC = () => {
  const { t } = useTranslation()
  const nodes = useNodes<CommonNodeType>()
  const selectedNode = nodes.find((node) => node.data.selected)
  const label = t(($) => $['panel.scrollToSelectedNode'], { ns: 'workflow' })

  if (!selectedNode) return null

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <IconButton
            aria-label={label}
            variant="secondary"
            size="lg"
            onClick={() => scrollToWorkflowNode(selectedNode.id)}
          >
            <span aria-hidden="true" className="i-ri-focus-3-line size-4" />
          </IconButton>
        }
      />
      <TooltipContent className="rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg px-3 py-1.5 system-xs-medium text-text-secondary shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export default ScrollToSelectedNodeButton
