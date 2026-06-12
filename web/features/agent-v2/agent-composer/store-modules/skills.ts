import type { AgentSkill } from '../../agent-detail/configure/components/orchestrate/skills/item'
import type { DraftFieldUpdate } from './utils'
import { atom, useAtom, useSetAtom } from 'jotai'
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

export function useSkills() {
  const [skills, setSkills] = useAtom(agentComposerSkillsAtom)
  return [skills, setSkills] as const
}

export function useRemoveSkill() {
  const setDraft = useSetAtom(agentComposerDraftAtom)
  return useCallback((skillId: string) => {
    setDraft(draft => ({
      ...draft,
      skills: draft.skills.filter(skill => skill.id !== skillId),
    }))
  }, [setDraft])
}
