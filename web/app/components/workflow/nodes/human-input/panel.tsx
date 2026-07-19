import type { FC } from 'react'
import type { HumanInputNodeType } from './types'
import type { NodePanelProps, Var } from '@/app/components/workflow/types'
import * as React from 'react'
import Divider from '@/app/components/base/divider'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { VarType } from '@/app/components/workflow/types'
import DeliveryMethod from './components/delivery-method'
import useConfig from './hooks/use-config'
import HumanInputSharedPanelSections from './shared/panel-sections'

const Panel: FC<NodePanelProps<HumanInputNodeType>> = ({ id, data }) => {
  const config = useConfig(id, data)
  const { availableVars, availableNodesWithParent } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) =>
      [VarType.string, VarType.number, VarType.secret, VarType.arrayString].includes(
        varPayload.type,
      ),
  })

  return (
    <div className="py-2">
      <DeliveryMethod
        nodeId={id}
        value={config.inputs.delivery_methods || []}
        formContent={config.inputs.form_content}
        formInputs={config.inputs.inputs}
        nodesOutputVars={availableVars}
        availableNodes={availableNodesWithParent}
        onChange={config.handleDeliveryMethodChange}
        readonly={config.readOnly}
      />
      <div className="px-4 py-2">
        <Divider className="my-0! h-px! bg-divider-subtle!" />
      </div>
      <HumanInputSharedPanelSections id={id} config={config} />
    </div>
  )
}

export default React.memo(Panel)
