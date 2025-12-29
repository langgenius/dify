import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import data from '../i18n-config/languages'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const targetLanguage = 'en-US'

const languages = data.languages.filter(language => language.supported).map(language => language.value)

function parseArgs(argv) {
  const args = {
    files: [],
    languages: [],
    autoRemove: false,
    help: false,
    errors: [],
  }

  const collectValues = (startIndex) => {
    const values = []
    let cursor = startIndex + 1
    while (cursor < argv.length && !argv[cursor].startsWith('--')) {
      const value = argv[cursor].trim()
      if (value)
        values.push(value)
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

    if (arg === '--auto-remove') {
      args.autoRemove = true
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
  console.log(`Usage: pnpm run i18n:check [options]

Options:
  --file <name...>  Check only specific files; provide space-separated names and repeat --file if needed
  --lang <locale>   Check only specific locales; provide space-separated locales and repeat --lang if needed
  --auto-remove     Remove extra keys automatically
  -h, --help        Show help

Examples:
  pnpm run i18n:check --file app billing --lang zh-Hans ja-JP
  pnpm run i18n:check --auto-remove
`)
}

async function getKeysFromLanguage(language) {
  return new Promise((resolve, reject) => {
    const folderPath = path.resolve(__dirname, '../i18n', language)
    const allKeys = []
    fs.readdir(folderPath, (err, files) => {
      if (err) {
        console.error('Error reading folder:', err)
        reject(err)
        return
      }

      // Filter only .json files
      const translationFiles = files.filter(file => /\.json$/.test(file))

      translationFiles.forEach((file) => {
        const filePath = path.join(folderPath, file)
        const fileName = file.replace(/\.json$/, '') // Remove file extension
        const camelCaseFileName = fileName.replace(/[-_](.)/g, (_, c) =>
          c.toUpperCase()) // Convert to camel case

        try {
          const content = fs.readFileSync(filePath, 'utf8')
          const translationObj = JSON.parse(content)

          if (!translationObj || typeof translationObj !== 'object') {
            console.error(`Error parsing file: ${filePath}`)
            reject(new Error(`Error parsing file: ${filePath}`))
            return
          }

          // Flat structure: just get all keys directly
          const fileKeys = Object.keys(translationObj).map(key => `${camelCaseFileName}.${key}`)
          allKeys.push(...fileKeys)
        }
        catch (error) {
          console.error(`Error processing file ${filePath}:`, error.message)
          reject(error)
        }
      })
      resolve(allKeys)
    })
  })
}

async function removeExtraKeysFromFile(language, fileName, extraKeys) {
  const filePath = path.resolve(__dirname, '../i18n', language, `${fileName}.json`)

  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  File not found: ${filePath}`)
    return false
  }

  try {
    // Filter keys that belong to this file
    const camelCaseFileName = fileName.replace(/[-_](.)/g, (_, c) => c.toUpperCase())
    const fileSpecificKeys = extraKeys
      .filter(key => key.startsWith(`${camelCaseFileName}.`))
      .map(key => key.substring(camelCaseFileName.length + 1)) // Remove file prefix

    if (fileSpecificKeys.length === 0)
      return false

    console.log(`🔄 Processing file: ${filePath}`)

    // Read and parse JSON
    const content = fs.readFileSync(filePath, 'utf8')
    const translationObj = JSON.parse(content)

    let modified = false

    // Remove each extra key (flat structure - direct property deletion)
    for (const keyToRemove of fileSpecificKeys) {
      if (keyToRemove in translationObj) {
        delete translationObj[keyToRemove]
        console.log(`🗑️  Removed key: ${keyToRemove}`)
        modified = true
      }
      else {
        console.log(`⚠️  Could not find key: ${keyToRemove}`)
      }
    }

    if (modified) {
      // Write back to file
      const newContent = `${JSON.stringify(translationObj, null, 2)}\n`
      fs.writeFileSync(filePath, newContent)
      console.log(`💾 Updated file: ${filePath}`)
      return true
    }

    return false
  }
  catch (error) {
    console.error(`Error processing file ${filePath}:`, error.message)
    return false
  }
}

// Add command line argument support
const args = parseArgs(process.argv)
const targetFiles = Array.from(new Set(args.files))
const targetLangs = Array.from(new Set(args.languages))
const autoRemove = args.autoRemove

async function main() {
  const compareKeysCount = async () => {
    let hasDiff = false
    const allTargetKeys = await getKeysFromLanguage(targetLanguage)

    // Filter target keys by file if specified
    const camelTargetFiles = targetFiles.map(file => file.replace(/[-_](.)/g, (_, c) => c.toUpperCase()))
    const targetKeys = targetFiles.length
      ? allTargetKeys.filter(key => camelTargetFiles.some(file => key.startsWith(`${file}.`)))
      : allTargetKeys

    // Filter languages by target language if specified
    const languagesToProcess = targetLangs.length ? targetLangs : languages

    const allLanguagesKeys = await Promise.all(languagesToProcess.map(language => getKeysFromLanguage(language)))

    // Filter language keys by file if specified
    const languagesKeys = targetFiles.length
      ? allLanguagesKeys.map(keys => keys.filter(key => camelTargetFiles.some(file => key.startsWith(`${file}.`))))
      : allLanguagesKeys

    const keysCount = languagesKeys.map(keys => keys.length)
    const targetKeysCount = targetKeys.length

    const comparison = languagesToProcess.reduce((result, language, index) => {
      const languageKeysCount = keysCount[index]
      const difference = targetKeysCount - languageKeysCount
      result[language] = difference
      return result
    }, {})

    console.log(comparison)

    // Print missing keys and extra keys
    for (let index = 0; index < languagesToProcess.length; index++) {
      const language = languagesToProcess[index]
      const languageKeys = languagesKeys[index]
      const missingKeys = targetKeys.filter(key => !languageKeys.includes(key))
      const extraKeys = languageKeys.filter(key => !targetKeys.includes(key))

      console.log(`Missing keys in ${language}:`, missingKeys)
      if (missingKeys.length > 0)
        hasDiff = true

      // Show extra keys only when there are extra keys (negative difference)
      if (extraKeys.length > 0) {
        console.log(`Extra keys in ${language} (not in ${targetLanguage}):`, extraKeys)

        // Auto-remove extra keys if flag is set
        if (autoRemove) {
          console.log(`\n🤖 Auto-removing extra keys from ${language}...`)

          // Get all translation files
          const i18nFolder = path.resolve(__dirname, '../i18n', language)
          const files = fs.readdirSync(i18nFolder)
            .filter(file => /\.json$/.test(file))
            .map(file => file.replace(/\.json$/, ''))
            .filter(f => targetFiles.length === 0 || targetFiles.includes(f))

          let totalRemoved = 0
          for (const fileName of files) {
            const removed = await removeExtraKeysFromFile(language, fileName, extraKeys)
            if (removed)
              totalRemoved++
          }

          console.log(`✅ Auto-removal completed for ${language}. Modified ${totalRemoved} files.`)
        }
        else {
          hasDiff = true
        }
      }
    }

    return hasDiff
  }

  console.log('🚀 Starting i18n:check script...')
  if (targetFiles.length)
    console.log(`📁 Checking files: ${targetFiles.join(', ')}`)

  if (targetLangs.length)
    console.log(`🌍 Checking languages: ${targetLangs.join(', ')}`)

  if (autoRemove)
    console.log('🤖 Auto-remove mode: ENABLED')

  const hasDiff = await compareKeysCount()
  if (hasDiff) {
    console.error('\n❌ i18n keys are not aligned. Fix issues above.')
    process.exitCode = 1
  }
  else {
    console.log('\n✅ All i18n files are in sync')
  }
}

async function bootstrap() {
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

  const unknownLangs = targetLangs.filter(lang => !languages.includes(lang))
  if (unknownLangs.length) {
    console.error(`❌ Unsupported languages: ${unknownLangs.join(', ')}`)
    process.exit(1)
    return
  }

  await main()
}

bootstrap().catch((error) => {
  console.error('❌ Unexpected error:', error.message)
  process.exit(1)
})
