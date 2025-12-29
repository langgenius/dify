import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import MultipleToolSelector from '@/app/components/plugins/plugin-detail-panel/multiple-tool-selector'
import { BoxGroup } from '@/app/components/workflow/nodes/_base/components/layout'
import MaxIterations from './max-iterations'
import { useNodeTools } from './use-node-tools'

const i18nPrefix = 'workflow.nodes.llm'

type ToolsProps = {
  nodeId: string
  tools?: ToolValue[]
  maxIterations?: number
}
const Tools = ({
  nodeId,
  tools = [],
  maxIterations = 10,
}: ToolsProps) => {
  const { t } = useTranslation()
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
      <MultipleToolSelector
        nodeId={nodeId}
        nodeOutputVars={[]}
        availableNodes={[]}
        value={tools}
        label={t(`${i18nPrefix}.tools.title`)}
        tooltip={t(`${i18nPrefix}.tools.title`)}
        onChange={handleToolsChange}
        supportCollapse
      />
      <MaxIterations
        value={maxIterations}
        onChange={handleMaxIterationsChange}
      />
    </BoxGroup>
  )
}

export default memo(Tools)
