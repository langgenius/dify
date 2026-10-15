import type { EditorResource } from './resource'
import { atom } from 'jotai'
import { atomWithLazy } from 'jotai/utils'
import { isWorkflowAppMode } from '@/app/components/apps/app-type'
import { consoleQuery } from '@/service/console'
import { atomWithResolvedSuspenseQuery } from '@/utils/query-atoms'
import { isChatflow } from './resource'

export type EditorIdentity =
  | Readonly<{ kind: 'app'; appId: string }>
  | Readonly<{ kind: 'knowledge-pipeline'; pipelineId: string }>
  | Readonly<{ kind: 'snippet'; snippetId: string }>

export const editorIdentityStateAtom = atomWithLazy<EditorIdentity>(() => {
  throw new Error('EditorResourceScope is required for the workflow editor')
})

export const editorResourceKindAtom = atom((get) => get(editorIdentityStateAtom).kind)
export const editorAppIdAtom = atom((get) => {
  const identity = get(editorIdentityStateAtom)
  return identity.kind === 'app' ? identity.appId : undefined
})
export const editorPipelineIdAtom = atom((get) => {
  const identity = get(editorIdentityStateAtom)
  return identity.kind === 'knowledge-pipeline' ? identity.pipelineId : undefined
})

// The app entrypoint resolves this query before mounting its editor session.
const editorAppQueryAtom = atomWithResolvedSuspenseQuery((get) => {
  const identity = get(editorIdentityStateAtom)
  if (identity.kind !== 'app') throw new Error('App details require an app editor')
  return consoleQuery.apps.byAppId.get.queryOptions({
    input: { params: { app_id: identity.appId } },
  })
})
const appModeAtom = atom((get) => get(editorAppQueryAtom).data.mode)

export const editorAppNameAtom = atom((get) =>
  get(editorResourceKindAtom) === 'app' ? get(editorAppQueryAtom).data.name : undefined,
)

export const editorResourceAtom = atom<EditorResource>((get) => {
  const identity = get(editorIdentityStateAtom)
  if (identity.kind !== 'app') return identity
  const mode = get(appModeAtom)
  if (!isWorkflowAppMode(mode)) throw new Error('This app does not have a workflow editor')
  return { ...identity, mode }
})
export const isChatflowAtom = atom((get) => isChatflow(get(editorResourceAtom)))

export const workflowAppIdentityAtom = atom((get) => {
  const identity = get(editorIdentityStateAtom)
  if (identity.kind !== 'app') throw new Error('This operation requires a workflow app editor')
  return identity
})

export const knowledgePipelineIdentityAtom = atom((get) => {
  const identity = get(editorIdentityStateAtom)
  if (identity.kind !== 'knowledge-pipeline')
    throw new Error('This operation requires a knowledge pipeline editor')
  return identity
})

export const snippetIdentityAtom = atom((get) => {
  const identity = get(editorIdentityStateAtom)
  if (identity.kind !== 'snippet') throw new Error('This operation requires a snippet editor')
  return identity
})
