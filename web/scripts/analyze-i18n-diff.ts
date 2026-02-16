/**
 * This script compares i18n keys between current branch (flat JSON) and main branch (nested TS).
 *
 * It checks:
 * 1. All namespaces from main branch have corresponding JSON files
 * 2. No TS files exist in current branch (all should be converted to JSON)
 * 3. All keys from main branch exist in current branch
 * 4. Values for existing keys haven't changed
 * 5. Lists newly added keys and values
 *
 * Usage: npx tsx scripts/analyze-i18n-diff.ts
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const I18N_DIR = path.join(__dirname, '../i18n/en-US')
const LOCALE = 'en-US'

type TranslationValue = string | string[]

type FlatTranslation = {
  [key: string]: TranslationValue
}

type NestedTranslation = {
  [key: string]: string | string[] | NestedTranslation
}

type AnalysisResult = {
  file: string
  missingKeys: string[]
  changedValues: { key: string, oldValue: TranslationValue, newValue: TranslationValue }[]
  newKeys: { key: string, value: TranslationValue }[]
}

/**
 * Flatten nested object to dot-separated keys
 * Arrays are preserved as-is (not split into .0, .1, etc.)
 */
function flattenObject(obj: NestedTranslation, prefix = ''): FlatTranslation {
  const result: FlatTranslation = {}

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'string') {
      result[newKey] = value
    }
    else if (Array.isArray(value)) {
      // Preserve arrays as-is
      result[newKey] = value as string[]
    }
    else if (typeof value === 'object' && value !== null) {
      Object.assign(result, flattenObject(value as NestedTranslation, newKey))
    }
  }

  return result
}

/**
 * Compare two translation values (string or array)
 */
function valuesEqual(a: TranslationValue, b: TranslationValue): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    return a === b
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length)
      return false
    return a.every((item, index) => item === b[index])
  }
  return false
}

/**
 * Format value for display
 */
function formatValue(value: TranslationValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(v => `"${v}"`).join(', ')}]`
  }
  return `"${value}"`
}

/**
 * Parse TS file content to extract the translation object
 */
function parseTsContent(content: string): NestedTranslation {
  // Remove 'const translation = ' and 'export default translation'
  let cleaned = content
    .replace(/const\s+translation\s*=\s*/, '')
    .replace(/export\s+default\s+translation\s*(?:;\s*)?$/, '')
    .trim()

  // Remove trailing semicolon if present
  if (cleaned.endsWith(';'))
    cleaned = cleaned.slice(0, -1)

  // Use Function constructor to safely evaluate the object literal
  // This handles JS object syntax like unquoted keys, template literals, etc.
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (${cleaned})`)
    return fn() as NestedTranslation
  }
  catch (e) {
    console.error('Failed to parse TS content:', e)
    console.error('Content preview:', cleaned.slice(0, 200))
    return {}
  }
}

/**
 * Get file content from main branch
 */
function getMainBranchFile(filePath: string): string | null {
  try {
    const relativePath = `./i18n/${LOCALE}/${filePath}`

    return execSync(`git show main:${relativePath}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }
  catch {
    return null
  }
}

/**
 * Get list of translation files
 */
function getTranslationFiles(): string[] {
  const files = fs.readdirSync(I18N_DIR)
  return files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''))
}

/**
 * Get list of namespaces from main branch (ts files)
 */
function getMainBranchNamespaces(): string[] {
  try {
    const relativePath = `./i18n/${LOCALE}`

    const output = execSync(`git ls-tree --name-only main ${relativePath}/`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    return output
      .trim()
      .split('\n')
      .filter(f => f.endsWith('.ts'))
      .map(f => path.basename(f, '.ts'))
  }
  catch {
    return []
  }
}

type NamespaceCheckResult = {
  mainNamespaces: string[]
  currentJsonFiles: string[]
  currentTsFiles: string[]
  missingJsonFiles: string[]
  unexpectedTsFiles: string[]
}

/**
 * Check namespace file consistency between main and current branch
 */
function checkNamespaceFiles(): NamespaceCheckResult {
  const mainNamespaces = getMainBranchNamespaces()
  const currentFiles = fs.readdirSync(I18N_DIR)

  const currentJsonFiles = currentFiles
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))

  const currentTsFiles = currentFiles
    .filter(f => f.endsWith('.ts'))
    .map(f => f.replace('.ts', ''))

  // Check which namespaces from main are missing json files
  const missingJsonFiles = mainNamespaces.filter(ns => !currentJsonFiles.includes(ns))

  // ts files should not exist in current branch
  const unexpectedTsFiles = currentTsFiles

  return {
    mainNamespaces,
    currentJsonFiles,
    currentTsFiles,
    missingJsonFiles,
    unexpectedTsFiles,
  }
}

/**
 * Analyze a single translation file
 */
function analyzeFile(baseName: string): AnalysisResult {
  const result: AnalysisResult = {
    file: baseName,
    missingKeys: [],
    changedValues: [],
    newKeys: [],
  }

  // Read current branch JSON file
  const jsonPath = path.join(I18N_DIR, `${baseName}.json`)
  const currentContent = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<string, TranslationValue>

  // Read main branch TS file
  const tsContent = getMainBranchFile(`${baseName}.ts`)
  if (!tsContent) {
    // New file, all keys are new
    for (const [key, value] of Object.entries(currentContent)) {
      result.newKeys.push({ key, value })
    }
    return result
  }

  // Parse and flatten the TS content
  const nestedObj = parseTsContent(tsContent)
  const mainFlat = flattenObject(nestedObj)

  // Check for missing keys (in main but not in current)
  for (const key of Object.keys(mainFlat)) {
    if (!(key in currentContent)) {
      result.missingKeys.push(key)
    }
  }

  // Check for changed values
  for (const [key, oldValue] of Object.entries(mainFlat)) {
    if (key in currentContent && !valuesEqual(currentContent[key], oldValue)) {
      result.changedValues.push({
        key,
        oldValue,
        newValue: currentContent[key],
      })
    }
  }

  // Find new keys (in current but not in main)
  for (const [key, value] of Object.entries(currentContent)) {
    if (!(key in mainFlat)) {
      result.newKeys.push({ key, value })
    }
  }

  return result
}

/**
 * Main analysis function
 */
function main() {
  console.log('🔍 Analyzing i18n differences between current branch (flat JSON) and main branch (nested TS)...\n')

  // Check namespace file consistency first
  console.log('📂 Checking namespace files...')
  console.log('='.repeat(60))
  const nsCheck = checkNamespaceFiles()

  console.log(`Namespaces in main branch (ts files): ${nsCheck.mainNamespaces.length}`)
  console.log(`JSON files in current branch: ${nsCheck.currentJsonFiles.length}`)
  console.log(`TS files in current branch: ${nsCheck.currentTsFiles.length}`)

  let hasNamespaceError = false

  if (nsCheck.missingJsonFiles.length > 0) {
    console.log('\n❌ Missing JSON files (namespace exists in main but no corresponding JSON):')
    for (const ns of nsCheck.missingJsonFiles) {
      console.log(`  - ${ns}.json (was ${ns}.ts in main)`)
    }
    hasNamespaceError = true
  }
  else {
    console.log('\n✅ All namespaces from main branch have corresponding JSON files')
  }

  if (nsCheck.unexpectedTsFiles.length > 0) {
    console.log('\n❌ Unexpected TS files (should be deleted):')
    for (const ns of nsCheck.unexpectedTsFiles) {
      console.log(`  - ${ns}.ts`)
    }
    hasNamespaceError = true
  }
  else {
    console.log('✅ No TS files in current branch (all converted to JSON)')
  }

  console.log()

  const files = getTranslationFiles()
  const allResults: AnalysisResult[] = []

  let totalMissing = 0
  let totalChanged = 0
  let totalNew = 0

  for (const file of files) {
    const result = analyzeFile(file)
    allResults.push(result)

    totalMissing += result.missingKeys.length
    totalChanged += result.changedValues.length
    totalNew += result.newKeys.length
  }

  // Summary
  console.log('📊 Key Analysis Summary')
  console.log('='.repeat(60))
  console.log(`Total files analyzed: ${files.length}`)
  console.log(`Missing keys (in main but not in current): ${totalMissing}`)
  console.log(`Changed values: ${totalChanged}`)
  console.log(`New keys: ${totalNew}`)
  console.log()

  // Detailed report
  if (totalMissing > 0) {
    console.log('\n❌ MISSING KEYS (exist in main but not in current branch)')
    console.log('='.repeat(60))
    for (const result of allResults) {
      if (result.missingKeys.length > 0) {
        console.log(`\n📁 ${result.file}:`)
        for (const key of result.missingKeys) {
          console.log(`  - ${key}`)
        }
      }
    }
  }

  if (totalChanged > 0) {
    console.log('\n⚠️  CHANGED VALUES (same key, different value)')
    console.log('='.repeat(60))
    for (const result of allResults) {
      if (result.changedValues.length > 0) {
        console.log(`\n📁 ${result.file}:`)
        for (const { key, oldValue, newValue } of result.changedValues) {
          console.log(`  Key: ${key}`)
          console.log(`    Old: ${formatValue(oldValue)}`)
          console.log(`    New: ${formatValue(newValue)}`)
          console.log()
        }
      }
    }
  }

  if (totalNew > 0) {
    console.log('\n✨ NEW KEYS (exist in current branch but not in main)')
    console.log('='.repeat(60))
    for (const result of allResults) {
      if (result.newKeys.length > 0) {
        console.log(`\n📁 ${result.file}:`)
        for (const { key, value } of result.newKeys) {
          console.log(`  + ${key}: ${formatValue(value)}`)
        }
      }
    }
  }

  // Write detailed report to JSON file
  const reportPath = path.join(__dirname, '../i18n-analysis-report.json')
  fs.writeFileSync(reportPath, JSON.stringify({
    summary: {
      totalFiles: files.length,
      missingKeys: totalMissing,
      changedValues: totalChanged,
      newKeys: totalNew,
    },
    namespaceCheck: {
      mainNamespaces: nsCheck.mainNamespaces,
      currentJsonFiles: nsCheck.currentJsonFiles,
      missingJsonFiles: nsCheck.missingJsonFiles,
      unexpectedTsFiles: nsCheck.unexpectedTsFiles,
    },
    details: allResults,
  }, null, 2))

  console.log(`\n📄 Detailed report written to: i18n-analysis-report.json`)

  // Exit with error code if there are issues
  if (hasNamespaceError) {
    console.log('\n⚠️  Warning: Namespace file issues detected!')
    process.exit(1)
  }

  if (totalMissing > 0) {
    console.log('\n⚠️  Warning: Some keys are missing in the current branch!')
    process.exit(1)
  }

  console.log('\n✅ All namespace files and keys from main branch exist in current branch.')
}

main()
