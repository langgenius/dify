import type { DeclaredOutputConfig, DeclaredOutputType, WorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { TFunction } from 'i18next'
import type { AgentRosterNodeData } from '../../block-selector/types'

const i18nPrefix = 'nodes.agent'

export const defaultDeclaredOutputs = [
  {
    name: 'text',
    type: 'string',
  },
  {
    name: 'files',
    type: 'array',
    array_item: { type: 'file' },
  },
  {
    name: 'json',
    type: 'object',
  },
] satisfies DeclaredOutputConfig[]

function formatOutputType(type: DeclaredOutputType, arrayItemType?: DeclaredOutputType): string {
  if (type === 'array')
    return `Array[${formatOutputType(arrayItemType ?? 'object')}]`

  return {
    boolean: 'Boolean',
    file: 'File',
    number: 'Number',
    object: 'Object',
    string: 'String',
  }[type]
}

function getDefaultOutputDescription(name: string, t: TFunction) {
  switch (name) {
    case 'files':
      return t(`${i18nPrefix}.outputVars.files.title`, { ns: 'workflow' })
    case 'json':
      return t(`${i18nPrefix}.outputVars.json`, { ns: 'workflow' })
    case 'text':
      return t(`${i18nPrefix}.outputVars.text`, { ns: 'workflow' })
    default:
      return ''
  }
}

export function outputToVarItem(output: DeclaredOutputConfig, t: TFunction) {
  return {
    description: output.description ?? getDefaultOutputDescription(output.name, t),
    name: output.name,
    type: formatOutputType(output.type, output.array_item?.type),
  }
}

export function getRosterAgentFromComposer(
  composerData: WorkflowAgentComposerResponse | undefined,
  graphAgent: AgentRosterNodeData | undefined,
): AgentRosterNodeData | undefined {
  if (!composerData)
    return graphAgent

  if (!composerData.binding)
    return graphAgent

  if (composerData.binding.binding_type !== 'roster_agent' || !composerData.agent)
    return undefined

  const graphIcon = graphAgent?.id === composerData.agent.id ? graphAgent : undefined

  return {
    description: composerData.agent.description,
    icon: graphIcon?.icon,
    icon_background: graphIcon?.icon_background,
    icon_type: graphIcon?.icon_type,
    id: composerData.agent.id,
    name: composerData.agent.name,
  }
}
