type FileContentStatusState = {
  kind: 'start' | 'empty' | 'resolving' | 'missing' | 'loading' | 'error'
}

type EditorStateBase = {
  kind: 'editor'
  fileTabId: string
  fileName: string
  content: string
  autoFocus: boolean
  collaborationEnabled: boolean
  onAutoFocus: () => void
}

export type MarkdownEditorState = EditorStateBase & {
  editor: 'markdown'
  onChange: (value: string) => void
}

export type CodeEditorState = EditorStateBase & {
  editor: 'code'
  onChange: (value: string | undefined) => void
}

export type FileEditorState = MarkdownEditorState | CodeEditorState

type MediaPreviewState = {
  kind: 'preview'
  preview: 'media'
  mediaType: 'image' | 'video'
  downloadUrl: string
}

type SQLitePreviewState = {
  kind: 'preview'
  preview: 'sqlite'
  fileTabId: string
  downloadUrl: string
}

type PdfPreviewState = {
  kind: 'preview'
  preview: 'pdf'
  downloadUrl: string
}

type UnsupportedPreviewState = {
  kind: 'preview'
  preview: 'unsupported'
  fileName: string
  fileSize?: number
  downloadUrl: string
}

export type FilePreviewState = MediaPreviewState
  | SQLitePreviewState
  | PdfPreviewState
  | UnsupportedPreviewState

export type FileContentControllerState = FileContentStatusState
  | FileEditorState
  | FilePreviewState
