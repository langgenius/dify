import type { EditorResource } from '../../editor-resource/resource'
import type { EnvironmentVariable } from '../../types'
import { consoleClient } from '@/service/console'
import { isLLMEnvironmentVariableValue } from '../../llm-environment-variable'

export async function fetchEnvironmentVariables(
  resource: EditorResource,
): Promise<EnvironmentVariable[]> {
  const workflow = await (() => {
    switch (resource.kind) {
      case 'app':
        return consoleClient.apps.byAppId.workflows.draft.get({
          params: { app_id: resource.appId },
        })
      case 'knowledge-pipeline':
        return consoleClient.rag.pipelines.byPipelineId.workflows.draft.get({
          params: { pipeline_id: resource.pipelineId },
        })
      case 'snippet':
        return consoleClient.snippets.bySnippetId.workflows.draft.get({
          params: { snippet_id: resource.snippetId },
        })
    }
  })()
  return workflow.environment_variables.map((variable) => {
    const { value_type, value } = variable
    if ((value_type === 'string' || value_type === 'secret') && typeof value === 'string')
      return { ...variable, value_type, value }
    if (value_type === 'number' && typeof value === 'number')
      return { ...variable, value_type, value }
    if (value_type === 'llm' && isLLMEnvironmentVariableValue(value))
      return { ...variable, value_type, value }
    throw new Error(`Unsupported environment variable: ${variable.name}`)
  })
}
