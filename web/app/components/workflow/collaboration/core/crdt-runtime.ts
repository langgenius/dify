'use client'

import { LoroDoc, UndoManager, VersionVector } from 'loro-crdt'
import * as graphModel from './crdt-graph-model'
import { CRDTProvider } from './crdt-provider'

/**
 * Production code must load this module only through CollaborationManager.connect().
 * Importing Loro, CRDTProvider or the graph model from the manager would evaluate Loro's browser
 * WASM loader on pages that only reference the manager.
 */
export const crdtRuntime = {
  CRDTProvider,
  LoroDoc,
  UndoManager,
  VersionVector,
  graphModel,
}
