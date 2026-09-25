import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { ErrorCode } from '@/errors/codes'
import { BASIC_SKILL, loadSkills } from './collection'
import { installSkills, selectSkills } from './install'
import { openSource } from './source'

const SCENARIO = 'difyctl-demo'

let tmp: string
let from: string
let root: string

async function put(path: string, text: string): Promise<void> {
  const abs = join(from, path)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, text)
}

function skillMd(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} skill\n---\n\n# ${name}\n`
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'difyctl-skills-'))
  from = join(tmp, 'source')
  root = join(tmp, 'root')
  await put(`${BASIC_SKILL}/SKILL.md`, skillMd(BASIC_SKILL))
  await put(`${SCENARIO}/SKILL.md`, skillMd(SCENARIO))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('selectSkills', () => {
  it('selects the whole collection when no names are given', async () => {
    const skills = await loadSkills(await openSource(from))
    expect(selectSkills(skills, [])).toEqual(skills)
  })

  it('selects the named skills', async () => {
    const skills = await loadSkills(await openSource(from))
    expect(selectSkills(skills, [BASIC_SKILL]).map((s) => s.name)).toEqual([BASIC_SKILL])
  })

  it('rejects an unknown name as a usage error', async () => {
    const skills = await loadSkills(await openSource(from))
    expect(() => selectSkills(skills, ['nope'])).toThrow(
      expect.objectContaining({ code: ErrorCode.UsageInvalidFlag }),
    )
  })
})

describe('installSkills', () => {
  it('writes <root>/<skill>/<file> for every file of every skill', async () => {
    const source = await openSource(from)
    const basic = selectSkills(await loadSkills(source), [BASIC_SKILL])
    const target = join(root, BASIC_SKILL, 'SKILL.md')
    expect(await installSkills(root, basic, source)).toEqual([target])
    expect(await readFile(target, 'utf8')).toBe(skillMd(BASIC_SKILL))
  })
})
