import type { HumanInputV2NodeType } from './types'
import type { NodePanelProps, Var } from '@/app/components/workflow/types'
import * as React from 'react'
import Divider from '@/app/components/base/divider'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import HumanInputSharedPanelSections from '@/app/components/workflow/nodes/human-input/shared/panel-sections'
import { VarType } from '@/app/components/workflow/types'
import DebugMode from './components/debug-mode'
import MessageTemplate from './components/message-template'
import Recipients from './components/recipients'
import useHumanInputV2Config from './use-config'

export const HumanInputV2Panel = ({ id, data }: NodePanelProps<HumanInputV2NodeType>) => {
  const config = useHumanInputV2Config(id, data)
  const { availableVars, availableNodesWithParent } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: (variable: Var) =>
      [VarType.string, VarType.number, VarType.secret, VarType.arrayString].includes(variable.type),
  })

  return (
    <div className="py-2">
      <Recipients
        nodeId={id}
        value={config.inputs.recipients_spec}
        onChange={config.handleRecipientsChange}
        readonly={config.readOnly}
      />
      <div className="px-4 py-2">
        <Divider className="my-0! h-px! bg-divider-subtle!" />
      </div>
      <MessageTemplate
        nodeId={id}
        value={config.inputs.message_template}
        onChange={config.handleMessageTemplateChange}
        readonly={config.readOnly}
        availableVars={availableVars}
        availableNodes={availableNodesWithParent}
      />
      <DebugMode
        value={config.inputs.debug_mode}
        onChange={config.handleDebugModeChange}
        readonly={config.readOnly}
      />
      <div className="px-4 py-2">
        <Divider className="my-0! h-px! bg-divider-subtle!" />
      </div>
      <HumanInputSharedPanelSections id={id} config={config} />
    </div>
  )
}

export default React.memo(HumanInputV2Panel)
