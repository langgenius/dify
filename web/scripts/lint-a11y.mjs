import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const webRoot = path.resolve(import.meta.dirname, '..')
const repositoryRoot = path.resolve(webRoot, '..')
const configPath = path.resolve(import.meta.dirname, 'a11y', 'oxlint.config.ts')
const require = createRequire(import.meta.url)
const vitePlusRequire = createRequire(require.resolve('vite-plus/package.json'))
const oxlintPackageDirectory = path.dirname(vitePlusRequire.resolve('oxlint/package.json'))
const oxlintEntry = path.resolve(oxlintPackageDirectory, 'bin', 'oxlint')
const inputArguments = process.argv.slice(2)
const dependencyMode = inputArguments.includes('--deps')
const inputTargets = inputArguments.filter((argument) => argument !== '--deps')

function printUsage() {
  console.error(`Usage:
  pnpm lint:a11y <page-file-or-directory> [...]
  pnpm lint:a11y --deps <entry-file> [...]`)
}

if (inputTargets.length === 0) {
  printUsage()
  process.exit(2)
}

const unsupportedOption = inputTargets.find((target) => target.startsWith('-'))

if (unsupportedOption) {
  console.error(`Unknown option: ${unsupportedOption}`)
  printUsage()
  process.exit(2)
}

const resolvedTargets = inputTargets.map((target) => {
  if (path.isAbsolute(target)) return target

  if (target === 'web' || target.startsWith('web/') || target.startsWith('web\\'))
    return path.resolve(repositoryRoot, target)

  return path.resolve(webRoot, target)
})

const sourceExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const jsxExtensions = new Set(['.jsx', '.tsx'])
const ignoredDirectories = new Set([
  '.next',
  '.vinext',
  'coverage',
  'dist',
  'node_modules',
  'storybook-static',
])

function isWithinWebRoot(filePath) {
  const relativePath = path.relative(webRoot, filePath)
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function isTraversableSourceFile(filePath) {
  if (!isWithinWebRoot(filePath) || !sourceExtensions.has(path.extname(filePath))) return false
  if (/\.d\.[cm]?ts$/u.test(filePath)) return false

  return !path
    .relative(webRoot, filePath)
    .split(path.sep)
    .some((segment) => ignoredDirectories.has(segment))
}

function formatTypeScriptDiagnostics(diagnostics) {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => webRoot,
    getNewLine: () => ts.sys.newLine,
  })
}

function readCompilerOptions() {
  const tsconfigPath = ts.findConfigFile(webRoot, ts.sys.fileExists, 'tsconfig.json')

  if (!tsconfigPath) throw new Error('Unable to find web/tsconfig.json.')

  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)

  if (configFile.error) throw new Error(formatTypeScriptDiagnostics([configFile.error]))

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
    undefined,
    tsconfigPath,
  )
  const errors = parsedConfig.errors.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  )

  if (errors.length > 0) throw new Error(formatTypeScriptDiagnostics(errors))

  return parsedConfig.options
}

function collectLocalDependencies(entryFiles) {
  for (const entryFile of entryFiles) {
    let stats

    try {
      stats = fs.statSync(entryFile)
    } catch {
      throw new Error(`Entry file does not exist: ${entryFile}`)
    }

    if (!stats.isFile()) throw new Error(`--deps only accepts entry files: ${entryFile}`)
    if (!isTraversableSourceFile(entryFile))
      throw new Error(
        `Entry file must be a JavaScript or TypeScript source file under web/: ${entryFile}`,
      )
  }

  const compilerOptions = readCompilerOptions()
  const canonicalFileName = ts.sys.useCaseSensitiveFileNames
    ? (fileName) => fileName
    : (fileName) => fileName.toLowerCase()
  const resolutionCache = ts.createModuleResolutionCache(
    webRoot,
    canonicalFileName,
    compilerOptions,
  )
  const visitedFiles = new Map()
  const pending = [...entryFiles]

  while (pending.length > 0) {
    const currentFile = path.resolve(pending.pop())
    const canonicalCurrentFile = canonicalFileName(currentFile)

    if (visitedFiles.has(canonicalCurrentFile)) continue
    visitedFiles.set(canonicalCurrentFile, currentFile)

    const sourceText = ts.sys.readFile(currentFile)

    if (sourceText === undefined) throw new Error(`Unable to read imported file: ${currentFile}`)

    const importedFiles = ts.preProcessFile(sourceText, true, true).importedFiles

    for (const importedFile of importedFiles) {
      const resolvedModule = ts.resolveModuleName(
        importedFile.fileName,
        currentFile,
        compilerOptions,
        ts.sys,
        resolutionCache,
      ).resolvedModule

      if (!resolvedModule || resolvedModule.isExternalLibraryImport) continue

      const dependencyPath = path.resolve(resolvedModule.resolvedFileName)

      if (isTraversableSourceFile(dependencyPath)) pending.push(dependencyPath)
    }
  }

  const files = [...visitedFiles.values()]
    .filter((filePath) => jsxExtensions.has(path.extname(filePath)))
    .sort()

  console.log(
    `Resolved ${files.length} JSX source ${files.length === 1 ? 'file' : 'files'} from ${entryFiles.length} ${entryFiles.length === 1 ? 'entry' : 'entries'}.`,
  )

  return files
}

let targets = resolvedTargets

if (dependencyMode) {
  try {
    targets = collectLocalDependencies(resolvedTargets)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
}

if (targets.length === 0) {
  console.log('No JSX or TSX source files found to lint.')
  process.exit(0)
}

const result = spawnSync(process.execPath, [oxlintEntry, '-c', configPath, ...targets], {
  cwd: webRoot,
  stdio: 'inherit',
})

if (result.error) {
  console.error(`Failed to start the accessibility lint: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
