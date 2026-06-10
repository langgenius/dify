import type { NodePanelProps } from '../../types'
import type { AgentNodeType } from './types'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import OutputVars, { VarItem } from '../_base/components/output-vars'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { AgentRosterField } from './components/agent-roster-field'
import { AgentTaskField } from './components/agent-task-field'

const i18nPrefix = 'nodes.agent'

export function AgentPanel({
  id,
  data,
}: NodePanelProps<AgentNodeType>) {
  const { t } = useTranslation()
  const { inputs, setInputs } = useNodeCrud<AgentNodeType>(id, data)

  const handleTaskChange = useCallback((value: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.agent_task = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return (
    <div className="my-2">
      <AgentRosterField agent={inputs.agent_roster} />
      <AgentTaskField
        id={id}
        data={inputs}
        onChange={handleTaskChange}
      />
      <div>
        <OutputVars>
          <VarItem
            name="text"
            type="String"
            description={t(`${i18nPrefix}.outputVars.text`, { ns: 'workflow' })}
          />
          <VarItem
            name="usage"
            type="object"
            description={t(`${i18nPrefix}.outputVars.usage`, { ns: 'workflow' })}
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
