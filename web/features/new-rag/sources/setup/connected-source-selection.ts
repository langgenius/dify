import type {
  KnowledgeFsInitialSourcePreviewDocumentResponse,
  KnowledgeFsInitialSourcePreviewFileResponse,
  KnowledgeFsSpaceCreatePayload,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type {
  NewKnowledgeOnlineDocumentsSourceDraft,
  NewKnowledgeOnlineDriveSourceDraft,
} from './source-draft'
export type ConnectedDraft =
  | NewKnowledgeOnlineDocumentsSourceDraft
  | NewKnowledgeOnlineDriveSourceDraft
type InitialSource = NonNullable<KnowledgeFsSpaceCreatePayload['initial_source']>
export type ConnectedInitialSource = Extract<
  InitialSource,
  { kind: 'online_document' | 'online_drive' }
>
type PreviewDocument = KnowledgeFsInitialSourcePreviewDocumentResponse
type PreviewFile = KnowledgeFsInitialSourcePreviewFileResponse
export type PreviewResource =
  | {
      depth: number
      document: PreviewDocument
      key: string
      kind: 'document'
      parentKey?: string
    }
  | { depth: number; file: PreviewFile; key: string; kind: 'file'; parentKey?: string }

export type ConnectedSourceConfigurationBinding = {
  credentialId: string
  datasource: string
  pluginId: string
  provider: string
  providerDisplayName: string
}

export type ConnectedSourceSelection = PreviewResource[]

export function connectedInitialSource(
  draft: ConnectedDraft,
  previewBinding: ConnectedSourceConfigurationBinding,
  parameters: Record<string, boolean | number | string>,
  selectedResources: ConnectedSourceSelection,
  driveTransport: boolean,
): ConnectedInitialSource | undefined {
  const { credentialId, datasource, pluginId, provider, providerDisplayName } = previewBinding
  const name = draft.sourceName.trim()
  if (!name || !selectedResources.length) return undefined
  const binding = {
    credentialId,
    datasource,
    parameters,
    pluginId,
    provider,
    providerDisplayName,
  }
  if (!driveTransport) {
    return {
      ...binding,
      kind: 'online_document',
      name,
      selection: selectedResources.flatMap((resource) =>
        resource.kind === 'document'
          ? [
              {
                lastEditedTime: resource.document.last_edited_time ?? undefined,
                name: resource.document.name,
                pageId: resource.document.page_id,
                providerItemId: resource.document.provider_item_id,
                type: resource.document.type,
                workspaceId: resource.document.workspace_id,
              },
            ]
          : [],
      ),
      ...(draft.syncPolicy === 'custom' && draft.customIntervalSeconds
        ? { custom_interval_seconds: draft.customIntervalSeconds }
        : {}),
      sync_policy: draft.syncPolicy,
    }
  }
  return {
    ...binding,
    kind: 'online_drive',
    name,
    selection: selectedResources.flatMap((resource) =>
      resource.kind === 'file'
        ? [
            {
              bucket: resource.file.bucket ?? undefined,
              id: resource.file.id,
              mimeType: resource.file.mime_type ?? undefined,
              name: resource.file.name,
              providerItemId: resource.file.provider_item_id,
            },
          ]
        : [],
    ),
    ...(draft.syncPolicy === 'custom' && draft.customIntervalSeconds
      ? { custom_interval_seconds: draft.customIntervalSeconds }
      : {}),
    sync_policy: draft.syncPolicy,
  }
}
