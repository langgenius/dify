'use client'

import { LoroDoc, LoroList, LoroMap, UndoManager } from 'loro-crdt'
import { CRDTProvider } from './crdt-provider'

/**
 * Production code must load this module only through CollaborationManager.connect().
 * Importing either Loro or CRDTProvider from the manager would evaluate Loro's browser WASM
 * loader on pages that only reference the manager. CRDTProvider belongs here because it also
 * imports loro-crdt at runtime.
 *
 * TODO: Move graph sync, snapshots, and undo/redo behind an opaque CrdtGraphRuntime interface
 * so CollaborationManager no longer depends on Loro constructors or types.
 */
export const crdtRuntime = {
  CRDTProvider,
  LoroDoc,
  LoroList,
  LoroMap,
  UndoManager,
}
