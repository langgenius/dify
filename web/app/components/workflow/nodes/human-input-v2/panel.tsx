import type { HumanInputV2NodeType } from './types'
import type { NodePanelProps, Var } from '@/app/components/workflow/types'
import { Separator } from '@langgenius/dify-ui/separator'
import { useQuery } from '@tanstack/react-query'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import HumanInputSharedPanelSections from '@/app/components/workflow/nodes/human-input/shared/panel-sections'
import { VarType } from '@/app/components/workflow/types'
import { ENABLE_HITL_IM } from '@/config'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import DebugMode from './components/debug-mode'
import MessageTemplate from './components/message-template'
import Recipients from './components/recipients'
import { HumanInputV2Disabled } from './disabled'
import useHumanInputV2Config from './use-config'

const HumanInputV2PanelContent = ({ id, data }: NodePanelProps<HumanInputV2NodeType>) => {
  const config = useHumanInputV2Config(id, data)
  const { data: email } = useQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.email,
  })
  const { availableVars, availableNodesWithParent } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: (variable: Var) => {
      const supportedVariableTypes: readonly VarType[] = [
        VarType.string,
        VarType.number,
        VarType.secret,
        VarType.arrayString,
      ]
      return supportedVariableTypes.includes(variable.type)
    },
  })

  return (
    <div className="py-2">
      <div className="space-y-1 pb-2">
        <Recipients
          nodeId={id}
          value={config.inputs.recipients_spec}
          onChange={config.handleRecipientsChange}
          readonly={config.readOnly}
          availableNodes={availableNodesWithParent}
        />
        <div className="px-4 py-2">
          <Separator className="my-0 bg-divider-subtle" />
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
          email={email}
          value={config.inputs.debug_mode}
          onChange={config.handleDebugModeChange}
          readonly={config.readOnly}
        />
      </div>
      <div className="px-4 py-2">
        <Separator className="my-0 bg-divider-subtle" />
      </div>
      <HumanInputSharedPanelSections id={id} config={config} />
    </div>
  )
}

export const HumanInputV2Panel = (props: NodePanelProps<HumanInputV2NodeType>) => {
  if (!ENABLE_HITL_IM) return <HumanInputV2Disabled className="mx-4 my-2" />

  return <HumanInputV2PanelContent {...props} />
}
