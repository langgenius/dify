import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import MultipleToolSelector from '@/app/components/plugins/plugin-detail-panel/multiple-tool-selector'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { Node } from 'reactflow'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import { RiHammerLine } from '@remixicon/react'

type Props = {
  tools?: ToolValue[]
  onChange: (tools: ToolValue[]) => void
  readonly?: boolean
  nodeId?: string
  availableVars?: NodeOutPutVar[]
  availableNodes?: Node[]
}

const ToolsConfig: FC<Props> = ({
  tools = [],
  onChange,
  readonly = false,
  nodeId = '',
  availableVars = [],
  availableNodes = [],
}) => {
  const { t } = useTranslation()

  return (
    <Field
      title={
        <div className='flex items-center gap-1'>
          <RiHammerLine className='h-4 w-4 text-gray-500' />
          <span>{t('workflow.nodes.llm.tools')}</span>
        </div>
      }
      operations={
        <div className='text-xs text-gray-500'>
          {t('workflow.nodes.llm.toolsCount', { count: tools.length })}
        </div>
      }
    >
      <MultipleToolSelector
        value={tools}
        onChange={onChange}
        label=""
        nodeOutputVars={availableVars}
        availableNodes={availableNodes}
        nodeId={nodeId}
        disabled={readonly}
        canChooseMCPTool={true}
      />
    </Field>
  )
}

export default memo(ToolsConfig)
