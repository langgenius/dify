import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vite-plus/test'
import { installSkill } from './install'
import { openDir, SKILL_FILE, SKILL_NAME } from './source'

let tmp: string
let from: string
let root: string

async function put(path: string, text: string): Promise<void> {
  const abs = join(from, path)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, text)
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'difyctl-skill-'))
  from = join(tmp, 'source')
  root = join(tmp, 'root')
  await put(SKILL_FILE, `---\nname: ${SKILL_NAME}\ndescription: d\n---\n`)
  await put('references/setup.md', 'setup')
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

it('writes every file under <root>/difyctl', async () => {
  const wrote = await installSkill(root, await openDir(from))
  expect(wrote.sort()).toEqual(
    [join(root, SKILL_NAME, SKILL_FILE), join(root, SKILL_NAME, 'references/setup.md')].sort(),
  )
  expect(await readFile(join(root, SKILL_NAME, 'references/setup.md'), 'utf8')).toBe('setup')
})

it('keeps the permission bits of files from a local folder', async () => {
  await put('scripts/run', 'no shebang')
  await chmod(join(from, 'scripts/run'), 0o755)
  await installSkill(root, await openDir(from))
  expect((await stat(join(root, SKILL_NAME, 'scripts/run'))).mode & 0o111).toBe(0o111)
})
