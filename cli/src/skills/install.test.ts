import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { ErrorCode } from '@/errors/codes'
import { BASIC_SKILL, findSkill, SKILLS } from './collection'
import { installSkills, selectSkills } from './install'
import { SKILL_FILE } from './source'

describe('selectSkills', () => {
  it('selects the whole collection when no names are given', () => {
    expect(selectSkills([])).toEqual(SKILLS)
  })

  it('selects the named skills', () => {
    expect(selectSkills([BASIC_SKILL])).toEqual([findSkill(BASIC_SKILL)])
  })

  it('rejects an unknown name as a usage error', () => {
    expect(() => selectSkills(['nope'])).toThrow(
      expect.objectContaining({ code: ErrorCode.UsageInvalidFlag }),
    )
  })
})

describe('installSkills', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'difyctl-skills-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes <root>/<skill>/<file> for every file of every skill', async () => {
    const basic = findSkill(BASIC_SKILL)
    const target = join(root, BASIC_SKILL, SKILL_FILE)
    expect(await installSkills(root, [basic])).toEqual([target])
    expect(await readFile(target, 'utf8')).toBe(basic.files[0]?.text)
  })
})
