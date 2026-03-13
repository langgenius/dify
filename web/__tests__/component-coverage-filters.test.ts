import { describe, expect, it } from 'vitest'
import {
  COMPONENT_TYPE_COVERAGE_EXCLUDE_GLOBS,
  isTypeCoverageExcludedComponentFile,
} from '../scripts/component-coverage-filters.mjs'

describe('component coverage filters', () => {
  describe('isTypeCoverageExcludedComponentFile', () => {
    it('should exclude singular and plural type files', () => {
      expect(isTypeCoverageExcludedComponentFile('web/app/components/billing/type.ts')).toBe(true)
      expect(isTypeCoverageExcludedComponentFile('web/app/components/share/text-generation/types.ts')).toBe(true)
    })

    it('should exclude declaration files', () => {
      expect(isTypeCoverageExcludedComponentFile('web/app/components/datasets/external-api/declarations.ts')).toBe(true)
      expect(isTypeCoverageExcludedComponentFile('app/components/base/form/form-scenarios/input-field/types.tsx')).toBe(true)
    })

    it('should keep regular source files tracked', () => {
      expect(isTypeCoverageExcludedComponentFile('web/app/components/share/text-generation/index.tsx')).toBe(false)
      expect(isTypeCoverageExcludedComponentFile('web/app/components/custom/custom-page/index.tsx')).toBe(false)
      expect(isTypeCoverageExcludedComponentFile('web/app/components/share/text-generation/types.spec.ts')).toBe(false)
    })
  })

  describe('COMPONENT_TYPE_COVERAGE_EXCLUDE_GLOBS', () => {
    it('should expose the app/components coverage globs used by vitest', () => {
      expect(COMPONENT_TYPE_COVERAGE_EXCLUDE_GLOBS).toEqual([
        'app/components/**/type.{ts,tsx}',
        'app/components/**/types.{ts,tsx}',
        'app/components/**/declarations.{ts,tsx}',
      ])
    })
  })
})
