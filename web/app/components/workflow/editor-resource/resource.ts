import type { WorkflowAppMode } from '@/app/components/apps/app-type'

export type EditorResource =
  | Readonly<{ kind: 'app'; appId: string; mode: WorkflowAppMode }>
  | Readonly<{ kind: 'knowledge-pipeline'; pipelineId: string }>
  | Readonly<{ kind: 'snippet'; snippetId: string }>

export function getEditorResourceId(resource: EditorResource): string {
  switch (resource.kind) {
    case 'app':
      return resource.appId
    case 'knowledge-pipeline':
      return resource.pipelineId
    case 'snippet':
      return resource.snippetId
  }
}

export function isChatflow(resource: EditorResource): boolean {
  return resource.kind === 'app' && resource.mode === 'advanced-chat'
}
