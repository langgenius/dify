import type { CurrentVarInInspect } from './types'
import type { VarInInspect } from '@/types/workflow'
import { VarInInspectType } from '@/types/workflow'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import { useNodesInteractions } from '../hooks/use-nodes-interactions'
import { useStore } from '../store'
import Group from './group'

type Props = {
  currentNodeVar?: CurrentVarInInspect
  handleVarSelect: (state: CurrentVarInInspect) => void
}

const Left = ({
  currentNodeVar,
  handleVarSelect,
}: Props) => {
  const environmentVariables = useStore(s => s.environmentVariables)
  const setCurrentFocusNodeId = useStore(s => s.setCurrentFocusNodeId)

  const {
    conversationVars,
    systemVars,
    nodesWithInspectVars,
    deleteNodeInspectorVars,
  } = useCurrentVars()
  const { handleNodeSelect } = useNodesInteractions()

  const visibleNodesWithInspectVars = nodesWithInspectVars.filter(node => !node.isHidden)

  const showDivider = environmentVariables.length > 0 || conversationVars.length > 0 || systemVars.length > 0

  const handleClearNode = (nodeId: string) => {
    deleteNodeInspectorVars(nodeId)
    setCurrentFocusNodeId('')
  }

  return (
    <div className="py-1">
      {environmentVariables.length > 0 && (
        <Group
          varType={VarInInspectType.environment}
          varList={environmentVariables as VarInInspect[]}
          currentVar={currentNodeVar}
          handleSelect={handleVarSelect}
        />
      )}
      {conversationVars.length > 0 && (
        <Group
          varType={VarInInspectType.conversation}
          varList={conversationVars}
          currentVar={currentNodeVar}
          handleSelect={handleVarSelect}
        />
      )}
      {systemVars.length > 0 && (
        <Group
          varType={VarInInspectType.system}
          varList={systemVars}
          currentVar={currentNodeVar}
          handleSelect={handleVarSelect}
        />
      )}
      {showDivider && (
        <div className="px-4 py-1">
          <div className="h-px bg-divider-subtle"></div>
        </div>
      )}
      {visibleNodesWithInspectVars.length > 0 && visibleNodesWithInspectVars.map(group => (
        <Group
          key={group.nodeId}
          varType={VarInInspectType.node}
          varList={group.vars}
          nodeData={group}
          currentVar={currentNodeVar}
          handleSelect={handleVarSelect}
          handleView={() => handleNodeSelect(group.nodeId, false, true)}
          handleClear={() => handleClearNode(group.nodeId)}
        />
      ))}
    </div>
  )
}

export default Left
