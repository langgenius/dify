import type { EditorResource } from './resource'
import { atom } from 'jotai'
import { atomWithLazy } from 'jotai/utils'
import { isChatflow } from './resource'

export const editorResourceAtom = atomWithLazy<EditorResource>(() => {
  throw new Error('EditorResourceScope is required for the workflow editor')
})

export const editorResourceKindAtom = atom((get) => get(editorResourceAtom).kind)
export const editorAppIdAtom = atom((get) => {
  const resource = get(editorResourceAtom)
  return resource.kind === 'app' ? resource.appId : undefined
})
export const editorPipelineIdAtom = atom((get) => {
  const resource = get(editorResourceAtom)
  return resource.kind === 'knowledge-pipeline' ? resource.pipelineId : undefined
})

export const isChatflowAtom = atom((get) => isChatflow(get(editorResourceAtom)))

export const workflowAppIdentityAtom = atom((get) => {
  const resource = get(editorResourceAtom)
  if (resource.kind !== 'app') throw new Error('This operation requires a workflow app editor')
  return resource
})

export const knowledgePipelineIdentityAtom = atom((get) => {
  const resource = get(editorResourceAtom)
  if (resource.kind !== 'knowledge-pipeline')
    throw new Error('This operation requires a knowledge pipeline editor')
  return resource
})

export const snippetIdentityAtom = atom((get) => {
  const resource = get(editorResourceAtom)
  if (resource.kind !== 'snippet') throw new Error('This operation requires a snippet editor')
  return resource
})
