import type { EnvVariable } from '../../agent-detail/configure/components/orchestrate/advanced/env'
import type { DraftFieldUpdate } from './utils'
import { atom, useAtom } from 'jotai'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerEnvVariablesAtom = atom(
  get => get(agentComposerDraftAtom).envVariables,
  (get, set, envVariablesUpdate: DraftFieldUpdate<EnvVariable[]>) => {
    const draft = get(agentComposerDraftAtom)

    set(agentComposerDraftAtom, {
      ...draft,
      envVariables: resolveDraftFieldUpdate(draft.envVariables, envVariablesUpdate),
    })
  },
)

export function useEnvVariables() {
  const [envVariables, setEnvVariables] = useAtom(agentComposerEnvVariablesAtom)
  return [envVariables, setEnvVariables] as const
}
