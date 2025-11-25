const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const transpile = require('typescript').transpile
const magicast = require('magicast')
const { parseModule, generateCode, loadFile } = magicast
const bingTranslate = require('bing-translate-api')
const { translate } = bingTranslate
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

    if (arg.startsWith('--file')) {
      const value = arg.includes('=') ? arg.split('=')[1] : argv[index + 1]
      if (!arg.includes('=') && argv[index + 1])
        index++
      if (value)
        args.files.push(value)
      continue
    }

    if (arg.startsWith('--lang')) {
      const value = arg.includes('=') ? arg.split('=')[1] : argv[index + 1]
      if (!arg.includes('=') && argv[index + 1])
        index++
      if (value)
        args.languages.push(...value.split(',').map(item => item.trim()).filter(Boolean))
      continue
    }
  }

  return args
}

function printHelp() {
  console.log(`Usage: pnpm run auto-gen-i18n [options]

Options:
  --file <name>     仅处理指定文件，可重复多次或使用逗号分隔
  --lang <locale>   仅处理指定语言，可重复多次或使用逗号分隔（默认所有已支持语言，排除 en-US）
  --dry-run         仅预览，不写回文件
  -h, --help        查看帮助

示例:
  pnpm run auto-gen-i18n --file app --file common --lang zh-Hans,ja-JP
  pnpm run auto-gen-i18n --dry-run
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
        targetArray[i] = translationResult.value
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
