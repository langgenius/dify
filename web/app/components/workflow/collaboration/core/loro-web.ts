import type {
  Container,
  LoroDoc as LoroDocShape,
  LoroList as LoroListShape,
  LoroMap as LoroMapShape,
  UndoManager as UndoManagerShape,
  Value,
} from 'loro-crdt'
import {
  LoroDoc as NodeLoroDoc,
  LoroList as NodeLoroList,
  LoroMap as NodeLoroMap,
  UndoManager as NodeUndoManager,
} from 'loro-crdt'
// eslint-disable-next-line antfu/no-import-node-modules-by-path -- loro-crdt does not export a browser-ready wasm entry, so collaboration must target the web bundle file directly.
import initWebLoro, {
  LoroDoc as WebLoroDoc,
  LoroList as WebLoroList,
  LoroMap as WebLoroMap,
  UndoManager as WebUndoManager,
} from '../../../../../node_modules/loro-crdt/web/loro_wasm.js'

const shouldUseWebLoro = typeof window !== 'undefined' && !import.meta.env?.VITEST

export type LoroDocInstance<T extends Record<string, Container> = Record<string, Container>> = LoroDocShape<T>
export type LoroListInstance<T = unknown> = LoroListShape<T>
export type LoroMapInstance<T extends Record<string, unknown> = Record<string, unknown>> = LoroMapShape<T>
export type UndoManagerInstance = UndoManagerShape
export type { Value }

export const LoroDoc = (shouldUseWebLoro ? WebLoroDoc : NodeLoroDoc) as typeof NodeLoroDoc
export const LoroList = (shouldUseWebLoro ? WebLoroList : NodeLoroList) as typeof NodeLoroList
export const LoroMap = (shouldUseWebLoro ? WebLoroMap : NodeLoroMap) as typeof NodeLoroMap
export const UndoManager = (shouldUseWebLoro ? WebUndoManager : NodeUndoManager) as typeof NodeUndoManager

const initLoro = async (): Promise<void> => {
  if (!shouldUseWebLoro)
    return

  await initWebLoro()
}

export default initLoro
