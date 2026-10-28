import { existsSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

function writeDescriptor(file: string, value: unknown) {
  const content = `${JSON.stringify(value, null, 2)}\n`
  mkdirSync(dirname(file), { recursive: true })
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : undefined
  // No-op generation must not restart the language server.
  if (existing !== content) writeFileSync(file, content)
}

/** Thin mapper subpaths share one exporter configuration per backend source. */
export function generateCompatibilitySources(
  root = resolve(import.meta.dirname, '..'),
  output = resolve(root, '../openapi-content-mapper/contracts'),
) {
  const repo = resolve(root, '../..')
  const sharedSources = {
    community: resolve(output, 'community.source.json'),
    enterprise: resolve(output, 'enterprise.source.json'),
  }
  for (const [name, file] of Object.entries(sharedSources)) {
    const enterprise = name === 'enterprise'
    writeDescriptor(file, {
      command: ['node', 'packages/contracts/scripts/export-compatibility-types.ts'],
      cwd: relative(output, repo),
      inputs: [
        'packages/contracts/api-documents.ts',
        'packages/contracts/typescript-generation.ts',
        'packages/contracts/scripts/export-compatibility-types.ts',
        'packages/contracts/package.json',
        'pnpm-lock.yaml',
        ...(enterprise
          ? [
              'packages/contracts/generated/enterprise*/types.gen.ts',
              'packages/contracts/generated/enterprise*/openapi.gen.json',
            ]
          : [
              'packages/contracts/generated/api/**/types.gen.ts',
              'api/**/*.py',
              'api/pyproject.toml',
              'api/uv.lock',
            ]),
      ],
      ...(enterprise
        ? {}
        : {
            env: ['UV_PROJECT_ENVIRONMENT'],
            exclude: ['api/tests/**'],
            optionalInputs: ['.env'],
          }),
      timeoutMs: 120000,
    })
  }
  const modules = globSync('generated/**/types.gen.ts', { cwd: root }).sort()
  const expected = new Set<string>()
  for (const entry of modules) {
    const module = entry.slice('generated/'.length, -'/types.gen.ts'.length)
    const subpath = module.replace(/^api\//, '')
    const file = resolve(output, `${subpath}.openapi-types`)
    expected.add(file)
    writeDescriptor(file, {
      extends: relative(
        dirname(file),
        sharedSources[module.startsWith('enterprise') ? 'enterprise' : 'community'],
      ),
      args: [module],
    })
  }
  for (const entry of globSync('**/*.openapi-types', { cwd: output })) {
    const file = resolve(output, entry)
    if (!expected.has(file)) {
      const descriptor = JSON.parse(readFileSync(file, 'utf8'))
      if (Object.values(sharedSources).includes(resolve(dirname(file), descriptor.extends ?? '')))
        rmSync(file)
    }
  }
  return modules
}

if (import.meta.main) generateCompatibilitySources()
