import { describe, expect, it } from 'vite-plus/test'
import { agentSoulConfigToFormState, formStateToAgentSoulConfig } from '../conversions'
import { defaultAgentSoulConfigFormState } from '../form-state'
import { validateKnowledgeRetrievals } from '../knowledge-validation'

const binding = {
  id: 'docs',
  controlSpaceId: '00000000-0000-4000-8000-000000000001',
  name: 'Product manual',
  description: 'Product questions',
  isMissing: false,
}
describe('KnowledgeFS configuration round trip', () => {
  it('preserves IDs, aliases and provenance across save and snapshot load', () => {
    const config = formStateToAgentSoulConfig({
      formState: { ...defaultAgentSoulConfigFormState, knowledgeRetrievals: [binding] },
    })
    expect(config.knowledge).toEqual({
      sets: [],
      spaces: [
        {
          id: 'docs',
          control_space_id: binding.controlSpaceId,
          name: binding.name,
          description: binding.description,
          is_missing: false,
        },
      ],
    })
    expect(agentSoulConfigToFormState(config).knowledgeRetrievals).toEqual([binding])
    expect(validateKnowledgeRetrievals([binding]).isValid).toBe(true)
  })
  it('retains imported unresolved bindings and rejects duplicate spaces or aliases', () => {
    const unresolved = { ...binding, isMissing: true }
    const config = formStateToAgentSoulConfig({
      formState: { ...defaultAgentSoulConfigFormState, knowledgeRetrievals: [unresolved] },
    })
    expect(agentSoulConfigToFormState(config).knowledgeRetrievals[0]?.isMissing).toBe(true)
    expect(validateKnowledgeRetrievals([unresolved]).isValid).toBe(false)
    expect(
      validateKnowledgeRetrievals([binding, { ...binding, id: 'other', name: 'other' }]).isValid,
    ).toBe(false)
    expect(
      validateKnowledgeRetrievals([
        binding,
        { ...binding, id: 'other', controlSpaceId: '00000000-0000-4000-8000-000000000002' },
      ]).isValid,
    ).toBe(false)
  })
})
