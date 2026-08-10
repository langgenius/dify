import type { ReasoningConfigValue } from './show-on'
import type { ToolVarInputs } from '@/app/components/workflow/nodes/tool/types'
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
      const values: ToolVarInputs = {}
      expect(toolSettingShowOnConditionMet(values, { variable: 'mode', value: 'pro' })).toBe(false)
    })

    it('should fail when sibling uses variable reference mode', () => {
      const values: ToolVarInputs = {
        mode: { type: VarKindType.variable, value: ['n', 'x'] },
      }
      expect(toolSettingShowOnConditionMet(values, { variable: 'mode', value: 'pro' })).toBe(false)
    })

    it('should pass when constant sibling matches', () => {
      const values: ToolVarInputs = {
        mode: { type: VarKindType.constant, value: 'pro' },
      }
      expect(toolSettingShowOnConditionMet(values, { variable: 'mode', value: 'pro' })).toBe(true)
    })

    it('should unwrap double-wrapped FormValueInput in sibling.value', () => {
      const values: ToolVarInputs = {
        mode: {
          type: VarKindType.constant,
          value: { type: VarKindType.constant, value: 'pro' },
        },
      }
      expect(toolSettingShowOnConditionMet(values, { variable: 'mode', value: 'pro' })).toBe(true)
    })
  })

  describe('isToolSettingShowOnSatisfied', () => {
    it('should use AND semantics across conditions', () => {
      const values: ToolVarInputs = {
        a: { type: VarKindType.constant, value: '1' },
        b: { type: VarKindType.constant, value: '2' },
      }
      expect(isToolSettingShowOnSatisfied(
        [{ variable: 'a', value: '1' }, { variable: 'b', value: '2' }],
        values,
      )).toBe(true)
      expect(isToolSettingShowOnSatisfied(
        [{ variable: 'a', value: '1' }, { variable: 'b', value: 'x' }],
        values,
      )).toBe(false)
    })
  })

  describe('reasoningShowOnConditionMet', () => {
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

    it('should aggregate AND semantics via isReasoningConfigShowOnSatisfied', () => {
      const values: ReasoningConfigValue = {
        x: { auto: 0, value: { type: VarKindType.constant, value: 'a' } },
        y: { auto: 0, value: { type: VarKindType.constant, value: 'b' } },
      }
      expect(isReasoningConfigShowOnSatisfied([
        { variable: 'x', value: 'a' },
        { variable: 'y', value: 'b' },
      ], values)).toBe(true)
    })
  })
})
