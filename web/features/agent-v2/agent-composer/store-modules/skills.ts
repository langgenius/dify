import type { AgentSkill } from '../form-state'
import type { DraftFieldUpdate } from './utils'
import { atom, useSetAtom } from 'jotai'
import { useCallback } from 'react'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerSkillsAtom = atom(
  get => get(agentComposerDraftAtom).skills,
  (get, set, skillsUpdate: DraftFieldUpdate<AgentSkill[]>) => {
    const draft = get(agentComposerDraftAtom)

    set(agentComposerDraftAtom, {
      ...draft,
      skills: resolveDraftFieldUpdate(draft.skills, skillsUpdate),
    })
  },
)

export function useRemoveSkill() {
  const setSkills = useSetAtom(agentComposerSkillsAtom)

  return useCallback((skillId: string) => {
    setSkills(skills => skills.filter(skill => skill.id !== skillId))
  }, [setSkills])
}
