import { LoroDoc, UndoManager } from 'loro-crdt'
import {
  changeDraftData,
  changeDraftEntities,
  projectDraftGraph,
  setDraftViewport,
} from './loro-draft-document'
import { LoroDraftProvider } from './loro-draft-provider'

export const crdtRuntime = {
  LoroDoc,
  UndoManager,
  LoroDraftProvider,
  changeDraftData,
  changeDraftEntities,
  projectDraftGraph,
  setDraftViewport,
}
