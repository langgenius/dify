import { useStore } from '../store'

export function WorkflowInitializationProbe() {
  const graph = useStore((state) => state.workflowHistory)
  const draftHash = useStore((state) => state.syncWorkflowDraftHash)

  return (
    <>
      <output aria-label="Initialized nodes">
        {graph.nodes.map((node) => `${node.id}:${node.data.title}`).join(',')}
      </output>
      <output aria-label="Initialized edges">
        {graph.edges.map((edge) => `${edge.source}->${edge.target}`).join(',')}
      </output>
      <output aria-label="Draft hash">{draftHash}</output>
    </>
  )
}
