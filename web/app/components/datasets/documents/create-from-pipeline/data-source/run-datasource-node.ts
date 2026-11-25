import type { DatasourceNodeRunPayload } from '@dify/contracts/api/console/rag/types.gen'
import type { StreamCallbacks } from '@/service/event-stream'
import { consoleClient } from '@/service/console'
import { streamEvents } from '@/service/event-stream'

type DatasourceNodeTarget = {
  pipelineId: string | null | undefined
  nodeId: string
  /** Runs the draft workflow when true, the published one otherwise. */
  isInPipeline: boolean
}

/** Streams a datasource node run of the dataset's pipeline. */
export const runDatasourceNode = (
  { pipelineId, nodeId, isInPipeline }: DatasourceNodeTarget,
  body: DatasourceNodeRunPayload,
  callbacks: StreamCallbacks,
) => {
  // The run is requested even before the dataset is loaded, as it always was.
  const params = { pipeline_id: String(pipelineId), node_id: nodeId }
  const workflows = consoleClient.rag.pipelines.byPipelineId.workflows
  streamEvents(
    (options) =>
      isInPipeline
        ? workflows.draft.datasource.nodes.byNodeId.run.post({ params, body }, options)
        : workflows.published.datasource.nodes.byNodeId.run.post({ params, body }, options),
    callbacks,
  )
}
