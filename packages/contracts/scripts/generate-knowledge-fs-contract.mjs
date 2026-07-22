import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(packageRoot, '../..')
const repository = resolve(
  process.env.KNOWLEDGE_FS_REPO ?? resolve(workspaceRoot, '../knowledge-fs'),
)
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'dify-knowledge-fs-types-'))

try {
  const openapiPath = join(temporaryDirectory, 'knowledge-fs.console.json')
  run(
    'uv',
    [
      'run',
      '--project',
      resolve(workspaceRoot, 'api'),
      resolve(workspaceRoot, 'api/dev/generate_knowledge_fs_contract.py'),
      '--repository',
      repository,
      '--check',
      '--output-openapi',
      openapiPath,
    ],
    workspaceRoot,
  )
  run('pnpm', ['exec', 'openapi-ts', '-f', 'openapi-ts.knowledge-fs.config.ts'], packageRoot, {
    KNOWLEDGE_FS_OPENAPI: openapiPath,
  })
  run('pnpm', ['exec', 'vp', 'fmt', 'generated/knowledge-fs'], packageRoot)
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true })
}

function run(command, args, cwd, extraEnv = {}) {
  execFileSync(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  })
}
