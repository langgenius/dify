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

async function translateMissingKeyDeeply(sourceObj, targetObject, toLanguage) {
  const skippedKeys = []
  const translatedKeys = []

  await Promise.all(Object.keys(sourceObj).map(async (key) => {
    if (targetObject[key] === undefined) {
      if (typeof sourceObj[key] === 'object') {
        targetObject[key] = {}
        const result = await translateMissingKeyDeeply(sourceObj[key], targetObject[key], toLanguage)
        skippedKeys.push(...result.skipped)
        translatedKeys.push(...result.translated)
      }
      else {
        try {
          const source = sourceObj[key]
          if (!source) {
            targetObject[key] = ''
            return
          }

          // Only skip obvious code patterns, not normal text with parentheses
          const codePatterns = [
            /\{\{.*\}\}/, // Template variables like {{key}}
            /\$\{.*\}/, // Template literals ${...}
            /<[^>]+>/, // HTML/XML tags
            /function\s*\(/, // Function definitions
            /=\s*\(/, // Assignment with function calls
          ]

          const isCodeLike = codePatterns.some(pattern => pattern.test(source))
          if (isCodeLike) {
            console.log(`⏭️  Skipping code-like content: "${source.substring(0, 50)}..."`)
            skippedKeys.push(`${key}: ${source}`)
            return
          }

          console.log(`🔄 Translating: "${source}" to ${toLanguage}`)
          const { translation } = await translate(sourceObj[key], null, languageKeyMap[toLanguage])
          targetObject[key] = translation
          translatedKeys.push(`${key}: ${translation}`)
          console.log(`✅ Translated: "${translation}"`)
        }
        catch (error) {
          console.error(`❌ Error translating "${sourceObj[key]}" to ${toLanguage}. Key: ${key}`, error.message)
          skippedKeys.push(`${key}: ${sourceObj[key]} (Error: ${error.message})`)

          // Add retry mechanism for network errors
          if (error.message.includes('network') || error.message.includes('timeout')) {
            console.log(`🔄 Retrying translation for key: ${key}`)
            try {
              await new Promise(resolve => setTimeout(resolve, 1000)) // Wait 1 second
              const { translation } = await translate(sourceObj[key], null, languageKeyMap[toLanguage])
              targetObject[key] = translation
              translatedKeys.push(`${key}: ${translation}`)
              console.log(`✅ Retry successful: "${translation}"`)
            }
 catch (retryError) {
              console.error(`❌ Retry failed for key ${key}:`, retryError.message)
            }
          }
        }
      }
    }
    else if (typeof sourceObj[key] === 'object') {
      targetObject[key] = targetObject[key] || {}
      const result = await translateMissingKeyDeeply(sourceObj[key], targetObject[key], toLanguage)
      skippedKeys.push(...result.skipped)
      translatedKeys.push(...result.translated)
    }
  }))

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
    const res = `const translation =${code.replace('export default', '')}

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
const isDryRun = process.argv.includes('--dry-run')
const targetFile = process.argv.find(arg => arg.startsWith('--file='))?.split('=')[1]
const targetLang = process.argv.find(arg => arg.startsWith('--lang='))?.split('=')[1]

// Rate limiting helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  console.log('🚀 Starting auto-gen-i18n script...')
  console.log(`📋 Mode: ${isDryRun ? 'DRY RUN (no files will be modified)' : 'LIVE MODE'}`)

  const files = fs
    .readdirSync(path.resolve(__dirname, i18nFolder, targetLanguage))
    .filter(file => /\.ts$/.test(file)) // Only process .ts files
    .map(file => file.replace(/\.ts$/, ''))
    .filter(f => f !== 'app-debug') // ast parse error in app-debug

  // Filter by target file if specified
  const filesToProcess = targetFile ? files.filter(f => f === targetFile) : files
  const languagesToProcess = targetLang ? [targetLang] : Object.keys(languageKeyMap)

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
}

main()
