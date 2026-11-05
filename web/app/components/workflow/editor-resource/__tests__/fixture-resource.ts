import type { EditorResource } from '../resource'

type AppResource = Extract<EditorResource, { kind: 'app' }>
export type TestEditorResource =
  | Exclude<EditorResource, AppResource>
  | (Omit<AppResource, 'collaborationEnabled'> & { collaborationEnabled?: boolean })

export function editorResourceForTest(resource: TestEditorResource): EditorResource {
  return resource.kind === 'app'
    ? { ...resource, collaborationEnabled: resource.collaborationEnabled ?? false }
    : resource
}
