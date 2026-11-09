import type { UserConfig } from '@hey-api/openapi-ts'
import type { SwaggerDocument } from '../api-documents.ts'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@hey-api/openapi-ts'
import {
  cloneDocumentWithPaths,
  groupConsolePaths,
  mergeFastOpenApiConsoleSwagger,
  normalizeApiSwagger,
  toKebabCase,
} from '../api-documents.ts'
import { stripEnterpriseSchemaNamePrefix, typescriptPlugin } from '../typescript-generation.ts'

const root = resolve(import.meta.dirname, '..')
const repo = resolve(root, '../..')

/** Use the same TypeScript plugin as normal generation, without writing any artifacts. */
export async function renderCompatibilityTypes(
  document: SwaggerDocument,
  enterprise = false,
): Promise<string> {
  const config: UserConfig = {
    input: document,
    dryRun: true,
    logs: { level: 'silent', file: false },
    output: {
      path: resolve(root, '.compatibility-output'),
      // Hey API's clean step runs even in dry-run mode.
      clean: false,
      entryFile: false,
      fileName: { suffix: '.gen' },
    },
    ...(enterprise
      ? {
          parser: {
            transforms: {
              schemaName: stripEnterpriseSchemaNamePrefix,
            },
          },
        }
      : {}),
    plugins: [typescriptPlugin(enterprise)],
  }
  const [context] = await createClient(config)
  const files = context?.gen.render() ?? []
  const file = files.find((file) => file.path.endsWith('/types.gen.ts'))
  if (!file || files.length !== 1)
    throw new Error('Expected one generated compatibility types module')
  const origins = new Map<string, string>()
  for (const symbol of context!.gen.symbols.registered()) {
    const path = symbol.meta?.path
    if (!Array.isArray(path)) continue
    let node: unknown = document
    for (const part of path) {
      node =
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[String(part)]
          : undefined
    }
    if (!node || typeof node !== 'object') continue
    const source = (node as Record<string, unknown>)['x-source-location'] as
      | { file?: unknown; line?: unknown }
      | undefined
    if (
      !source ||
      typeof source.file !== 'string' ||
      !isAbsolute(source.file) ||
      typeof source.line !== 'number' ||
      !Number.isSafeInteger(source.line) ||
      source.line < 1
    )
      continue
    const url = pathToFileURL(source.file)
    url.hash = `L${source.line}`
    const href = url.href.replaceAll('*', '%2A').replaceAll('(', '%28').replaceAll(')', '%29')
    origins.set(symbol.finalName, `/** [Open backend implementation](${href}) */\n`)
  }
  // Use the generator's resolved symbols, including renamed schemas and envelopes.
  // Normal contracts generation stays unchanged; only virtual exports get links.
  return file.content.replace(
    /^export (?:type|interface|const|enum) (\w+)/gm,
    (declaration, name: string) => `${origins.get(name) ?? ''}${declaration}`,
  )
}

export function selectCommunityDocument(
  module: string,
  documents: Record<string, SwaggerDocument>,
): SwaggerDocument {
  const [, surface, segment] = module.split('/')
  const input = documents[`${surface}-openapi.json`]
  if (!input) throw new Error(`Unknown contracts surface: ${surface}`)
  const document = normalizeApiSwagger(
    surface === 'console'
      ? mergeFastOpenApiConsoleSwagger(
          structuredClone(input),
          structuredClone(documents['fastopenapi-console-openapi.json']!),
        )
      : structuredClone(input),
  )
  if (surface !== 'console') return document
  const paths: NonNullable<SwaggerDocument['paths']> = {}
  for (const [name, group] of groupConsolePaths(document)) {
    if (toKebabCase(name) === segment) Object.assign(paths, group)
  }
  if (!Object.keys(paths).length) throw new Error(`No Console operations for ${module}`)
  return cloneDocumentWithPaths(document, paths)
}

function exportPython(args: string[]): Record<string, SwaggerDocument> {
  return JSON.parse(
    execFileSync('uv', ['run', '--frozen', '--project', 'api', ...args], {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 90000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
}

export function loadCommunityDocuments(consoleOnly: boolean): Record<string, SwaggerDocument> {
  if (consoleOnly) {
    const exported = exportPython(['api/dev/cached_console_openapi.py'])
    return {
      'console-openapi.json': exported.console!,
      'fastopenapi-console-openapi.json': exported.fast!,
    }
  }
  return exportPython([
    'python',
    '-c',
    [
      'import contextlib, json, sys',
      'sys.path.insert(0, "api")',
      'with contextlib.redirect_stdout(sys.stderr):',
      '    from dev.cached_console_openapi import source_imports',
      '    source_imports()',
      '    from dev.export_console_openapi import export_all_with_sources',
      '    documents = export_all_with_sources()',
      'json.dump(documents, sys.stdout)',
    ].join('\n'),
  ])
}

export async function exportCompatibilityTypes(module: string): Promise<string> {
  // Only existing published modules are accepted; module names cannot escape generated/.
  if (
    !/^(?:api\/(?:console\/[a-z0-9-]+|web|service|openapi)|enterprise(?:-app-deploy)?)$/.test(
      module,
    )
  )
    throw new Error(`Invalid contracts module: ${module}`)
  const original = resolve(root, 'generated', module, 'types.gen.ts')
  if (!statSync(original).isFile()) throw new Error(`Missing contracts module: ${module}`)
  if (module.startsWith('enterprise')) {
    const document: SwaggerDocument = JSON.parse(
      readFileSync(resolve(root, 'generated', module, 'openapi.gen.json'), 'utf8'),
    )
    const generated = await renderCompatibilityTypes(document, true)
    // Retained Console snapshots omit non-Console models. Preserve their existing
    // exports (including enum values) instead of silently dropping public names.
    return `${generated}\nexport * from ${JSON.stringify(original.replace(/\.ts$/, '.js'))};\n`
  }
  const documents = loadCommunityDocuments(module.startsWith('api/console/'))
  return renderCompatibilityTypes(selectCommunityDocument(module, documents))
}

if (import.meta.main) {
  const module = process.argv[2]
  if (!module) throw new Error('Expected a contracts module, such as api/console/datasets')
  process.stdout.write(JSON.stringify({ typescript: await exportCompatibilityTypes(module) }))
}
