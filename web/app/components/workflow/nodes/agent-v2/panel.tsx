import type { NodePanelProps } from '../../types'
import type { AgentV2NodeType } from './types'
import { produce } from 'immer'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import OutputVars, { VarItem } from '../_base/components/output-vars'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { AgentAdvancedSettings } from './components/agent-advanced-settings'
import { AgentRosterField } from './components/agent-roster-field'
import { AgentTaskField } from './components/agent-task-field'

const i18nPrefix = 'nodes.agent'

export function AgentV2Panel({
  id,
  data,
}: NodePanelProps<AgentV2NodeType>) {
  const { t } = useTranslation()
  const { inputs, setInputs } = useNodeCrud<AgentV2NodeType>(id, data)
  const drawerPortalContainerRef = useRef<HTMLDivElement>(null)

  const handleTaskChange = useCallback((value: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.agent_task = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return (
    <div ref={drawerPortalContainerRef} className="pt-2">
      {inputs.agent_roster && (
        <div className="border-b border-divider-subtle">
          <AgentRosterField
            agent={inputs.agent_roster}
            portalContainerRef={drawerPortalContainerRef}
          />
        </div>
      )}
      <div className="border-b border-divider-subtle">
        <AgentTaskField
          id={id}
          data={inputs}
          onChange={handleTaskChange}
        />
      </div>
      <AgentAdvancedSettings />
      <div>
        <OutputVars>
          <VarItem
            name="text"
            type="String"
            description={t(`${i18nPrefix}.outputVars.text`, { ns: 'workflow' })}
          />
          <VarItem
            name="files"
            type="Array[File]"
            description={t(`${i18nPrefix}.outputVars.files.title`, { ns: 'workflow' })}
          />
          <VarItem
            name="json"
            type="Array[Object]"
            description={t(`${i18nPrefix}.outputVars.json`, { ns: 'workflow' })}
          />
        </OutputVars>
      </div>
    </div>
  )
}
