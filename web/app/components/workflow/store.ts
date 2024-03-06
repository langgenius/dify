import { create } from 'zustand'
import type { HelpLinePosition } from './help-line/types'
import type {
  CollectionWithExpanded,
  ToolInWorkflow,
  ToolsMap,
} from './block-selector/types'
import { Mode } from './types'

type State = {
  mode: Mode
  runTaskId: string
  showRunHistory: boolean
  showFeaturesPanel: boolean
  isDragging: boolean
  helpLine?: HelpLinePosition
  toolsets: CollectionWithExpanded[]
  toolsMap: ToolsMap
  draftUpdatedAt: number
  publishedAt: number
}

type Action = {
  setMode: (mode: Mode) => void
  setRunTaskId: (runTaskId: string) => void
  setShowRunHistory: (showRunHistory: boolean) => void
  setShowFeaturesPanel: (showFeaturesPanel: boolean) => void
  setIsDragging: (isDragging: boolean) => void
  setHelpLine: (helpLine?: HelpLinePosition) => void
  setToolsets: (toolsets: CollectionWithExpanded[]) => void
  setToolsMap: (toolsMap: Record<string, ToolInWorkflow[]>) => void
  setDraftUpdatedAt: (draftUpdatedAt: number) => void
  setPublishedAt: (publishedAt: number) => void
}

export const useStore = create<State & Action>(set => ({
  mode: Mode.Editing,
  runTaskId: '',
  setRunTaskId: runTaskId => set(() => ({ runTaskId })),
  setMode: mode => set(() => ({ mode })),
  showRunHistory: false,
  setShowRunHistory: showRunHistory => set(() => ({ showRunHistory })),
  showFeaturesPanel: false,
  setShowFeaturesPanel: showFeaturesPanel => set(() => ({ showFeaturesPanel })),
  isDragging: false,
  setIsDragging: isDragging => set(() => ({ isDragging })),
  helpLine: undefined,
  setHelpLine: helpLine => set(() => ({ helpLine })),
  toolsets: [],
  setToolsets: toolsets => set(() => ({ toolsets })),
  toolsMap: {},
  setToolsMap: toolsMap => set(() => ({ toolsMap })),
  draftUpdatedAt: 0,
  setDraftUpdatedAt: draftUpdatedAt => set(() => ({ draftUpdatedAt })),
  publishedAt: 0,
  setPublishedAt: publishedAt => set(() => ({ publishedAt })),
}))
