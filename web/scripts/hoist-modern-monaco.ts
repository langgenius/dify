import { Buffer } from 'node:buffer'
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type Args = {
  force: boolean
  themes: string[]
  languages: string[]
}

const DEFAULT_THEMES = ['light-plus', 'dark-plus']
const DEFAULT_LANGUAGES = ['javascript', 'json', 'python']
const ESM_SH = 'https://esm.sh'
const HOIST_DIR_NAME = 'hoisted-modern-monaco'
const ROOT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const PUBLIC_DIR = path.join(ROOT_DIR, 'public')
const HOIST_PUBLIC_DIR = path.join(PUBLIC_DIR, HOIST_DIR_NAME)
const GENERATED_CONFIG_PATH = path.join(ROOT_DIR, 'app', 'components', 'base', 'modern-monaco', 'hoisted-config.ts')
const MODERN_MONACO_DIR = path.join(ROOT_DIR, 'node_modules', 'modern-monaco')
const MODERN_MONACO_DIST_DIR = path.join(MODERN_MONACO_DIR, 'dist')
const MODERN_MONACO_PKG_PATH = path.join(MODERN_MONACO_DIR, 'package.json')
const SHIKI_DIST_PATH = path.join(MODERN_MONACO_DIST_DIR, 'shiki.mjs')
const TYPESCRIPT_PKG_PATH = path.join(ROOT_DIR, 'node_modules', 'typescript', 'package.json')
const MODERN_MONACO_PUBLIC_DIR = path.join(HOIST_PUBLIC_DIR, 'modern-monaco')
const HOIST_MANIFEST_PATH = path.join(MODERN_MONACO_PUBLIC_DIR, 'hoist-manifest.json')
const TYPESCRIPT_SETUP_PATH = path.join(MODERN_MONACO_PUBLIC_DIR, 'lsp', 'typescript', 'setup.mjs')

function parseArgs(argv: string[]): Args {
  const args: Args = {
    force: false,
    themes: [...DEFAULT_THEMES],
    languages: [...DEFAULT_LANGUAGES],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--')
      continue
    if (value === '--force') {
      args.force = true
      continue
    }
    if (value === '--theme') {
      const theme = argv[index + 1]
      if (!theme)
        throw new Error('Missing value for --theme')
      args.themes.push(theme)
      index += 1
      continue
    }
    if (value === '--language') {
      const language = argv[index + 1]
      if (!language)
        throw new Error('Missing value for --language')
      args.languages.push(language)
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${value}`)
  }

  args.themes = [...new Set(args.themes)]
  args.languages = [...new Set(args.languages)]
  return args
}

function log(message: string) {
  process.stdout.write(`${message}\n`)
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  }
  catch {
    return false
  }
}

function requireMatch(text: string, pattern: RegExp, description: string): string {
  const match = text.match(pattern)
  if (!match?.[1])
    throw new Error(`Failed to resolve ${description}`)
  return match[1]
}

function getEmbeddedLanguages(shikiText: string, language: string): string[] {
  const anchor = `name: "${language}"`
  const start = shikiText.indexOf(anchor)
  if (start === -1)
    return []
  const end = shikiText.indexOf(' }, {', start)
  const entry = shikiText.slice(start, end === -1 ? undefined : end)
  const match = entry.match(/embedded: \[([^\]]*)\]/)
  if (!match?.[1])
    return []
  return [...match[1].matchAll(/"([^"]+)"/g)].map(([, name]) => name)
}

function resolveLanguages(shikiText: string, initialLanguages: string[]): string[] {
  const resolved = new Set(initialLanguages)
  const queue = [...initialLanguages]

  while (queue.length > 0) {
    const language = queue.shift()
    if (!language)
      continue
    for (const embeddedLanguage of getEmbeddedLanguages(shikiText, language)) {
      if (resolved.has(embeddedLanguage))
        continue
      resolved.add(embeddedLanguage)
      queue.push(embeddedLanguage)
    }
  }

  return [...resolved]
}

async function fetchWithRetry(url: string, retries = 2): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url)
      if (!response.ok)
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      return response
    }
    catch (error) {
      lastError = error
      if (attempt === retries)
        break
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)))
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function writeResponseToFile(url: string, filePath: string) {
  const response = await fetchWithRetry(url)
  const content = Buffer.from(await response.arrayBuffer())
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

async function resolveTypeScriptEsmPath(version: string): Promise<string> {
  const response = await fetchWithRetry(`${ESM_SH}/typescript@${version}`)
  const esmPath = response.headers.get('x-esm-path')
  if (!esmPath)
    throw new Error('Missing x-esm-path header for typescript')
  return esmPath
}

function getRelativeImportPath(fromFilePath: string, toFilePath: string): string {
  return path.relative(path.dirname(fromFilePath), toFilePath).replaceAll(path.sep, '/')
}

async function patchTypeScriptWorkerImport(workerFilePath: string, localTypeScriptPath: string) {
  const original = await readFile(workerFilePath, 'utf8')
  const relativeImportPath = getRelativeImportPath(
    workerFilePath,
    path.join(HOIST_PUBLIC_DIR, localTypeScriptPath.replace(/^\//, '')),
  )
  const next = original.replace('from "typescript";', `from "${relativeImportPath}";`)
  if (next === original)
    throw new Error('Failed to patch modern-monaco TypeScript worker import')
  await writeFile(workerFilePath, next)
}

async function patchTypeScriptWorkerBootstrap(setupFilePath: string) {
  const original = await readFile(setupFilePath, 'utf8')
  const currentBlock = `function createWebWorker() {
  const workerUrl = new URL("./worker.mjs", import.meta.url);
  if (workerUrl.origin !== location.origin) {
    return new Worker(
      URL.createObjectURL(new Blob([\`import "\${workerUrl.href}"\`], { type: "application/javascript" })),
      { type: "module", name: "typescript-worker" }
    );
  }
  return new Worker(workerUrl, { type: "module", name: "typescript-worker" });
}`
  const nextBlock = `function createWebWorker() {
  const workerUrl = new URL("./worker.mjs", import.meta.url);
  return new Worker(
    URL.createObjectURL(new Blob([\`import "\${workerUrl.href}"\`], { type: "application/javascript" })),
    { type: "module", name: "typescript-worker" }
  );
}`
  const next = original.replace(currentBlock, nextBlock)
  if (next === original)
    throw new Error('Failed to patch modern-monaco TypeScript worker bootstrap')
  await writeFile(setupFilePath, next)
}

async function writeManifest(filePath: string, manifest: object) {
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function toSingleQuotedLiteral(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}'`
}

function toReadonlyArrayLiteral(values: string[]): string {
  return `[${values.map(toSingleQuotedLiteral).join(', ')}] as const`
}

function toReadonlyObjectLiteral(entries: Record<string, string>): string {
  const lines = Object.entries(entries).map(
    ([key, value]) => `  ${toSingleQuotedLiteral(key)}: ${toSingleQuotedLiteral(value)},`,
  )
  return `{\n${lines.join('\n')}\n} as const`
}

async function writeGeneratedConfig(
  filePath: string,
  options: {
    hoistBasePath: string
    tmThemesVersion: string
    tmGrammarsVersion: string
    themes: string[]
    languages: string[]
    importMap: Record<string, string>
  },
) {
  const content = [
    '// This file is generated by scripts/hoist-modern-monaco.ts.',
    '// Do not edit it manually.',
    '',
    `export const HOIST_BASE_PATH = ${toSingleQuotedLiteral(options.hoistBasePath)} as const`,
    `export const TM_THEMES_VERSION = ${toSingleQuotedLiteral(options.tmThemesVersion)} as const`,
    `export const TM_GRAMMARS_VERSION = ${toSingleQuotedLiteral(options.tmGrammarsVersion)} as const`,
    `export const HOIST_THEME_IDS = ${toReadonlyArrayLiteral(options.themes)}`,
    `export const HOIST_LANGUAGE_IDS = ${toReadonlyArrayLiteral(options.languages)}`,
    `export const MODERN_MONACO_IMPORT_MAP = ${toReadonlyObjectLiteral(options.importMap)}`,
    '',
  ].join('\n')

  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const modernMonacoPkg = await readJson<{ version: string }>(MODERN_MONACO_PKG_PATH)
  const typescriptPkg = await readJson<{ version: string }>(TYPESCRIPT_PKG_PATH)
  const shikiText = await readFile(SHIKI_DIST_PATH, 'utf8')
  const tmGrammarsVersion = requireMatch(shikiText, /var version = "([^"]+)";/, 'tm-grammars version')
  const tmThemesVersion = requireMatch(shikiText, /var version2 = "([^"]+)";/, 'tm-themes version')
  const languages = resolveLanguages(shikiText, args.languages)
  const themes = [...args.themes]
  const localTypeScriptPath = await resolveTypeScriptEsmPath(typescriptPkg.version)
  const localTypeScriptDir = localTypeScriptPath.replace(/^\//, '').split('/')[0] || ''
  const typeScriptPublicPath = path.join(HOIST_PUBLIC_DIR, localTypeScriptPath.replace(/^\//, ''))
  const typeScriptWorkerPath = path.join(MODERN_MONACO_PUBLIC_DIR, 'lsp', 'typescript', 'worker.mjs')

  if (args.force) {
    await Promise.all([
      rm(HOIST_PUBLIC_DIR, { force: true, recursive: true }),
      rm(path.join(PUBLIC_DIR, 'modern-monaco'), { force: true, recursive: true }),
      rm(path.join(PUBLIC_DIR, `tm-themes@${tmThemesVersion}`), { force: true, recursive: true }),
      rm(path.join(PUBLIC_DIR, `tm-grammars@${tmGrammarsVersion}`), { force: true, recursive: true }),
      rm(path.join(PUBLIC_DIR, localTypeScriptDir), { force: true, recursive: true }),
    ])
  }
  else if (await pathExists(HOIST_MANIFEST_PATH) && await pathExists(GENERATED_CONFIG_PATH)) {
    log(`modern-monaco hoist cache hit: public/${HOIST_DIR_NAME}`)
    return
  }

  log(`Copying modern-monaco dist -> ${path.relative(ROOT_DIR, MODERN_MONACO_PUBLIC_DIR)}`)
  await rm(MODERN_MONACO_PUBLIC_DIR, { force: true, recursive: true })
  await cp(MODERN_MONACO_DIST_DIR, MODERN_MONACO_PUBLIC_DIR, { recursive: true })

  log(`Downloading typescript ESM -> ${localTypeScriptPath}`)
  await writeResponseToFile(`${ESM_SH}${localTypeScriptPath}`, typeScriptPublicPath)
  await patchTypeScriptWorkerImport(typeScriptWorkerPath, localTypeScriptPath)
  await patchTypeScriptWorkerBootstrap(TYPESCRIPT_SETUP_PATH)

  for (const theme of themes) {
    const themeUrl = `${ESM_SH}/tm-themes@${tmThemesVersion}/themes/${theme}.json`
    const themePath = path.join(HOIST_PUBLIC_DIR, `tm-themes@${tmThemesVersion}`, 'themes', `${theme}.json`)
    log(`Downloading theme ${theme}`)
    await writeResponseToFile(themeUrl, themePath)
  }

  for (const language of languages) {
    const grammarUrl = `${ESM_SH}/tm-grammars@${tmGrammarsVersion}/grammars/${language}.json`
    const grammarPath = path.join(HOIST_PUBLIC_DIR, `tm-grammars@${tmGrammarsVersion}`, 'grammars', `${language}.json`)
    log(`Downloading grammar ${language}`)
    await writeResponseToFile(grammarUrl, grammarPath)
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    modernMonacoVersion: modernMonacoPkg.version,
    tmGrammarsVersion,
    tmThemesVersion,
    typescriptVersion: typescriptPkg.version,
    localTypeScriptPath: `/${HOIST_DIR_NAME}/${localTypeScriptPath.replace(/^\//, '')}`,
    themes,
    languages,
    importMap: {
      'modern-monaco/editor-core': `/${HOIST_DIR_NAME}/modern-monaco/editor-core.mjs`,
      'modern-monaco/lsp': `/${HOIST_DIR_NAME}/modern-monaco/lsp/index.mjs`,
    },
  }

  await writeManifest(HOIST_MANIFEST_PATH, manifest)
  await writeGeneratedConfig(GENERATED_CONFIG_PATH, {
    hoistBasePath: `/${HOIST_DIR_NAME}`,
    tmThemesVersion,
    tmGrammarsVersion,
    themes,
    languages,
    importMap: manifest.importMap,
  })

  log('')
  log('modern-monaco hoist complete.')
  log(`- output dir: public/${HOIST_DIR_NAME}`)
  log(`- import map: modern-monaco/editor-core -> location.origin + "/${HOIST_DIR_NAME}/modern-monaco/editor-core.mjs"`)
  log(`- import map: modern-monaco/lsp -> location.origin + "/${HOIST_DIR_NAME}/modern-monaco/lsp/index.mjs"`)
  log(`- init option: cdn -> window.location.origin`)
  log(`- languages: ${languages.join(', ')}`)
  log(`- themes: ${themes.join(', ')}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
