const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const transpile = require('typescript').transpile

const targetLanguage = 'en-US'
const data = require('./languages.json')
const languages = data.languages.filter(language => language.supported).map(language => language.value)

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

      // Filter only .ts and .js files
      const translationFiles = files.filter(file => /\.(ts|js)$/.test(file))

      translationFiles.forEach((file) => {
        const filePath = path.join(folderPath, file)
        const fileName = file.replace(/\.[^/.]+$/, '') // Remove file extension
        const camelCaseFileName = fileName.replace(/[-_](.)/g, (_, c) =>
          c.toUpperCase(),
        ) // Convert to camel case

        try {
          const content = fs.readFileSync(filePath, 'utf8')

          // Create a safer module environment for vm
          const moduleExports = {}
          const context = {
            exports: moduleExports,
            module: { exports: moduleExports },
            require,
            console,
            __filename: filePath,
            __dirname: folderPath,
          }

          // Use vm.runInNewContext instead of eval for better security
          vm.runInNewContext(transpile(content), context)

          // Extract the translation object
          const translationObj = moduleExports.default || moduleExports

          if(!translationObj || typeof translationObj !== 'object') {
            console.error(`Error parsing file: ${filePath}`)
            reject(new Error(`Error parsing file: ${filePath}`))
            return
          }

          const nestedKeys = []
          const iterateKeys = (obj, prefix = '') => {
            for (const key in obj) {
              const nestedKey = prefix ? `${prefix}.${key}` : key
              nestedKeys.push(nestedKey)
              if (typeof obj[key] === 'object' && obj[key] !== null)
                iterateKeys(obj[key], nestedKey)
            }
          }
          iterateKeys(translationObj)

          // Fixed: accumulate keys instead of overwriting
          const fileKeys = nestedKeys.map(key => `${camelCaseFileName}.${key}`)
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

function removeKeysFromObject(obj, keysToRemove, prefix = '') {
  let modified = false
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key

    if (keysToRemove.includes(fullKey)) {
      delete obj[key]
      modified = true
      console.log(`🗑️  Removed key: ${fullKey}`)
    }
 else if (typeof obj[key] === 'object' && obj[key] !== null) {
      const subModified = removeKeysFromObject(obj[key], keysToRemove, fullKey)
      modified = modified || subModified
    }
  }
  return modified
}

async function removeExtraKeysFromFile(language, fileName, extraKeys) {
  const filePath = path.resolve(__dirname, '../i18n', language, `${fileName}.ts`)

  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  File not found: ${filePath}`)
    return false
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8')

    // Create a safer module environment for vm
    const moduleExports = {}
    const context = {
      exports: moduleExports,
      module: { exports: moduleExports },
      require,
      console,
      __filename: filePath,
      __dirname: path.dirname(filePath),
    }

    // Use vm.runInNewContext instead of eval for better security
    vm.runInNewContext(transpile(content), context)

    const translationObj = moduleExports.default || moduleExports

    if (!translationObj || typeof translationObj !== 'object') {
      console.error(`Error parsing file: ${filePath}`)
      return false
    }

    // Filter keys that belong to this file
    const camelCaseFileName = fileName.replace(/[-_](.)/g, (_, c) => c.toUpperCase())
    const fileSpecificKeys = extraKeys
      .filter(key => key.startsWith(`${camelCaseFileName}.`))
      .map(key => key.substring(camelCaseFileName.length + 1)) // Remove file prefix

    if (fileSpecificKeys.length === 0)
      return false

    console.log(`🔄 Processing file: ${filePath}`)
    const modified = removeKeysFromObject(translationObj, fileSpecificKeys)

    if (modified) {
      // Write back to file
      const newContent = `const translation = ${JSON.stringify(translationObj, null, 2)}

export default translation
`
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
const targetFile = process.argv.find(arg => arg.startsWith('--file='))?.split('=')[1]
const targetLang = process.argv.find(arg => arg.startsWith('--lang='))?.split('=')[1]
const autoRemove = process.argv.includes('--auto-remove')

async function main() {
  const compareKeysCount = async () => {
    const allTargetKeys = await getKeysFromLanguage(targetLanguage)

    // Filter target keys by file if specified
    const targetKeys = targetFile
      ? allTargetKeys.filter(key => key.startsWith(targetFile.replace(/[-_](.)/g, (_, c) => c.toUpperCase())))
      : allTargetKeys

    // Filter languages by target language if specified
    const languagesToProcess = targetLang ? [targetLang] : languages

    const allLanguagesKeys = await Promise.all(languagesToProcess.map(language => getKeysFromLanguage(language)))

    // Filter language keys by file if specified
    const languagesKeys = targetFile
      ? allLanguagesKeys.map(keys => keys.filter(key => key.startsWith(targetFile.replace(/[-_](.)/g, (_, c) => c.toUpperCase()))))
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

      // Show extra keys only when there are extra keys (negative difference)
      if (extraKeys.length > 0) {
        console.log(`Extra keys in ${language} (not in ${targetLanguage}):`, extraKeys)

        // Auto-remove extra keys if flag is set
        if (autoRemove) {
          console.log(`\n🤖 Auto-removing extra keys from ${language}...`)

          // Get all translation files
          const i18nFolder = path.resolve(__dirname, '../i18n', language)
          const files = fs.readdirSync(i18nFolder)
            .filter(file => /\.ts$/.test(file))
            .map(file => file.replace(/\.ts$/, ''))
            .filter(f => !targetFile || f === targetFile) // Filter by target file if specified

          let totalRemoved = 0
          for (const fileName of files) {
            const removed = await removeExtraKeysFromFile(language, fileName, extraKeys)
            if (removed) totalRemoved++
          }

          console.log(`✅ Auto-removal completed for ${language}. Modified ${totalRemoved} files.`)
        }
      }
    }
  }

  console.log('🚀 Starting check-i18n script...')
  if (targetFile)
    console.log(`📁 Checking file: ${targetFile}`)

  if (targetLang)
    console.log(`🌍 Checking language: ${targetLang}`)

  if (autoRemove)
    console.log('🤖 Auto-remove mode: ENABLED')

  compareKeysCount()
}

main()
