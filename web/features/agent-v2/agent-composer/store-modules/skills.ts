import type { AgentSkill } from '../form-state'
import type { DraftFieldUpdate } from './utils'
import { atom } from 'jotai'
import { syncSkillReferenceLabels } from '../reference-labels'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export const agentComposerSkillsAtom = atom<AgentSkill[], [DraftFieldUpdate<AgentSkill[]>], void>(
  get => get(agentComposerDraftAtom).skills,
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
