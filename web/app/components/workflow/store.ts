import { create } from 'zustand'
import type { HelpLinePosition } from './help-line/types'
import type {
  CollectionWithExpanded,
  ToolInWorkflow,
  ToolsMap,
} from './block-selector/types'

type State = {
  mode: string
  showRunHistory: boolean
  showFeaturesPanel: boolean
  runStaus: string
  isDragging: boolean
  helpLine?: HelpLinePosition
  toolsets: CollectionWithExpanded[]
  toolsMap: ToolsMap
  draftUpdatedAt: number
}

type Action = {
  setShowRunHistory: (showRunHistory: boolean) => void
  setShowFeaturesPanel: (showFeaturesPanel: boolean) => void
  setRunStaus: (runStaus: string) => void
  setIsDragging: (isDragging: boolean) => void
  setHelpLine: (helpLine?: HelpLinePosition) => void
  setToolsets: (toolsets: CollectionWithExpanded[]) => void
  setToolsMap: (toolsMap: Record<string, ToolInWorkflow[]>) => void
  setDraftUpdatedAt: (draftUpdatedAt: number) => void
}

export const useStore = create<State & Action>(set => ({
  mode: 'workflow',
  showRunHistory: false,
  setShowRunHistory: showRunHistory => set(() => ({ showRunHistory })),
  showFeaturesPanel: false,
  setShowFeaturesPanel: showFeaturesPanel => set(() => ({ showFeaturesPanel })),
  runStaus: '',
  setRunStaus: runStaus => set(() => ({ runStaus })),
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
}))
