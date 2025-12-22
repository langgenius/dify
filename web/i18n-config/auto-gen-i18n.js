import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { transpile } from 'typescript'
import { parseModule, generateCode, loadFile } from 'magicast'
import { translate } from 'bing-translate-api'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const data = require('./languages.json')

const targetLanguage = 'en-US'
const i18nFolder = '../i18n' // Path to i18n folder relative to this script
// https://github.com/plainheart/bing-translate-api/blob/master/src/met/lang.json
const languageKeyMap = data.languages.reduce((map, language) => {
  if (language.supported) {
    if (language.value === 'zh-Hans' || language.value === 'zh-Hant')
      map[language.value] = language.value
    else
      map[language.value] = language.value.split('-')[0]
  }

  return map
}, {})

const supportedLanguages = Object.keys(languageKeyMap)

function parseArgs(argv) {
  const args = {
    files: [],
    languages: [],
    isDryRun: false,
    help: false,
    errors: [],
  }

  const collectValues = (startIndex) => {
    const values = []
    let cursor = startIndex + 1
    while (cursor < argv.length && !argv[cursor].startsWith('--')) {
      const value = argv[cursor].trim()
      if (value) values.push(value)
      cursor++
    }
    return { values, nextIndex: cursor - 1 }
  }

  const validateList = (values, flag) => {
    if (!values.length) {
      args.errors.push(`${flag} requires at least one value. Example: ${flag} app billing`)
      return false
    }

    const invalid = values.find(value => value.includes(','))
    if (invalid) {
      args.errors.push(`${flag} expects space-separated values. Example: ${flag} app billing`)
      return false
    }

    return true
  }

  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index]

    if (arg === '--dry-run') {
      args.isDryRun = true
      continue
    }

    if (arg === '--help' || arg === '-h') {
      args.help = true
      break
    }

    if (arg.startsWith('--file=')) {
      args.errors.push('--file expects space-separated values. Example: --file app billing')
      continue
    }

    if (arg === '--file') {
      const { values, nextIndex } = collectValues(index)
      if (validateList(values, '--file'))
        args.files.push(...values)
      index = nextIndex
      continue
    }

    if (arg.startsWith('--lang=')) {
      args.errors.push('--lang expects space-separated values. Example: --lang zh-Hans ja-JP')
      continue
    }

    if (arg === '--lang') {
      const { values, nextIndex } = collectValues(index)
      if (validateList(values, '--lang'))
        args.languages.push(...values)
      index = nextIndex
      continue
    }
  }

  return args
}

function printHelp() {
  console.log(`Usage: pnpm run auto-gen-i18n [options]

Options:
  --file <name...>  Process only specific files; provide space-separated names and repeat --file if needed
  --lang <locale>   Process only specific locales; provide space-separated locales and repeat --lang if needed (default: all supported except en-US)
  --dry-run         Preview changes without writing files
  -h, --help        Show help

Examples:
  pnpm run auto-gen-i18n -- --file app common --lang zh-Hans ja-JP
  pnpm run auto-gen-i18n -- --dry-run
`)
}

function protectPlaceholders(text) {
  const placeholders = []
  let safeText = text
  const patterns = [
    /\{\{[^{}]+\}\}/g, // mustache
    /\$\{[^{}]+\}/g, // template expressions
    /<[^>]+?>/g, // html-like tags
  ]

  patterns.forEach((pattern) => {
    safeText = safeText.replace(pattern, (match) => {
      const token = `__PH_${placeholders.length}__`
      placeholders.push({ token, value: match })
      return token
    })
  })

  return {
    safeText,
    restore(translated) {
      return placeholders.reduce((result, { token, value }) => result.replace(new RegExp(token, 'g'), value), translated)
    },
  }
}

async function translateText(source, toLanguage) {
  if (typeof source !== 'string')
    return { value: source, skipped: false }

  const trimmed = source.trim()
  if (!trimmed)
    return { value: source, skipped: false }

  const { safeText, restore } = protectPlaceholders(source)

  try {
    const { translation } = await translate(safeText, null, languageKeyMap[toLanguage])
    return { value: restore(translation), skipped: false }
  }
 catch (error) {
    console.error(`❌ Error translating to ${toLanguage}:`, error.message)
    return { value: source, skipped: true, error: error.message }
  }
}

async function translateMissingKeyDeeply(sourceObj, targetObject, toLanguage) {
  const skippedKeys = []
  const translatedKeys = []

  const entries = Object.keys(sourceObj)

  const processArray = async (sourceArray, targetArray, parentKey) => {
    for (let i = 0; i < sourceArray.length; i++) {
      const item = sourceArray[i]
      const pathKey = `${parentKey}[${i}]`

      const existingTarget = targetArray[i]

      if (typeof item === 'object' && item !== null) {
        const targetChild = (Array.isArray(existingTarget) || typeof existingTarget === 'object') ? existingTarget : (Array.isArray(item) ? [] : {})
        const childResult = await translateMissingKeyDeeply(item, targetChild, toLanguage)
        targetArray[i] = targetChild
        skippedKeys.push(...childResult.skipped.map(k => `${pathKey}.${k}`))
        translatedKeys.push(...childResult.translated.map(k => `${pathKey}.${k}`))
      }
      else {
        if (existingTarget !== undefined)
          continue

        const translationResult = await translateText(item, toLanguage)
        targetArray[i] = translationResult.value ?? ''
        if (translationResult.skipped)
          skippedKeys.push(`${pathKey}: ${item}`)
        else
          translatedKeys.push(pathKey)
      }
    }
  }

  for (const key of entries) {
    const sourceValue = sourceObj[key]
    const targetValue = targetObject[key]

    if (targetValue === undefined) {
      if (Array.isArray(sourceValue)) {
        const translatedArray = []
        await processArray(sourceValue, translatedArray, key)
        targetObject[key] = translatedArray
      }
      else if (typeof sourceValue === 'object' && sourceValue !== null) {
        targetObject[key] = {}
        const result = await translateMissingKeyDeeply(sourceValue, targetObject[key], toLanguage)
        skippedKeys.push(...result.skipped.map(k => `${key}.${k}`))
        translatedKeys.push(...result.translated.map(k => `${key}.${k}`))
      }
      else {
        const translationResult = await translateText(sourceValue, toLanguage)
        targetObject[key] = translationResult.value ?? ''
        if (translationResult.skipped)
          skippedKeys.push(`${key}: ${sourceValue}`)
        else
          translatedKeys.push(key)
      }
    }
    else if (Array.isArray(sourceValue)) {
      const targetArray = Array.isArray(targetValue) ? targetValue : []
      await processArray(sourceValue, targetArray, key)
      targetObject[key] = targetArray
    }
    else if (typeof sourceValue === 'object' && sourceValue !== null) {
      const targetChild = targetValue && typeof targetValue === 'object' ? targetValue : {}
      targetObject[key] = targetChild
      const result = await translateMissingKeyDeeply(sourceValue, targetChild, toLanguage)
      skippedKeys.push(...result.skipped.map(k => `${key}.${k}`))
      translatedKeys.push(...result.translated.map(k => `${key}.${k}`))
    }
    else {
      // Overwrite when type is different or value is missing to keep structure in sync
      const shouldUpdate = typeof targetValue !== typeof sourceValue || targetValue === undefined || targetValue === null
      if (shouldUpdate) {
        const translationResult = await translateText(sourceValue, toLanguage)
        targetObject[key] = translationResult.value ?? ''
        if (translationResult.skipped)
          skippedKeys.push(`${key}: ${sourceValue}`)
        else
          translatedKeys.push(key)
      }
    }
  }

  return { skipped: skippedKeys, translated: translatedKeys }
}
async function autoGenTrans(fileName, toGenLanguage, isDryRun = false) {
  const fullKeyFilePath = path.resolve(__dirname, i18nFolder, targetLanguage, `${fileName}.ts`)
  const toGenLanguageFilePath = path.resolve(__dirname, i18nFolder, toGenLanguage, `${fileName}.ts`)

  try {
    const content = fs.readFileSync(fullKeyFilePath, 'utf8')

    // Create a safer module environment for vm
    const moduleExports = {}
    const context = {
      exports: moduleExports,
      module: { exports: moduleExports },
      require,
      console,
      __filename: fullKeyFilePath,
      __dirname: path.dirname(fullKeyFilePath),
    }

    // Use vm.runInNewContext instead of eval for better security
    vm.runInNewContext(transpile(content), context)

    const fullKeyContent = moduleExports.default || moduleExports

    if (!fullKeyContent || typeof fullKeyContent !== 'object')
      throw new Error(`Failed to extract translation object from ${fullKeyFilePath}`)

    // if toGenLanguageFilePath is not exist, create it
    if (!fs.existsSync(toGenLanguageFilePath)) {
      fs.writeFileSync(toGenLanguageFilePath, `const translation = {
}

export default translation
`)
    }
    // To keep object format and format it for magicast to work: const translation = { ... } => export default {...}
    const readContent = await loadFile(toGenLanguageFilePath)
    const { code: toGenContent } = generateCode(readContent)

    const mod = await parseModule(`export default ${toGenContent.replace('export default translation', '').replace('const translation = ', '')}`)
    const toGenOutPut = mod.exports.default

    console.log(`\n🌍 Processing ${fileName} for ${toGenLanguage}...`)
    const result = await translateMissingKeyDeeply(fullKeyContent, toGenOutPut, toGenLanguage)

    // Generate summary report
    console.log(`\n📊 Translation Summary for ${fileName} -> ${toGenLanguage}:`)
    console.log(`  ✅ Translated: ${result.translated.length} keys`)
    console.log(`  ⏭️  Skipped: ${result.skipped.length} keys`)

    if (result.skipped.length > 0) {
      console.log(`\n⚠️  Skipped keys in ${fileName} (${toGenLanguage}):`)
      result.skipped.slice(0, 5).forEach(item => console.log(`    - ${item}`))
      if (result.skipped.length > 5)
        console.log(`    ... and ${result.skipped.length - 5} more`)
    }

    const { code } = generateCode(mod)
    let res = `const translation =${code.replace('export default', '')}

export default translation
`.replace(/,\n\n/g, ',\n').replace('};', '}')

    if (!isDryRun) {
      fs.writeFileSync(toGenLanguageFilePath, res)
      console.log(`💾 Saved translations to ${toGenLanguageFilePath}`)
    }
 else {
      console.log(`🔍 [DRY RUN] Would save translations to ${toGenLanguageFilePath}`)
    }

    return result
  }
 catch (error) {
    console.error(`Error processing file ${fullKeyFilePath}:`, error.message)
    throw error
  }
}

// Add command line argument support
const args = parseArgs(process.argv)
const isDryRun = args.isDryRun
const targetFiles = args.files
const targetLangs = args.languages

// Rate limiting helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  if (args.help) {
    printHelp()
    return
  }

  if (args.errors.length) {
    args.errors.forEach(message => console.error(`❌ ${message}`))
    printHelp()
    process.exit(1)
    return
  }

  console.log('🚀 Starting auto-gen-i18n script...')
  console.log(`📋 Mode: ${isDryRun ? 'DRY RUN (no files will be modified)' : 'LIVE MODE'}`)

  const filesInEn = fs
    .readdirSync(path.resolve(__dirname, i18nFolder, targetLanguage))
    .filter(file => /\.ts$/.test(file)) // Only process .ts files
    .map(file => file.replace(/\.ts$/, ''))

  // Filter by target files if specified
  const filesToProcess = targetFiles.length > 0 ? filesInEn.filter(f => targetFiles.includes(f)) : filesInEn
  const languagesToProcess = Array.from(new Set((targetLangs.length > 0 ? targetLangs : supportedLanguages)
    .filter(lang => lang !== targetLanguage)))

  const unknownLangs = languagesToProcess.filter(lang => !languageKeyMap[lang])
  if (unknownLangs.length) {
    console.error(`❌ Unsupported languages: ${unknownLangs.join(', ')}`)
    process.exit(1)
  }

  if (!filesToProcess.length) {
    console.log('ℹ️  No files to process based on provided arguments')
    return
  }

  if (!languagesToProcess.length) {
    console.log('ℹ️  No languages to process (did you only specify en-US?)')
    return
  }

  console.log(`📁 Files to process: ${filesToProcess.join(', ')}`)
  console.log(`🌍 Languages to process: ${languagesToProcess.join(', ')}`)

  let totalTranslated = 0
  let totalSkipped = 0
  let totalErrors = 0

  // Process files sequentially to avoid API rate limits
  for (const file of filesToProcess) {
    console.log(`\n📄 Processing file: ${file}`)

    // Process languages with rate limiting
    for (const language of languagesToProcess) {
      try {
        const result = await autoGenTrans(file, language, isDryRun)
        totalTranslated += result.translated.length
        totalSkipped += result.skipped.length

        // Rate limiting: wait 500ms between language processing
        await delay(500)
      }
      catch (e) {
        console.error(`❌ Error translating ${file} to ${language}:`, e.message)
        totalErrors++
      }
    }
  }

  // Final summary
  console.log('\n🎉 Auto-translation completed!')
  console.log('📊 Final Summary:')
  console.log(`  ✅ Total keys translated: ${totalTranslated}`)
  console.log(`  ⏭️  Total keys skipped: ${totalSkipped}`)
  console.log(`  ❌ Total errors: ${totalErrors}`)

  if (isDryRun)
    console.log('\n💡 This was a dry run. To actually translate, run without --dry-run flag.')

  if (totalErrors > 0)
    process.exitCode = 1
}

main().catch((error) => {
  console.error('❌ Unexpected error:', error.message)
  process.exit(1)
})
