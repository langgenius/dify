import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import MultipleToolSelector from '@/app/components/plugins/plugin-detail-panel/multiple-tool-selector'
import { BoxGroup } from '@/app/components/workflow/nodes/_base/components/layout'
import { cn } from '@/utils/classnames'
import MaxIterations from './max-iterations'
import { useNodeTools } from './use-node-tools'

type ToolsProps = {
  nodeId: string
  tools?: ToolValue[]
  maxIterations?: number
  hideMaxIterations?: boolean
  disabled?: boolean
  disabledTip?: string
}
const Tools = ({
  nodeId,
  tools = [],
  maxIterations = 10,
  hideMaxIterations = false,
  disabled,
  disabledTip,
}: ToolsProps) => {
  const { t } = useTranslation()
  const isDisabled = !!disabled
  const {
    handleToolsChange,
    handleMaxIterationsChange,
  } = useNodeTools(nodeId)

  return (
    <BoxGroup
      boxProps={{
        withBorderBottom: true,
        withBorderTop: true,
      }}
      groupProps={{
        className: 'px-0',
      }}
    >
      <Tooltip
        disabled={!disabledTip}
        popupContent={disabledTip}
      >
        <div className={cn(isDisabled && 'opacity-50')}>
          <div className={cn(isDisabled && 'pointer-events-none')}>
            <MultipleToolSelector
              nodeId={nodeId}
              nodeOutputVars={[]}
              availableNodes={[]}
              value={tools}
              label={t('nodes.llm.tools.title', { ns: 'workflow' })}
              tooltip={t('nodes.llm.tools.title', { ns: 'workflow' })}
              onChange={handleToolsChange}
              supportCollapse
              disabled={isDisabled}
            />
            {!hideMaxIterations && (
              <MaxIterations
                value={maxIterations}
                onChange={handleMaxIterationsChange}
              />
            )}
          </div>
        </div>
      </Tooltip>
    </BoxGroup>
  )
}

export default memo(Tools)
