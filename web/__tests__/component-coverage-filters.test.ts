import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectComponentCoverageExcludedFiles,
  COMPONENT_COVERAGE_EXCLUDE_LABEL,
  getComponentCoverageExclusionReasons,
} from '../scripts/component-coverage-filters.mjs'

describe('component coverage filters', () => {
  describe('getComponentCoverageExclusionReasons', () => {
    it('should exclude type-only files by basename', () => {
      expect(
        getComponentCoverageExclusionReasons(
          'web/app/components/share/text-generation/types.ts',
          'export type ShareMode = "run-once" | "run-batch"',
        ),
      ).toContain('type-only')
    })

    it('should exclude pure barrel files', () => {
      expect(
        getComponentCoverageExclusionReasons(
          'web/app/components/base/amplitude/index.ts',
          [
            'export { default } from "./AmplitudeProvider"',
            'export { resetUser, trackEvent } from "./utils"',
          ].join('\n'),
        ),
      ).toContain('pure-barrel')
    })

    it('should exclude generated files from marker comments', () => {
      expect(
        getComponentCoverageExclusionReasons(
          'web/app/components/base/icons/src/vender/workflow/Answer.tsx',
          [
            '// GENERATE BY script',
            '// DON NOT EDIT IT MANUALLY',
            'export default function Icon() {',
            '  return null',
            '}',
          ].join('\n'),
        ),
      ).toContain('generated')
    })

    it('should exclude pure static files with exported constants only', () => {
      expect(
        getComponentCoverageExclusionReasons(
          'web/app/components/workflow/note-node/constants.ts',
          [
            'import { NoteTheme } from "./types"',
            'export const CUSTOM_NOTE_NODE = "custom-note"',
            'export const THEME_MAP = {',
            '  [NoteTheme.blue]: { title: "bg-blue-100" },',
            '}',
          ].join('\n'),
        ),
      ).toContain('pure-static')
    })

    it('should keep runtime logic files tracked', () => {
      expect(
        getComponentCoverageExclusionReasons(
          'web/app/components/workflow/nodes/trigger-schedule/default.ts',
          [
            'const validate = (value: string) => value.trim()',
            'export const nodeDefault = {',
            '  value: validate("x"),',
            '}',
          ].join('\n'),
        ),
      ).toEqual([])
    })
  })

  describe('collectComponentCoverageExcludedFiles', () => {
    const tempDirs: string[] = []

    afterEach(() => {
      for (const dir of tempDirs)
        fs.rmSync(dir, { recursive: true, force: true })
      tempDirs.length = 0
    })

    it('should collect excluded files for coverage config and keep runtime files out', () => {
      const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'component-coverage-filters-'))
      tempDirs.push(rootDir)

      fs.mkdirSync(path.join(rootDir, 'barrel'), { recursive: true })
      fs.mkdirSync(path.join(rootDir, 'icons'), { recursive: true })
      fs.mkdirSync(path.join(rootDir, 'static'), { recursive: true })
      fs.mkdirSync(path.join(rootDir, 'runtime'), { recursive: true })

      fs.writeFileSync(path.join(rootDir, 'barrel', 'index.ts'), 'export { default } from "./Button"\n')
      fs.writeFileSync(path.join(rootDir, 'icons', 'generated-icon.tsx'), '// @generated\nexport default function Icon() { return null }\n')
      fs.writeFileSync(path.join(rootDir, 'static', 'constants.ts'), 'export const COLORS = { primary: "#fff" }\n')
      fs.writeFileSync(path.join(rootDir, 'runtime', 'config.ts'), 'export const config = makeConfig()\n')
      fs.writeFileSync(path.join(rootDir, 'runtime', 'types.ts'), 'export type Config = { value: string }\n')

      expect(collectComponentCoverageExcludedFiles(rootDir, { pathPrefix: 'app/components' })).toEqual([
        'app/components/barrel/index.ts',
        'app/components/icons/generated-icon.tsx',
        'app/components/runtime/types.ts',
        'app/components/static/constants.ts',
      ])
    })
  })

  it('should describe the excluded coverage categories', () => {
    expect(COMPONENT_COVERAGE_EXCLUDE_LABEL).toBe('type-only files, pure barrel files, generated files, pure static files')
  })
})
