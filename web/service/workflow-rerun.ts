import { get, post } from './base'

export type RerunVariableGroupName = 'ancestor_node_outputs'
  | 'start_node_variables'
  | 'environment_variables'

export type RerunVariableItem = {
  selector: string[]
  value_type: string
  value?: unknown
  required: boolean | null
  declared_type: string | null
  masked: boolean
}

export type RerunVariableGroup = {
  group: RerunVariableGroupName
  variables: RerunVariableItem[]
}

export type GetRerunVariablesResponse = {
  source_workflow_run_id: string
  target_node_id: string
  groups: RerunVariableGroup[]
}

export type RerunOverride = {
  selector: string[]
  value: unknown
}

export type PostRerunRequest = {
  target_node_id: string
  overrides: RerunOverride[]
  streaming: true
}

export const fetchWorkflowRerunVariables = (
  appId: string,
  sourceRunId: string,
  nodeId: string,
) => {
  return get<GetRerunVariablesResponse>(
    `/apps/${appId}/workflow-runs/${sourceRunId}/rerun/nodes/${nodeId}`,
  )
}

export const postWorkflowRerun = (
  appId: string,
  sourceRunId: string,
  body: PostRerunRequest,
) => {
  return post<Response>(
    `/apps/${appId}/workflow-runs/${sourceRunId}/rerun`,
    { body },
    { needAllResponseContent: true, silent: true },
  )
}
