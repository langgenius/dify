declare module 'modern-monaco/editor-core' {
  export type IRange = unknown

  export type IEditorOptions = {
    automaticLayout?: boolean
    readOnly?: boolean
    domReadOnly?: boolean
    minimap?: {
      enabled?: boolean
    }
    wordWrap?: 'off' | 'on' | 'wordWrapColumn' | 'bounded'
    fixedOverflowWidgets?: boolean
    tabFocusMode?: boolean
    [key: string]: unknown
  }

  export type ITextModel = {
    getValue: () => string
    getFullModelRange: () => IRange
    dispose: () => void
  }

  export type IKeyboardEvent = {
    browserEvent: KeyboardEvent
    stopPropagation: () => void
  }

  export type IDisposable = {
    dispose: () => void
  }

  export type IStandaloneCodeEditor = {
    getOption: (option: unknown) => boolean
    setValue: (value: string) => void
    executeEdits: (source: string, edits: Array<{
      range: IRange
      text: string
      forceMoveMarkers?: boolean
    }>) => void
    pushUndoStop: () => void
    onDidChangeModelContent: (listener: () => void) => IDisposable
    onKeyDown: (listener: (event: IKeyboardEvent) => void) => IDisposable
    onDidFocusEditorText: (listener: () => void) => IDisposable
    onDidBlurEditorText: (listener: () => void) => IDisposable
    getValue: () => string
    updateOptions: (options: IEditorOptions) => void
    setModel: (model: ITextModel | null) => void
    layout: () => void
    dispose: () => void
  }

  export const editor: {
    EditorOption: {
      readOnly: unknown
    }
    create: (container: HTMLElement, options?: IEditorOptions) => IStandaloneCodeEditor
    createModel: (value: string, language?: string) => ITextModel
    setTheme: (theme: string) => void
    setModelLanguage: (model: ITextModel, language: string) => void
  }
}

declare module 'modern-monaco' {
  export type InitOptions = {
    defaultTheme: string
    themes: string[]
    langs: string[]
  }

  export const init: (options: InitOptions) => Promise<typeof import('modern-monaco/editor-core') | null>
}
