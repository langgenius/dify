import type { AgentSkill } from '../form-state'
import type { DraftFieldUpdate } from './utils'
import { atom } from 'jotai'
import { syncSkillReferenceLabels } from '../reference-labels'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerSkillsAtom = atom<AgentSkill[], [DraftFieldUpdate<AgentSkill[]>], void>(
  (get) => get(agentComposerDraftAtom).skills,
  (get, set, skillsUpdate: DraftFieldUpdate<AgentSkill[]>) => {
    const draft = get(agentComposerDraftAtom)
    const skills = resolveDraftFieldUpdate(draft.skills, skillsUpdate)

    set(agentComposerDraftAtom, {
      ...draft,
      prompt: syncSkillReferenceLabels({
        prompt: draft.prompt,
        currentSkills: draft.skills,
        nextSkills: skills,
      }),
      skills,
    })
  },
)

export const upsertAgentSkillAtom = atom(null, (_get, set, skill: AgentSkill) => {
  set(agentComposerSkillsAtom, (skills) => [
    ...skills.filter((item) => item.id !== skill.id),
    skill,
  ])
})

export const removeAgentSkillAtom = atom(null, (_get, set, skillId: string) => {
  set(agentComposerSkillsAtom, (skills) => skills.filter((item) => item.id !== skillId))
})
