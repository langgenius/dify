import type { ReasoningConfigValue } from './show-on'
import type { ResourceVarInputs } from '@/app/components/workflow/nodes/_base/types'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import {
  isReasoningConfigShowOnSatisfied,
  isToolSettingShowOnSatisfied,
  reasoningShowOnConditionMet,
  toolSettingShowOnConditionMet,
  valuesEqualForShowOn,
} from './show-on'

describe('plugin tool param show_on helpers', () => {
  describe('valuesEqualForShowOn', () => {
    it('should match strict strings', () => {
      expect(valuesEqualForShowOn('pro', 'pro')).toBe(true)
      expect(valuesEqualForShowOn('free', 'pro')).toBe(false)
    })

    it('should coerce booleans and numbers for YAML string literals', () => {
      expect(valuesEqualForShowOn(true, 'true')).toBe(true)
      expect(valuesEqualForShowOn(false, 'false')).toBe(true)
      expect(valuesEqualForShowOn(42, '42')).toBe(true)
    })
  })

  describe('toolSettingShowOnConditionMet', () => {
    it('should fail when sibling is missing', () => {
      const values: ResourceVarInputs = {}
      expect(toolSettingShowOnConditionMet(values, { variable: 'mode', value: 'pro' })).toBe(false)
    })

    it('should fail when sibling uses variable reference mode', () => {
      const values: ResourceVarInputs = {
        mode: { type: VarKindType.variable, value: ['n', 'x'] },
      }
      expect(toolSettingShowOnConditionMet(values, { variable: 'mode', value: 'pro' })).toBe(false)
    })

    it('should pass when constant sibling matches', () => {
      const values: ResourceVarInputs = {
        mode: { type: VarKindType.constant, value: 'pro' },
      }
      expect(toolSettingShowOnConditionMet(values, { variable: 'mode', value: 'pro' })).toBe(true)
    })

    it('should unwrap double-wrapped FormValueInput in sibling.value', () => {
      const values: ResourceVarInputs = {
        mode: {
          type: VarKindType.constant,
          value: { type: VarKindType.constant, value: 'pro' },
        },
      }
      expect(toolSettingShowOnConditionMet(values, { variable: 'mode', value: 'pro' })).toBe(true)
    })

    it('should not reveal a setting when a persisted nested value is a variable reference', () => {
      const values: ResourceVarInputs = {
        mode: {
          type: VarKindType.constant,
          value: { type: VarKindType.variable, value: ['node', 'mode'] },
        },
      }
      expect(toolSettingShowOnConditionMet(values, { variable: 'mode', value: 'pro' })).toBe(false)
    })
  })

  describe('isToolSettingShowOnSatisfied', () => {
    it('should show an unconditional setting', () => {
      expect(isToolSettingShowOnSatisfied(undefined, {})).toBe(true)
    })

    it('should use AND semantics across conditions', () => {
      const values: ResourceVarInputs = {
        a: { type: VarKindType.constant, value: '1' },
        b: { type: VarKindType.constant, value: '2' },
      }
      expect(
        isToolSettingShowOnSatisfied(
          [
            { variable: 'a', value: '1' },
            { variable: 'b', value: '2' },
          ],
          values,
        ),
      ).toBe(true)
      expect(
        isToolSettingShowOnSatisfied(
          [
            { variable: 'a', value: '1' },
            { variable: 'b', value: 'x' },
          ],
          values,
        ),
      ).toBe(false)
    })
  })

  describe('reasoningShowOnConditionMet', () => {
    it('should hide a dependent parameter until its sibling has a value', () => {
      expect(reasoningShowOnConditionMet({}, { variable: 'mode', value: 'pro' })).toBe(false)
      expect(
        reasoningShowOnConditionMet(
          { mode: { auto: 0, value: null } },
          { variable: 'mode', value: 'pro' },
        ),
      ).toBe(false)
    })

    it('should fail when sibling auto mode hides static comparable value', () => {
      const values: ReasoningConfigValue = {
        mode: { auto: 1, value: null },
      }
      expect(reasoningShowOnConditionMet(values, { variable: 'mode', value: 'true' })).toBe(false)
    })

    it('should fail when inner payload uses variable reference kind', () => {
      const values: ReasoningConfigValue = {
        mode: {
          auto: 0,
          value: { type: VarKindType.variable, value: ['x'] },
        },
      }
      expect(reasoningShowOnConditionMet(values, { variable: 'mode', value: 'true' })).toBe(false)
    })

    it('should compare inner constant payload against YAML string', () => {
      const values: ReasoningConfigValue = {
        mode: {
          auto: 0,
          value: { type: VarKindType.constant, value: true },
        },
      }
      expect(reasoningShowOnConditionMet(values, { variable: 'mode', value: 'true' })).toBe(true)
    })

    it('should compare a persisted nested constant and reject a nested variable', () => {
      const condition = { variable: 'mode', value: 'pro' }
      const entry = (type: VarKindType) => ({
        mode: {
          auto: 0 as const,
          value: { type: VarKindType.constant, value: { type, value: 'pro' } },
        },
      })
      expect(reasoningShowOnConditionMet(entry(VarKindType.constant), condition)).toBe(true)
      expect(reasoningShowOnConditionMet(entry(VarKindType.variable), condition)).toBe(false)
    })

    it('should aggregate AND semantics via isReasoningConfigShowOnSatisfied', () => {
      const values: ReasoningConfigValue = {
        x: { auto: 0, value: { type: VarKindType.constant, value: 'a' } },
        y: { auto: 0, value: { type: VarKindType.constant, value: 'b' } },
      }
      expect(
        isReasoningConfigShowOnSatisfied(
          [
            { variable: 'x', value: 'a' },
            { variable: 'y', value: 'b' },
          ],
          values,
        ),
      ).toBe(true)
    })
  })
})
