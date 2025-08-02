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
              if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
                // This is an object (but not array), recurse into it but don't add it as a key
                iterateKeys(obj[key], nestedKey)
              }
 else {
                // This is a leaf node (string, number, boolean, array, etc.), add it as a key
                nestedKeys.push(nestedKey)
              }
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
    // Filter keys that belong to this file
    const camelCaseFileName = fileName.replace(/[-_](.)/g, (_, c) => c.toUpperCase())
    const fileSpecificKeys = extraKeys
      .filter(key => key.startsWith(`${camelCaseFileName}.`))
      .map(key => key.substring(camelCaseFileName.length + 1)) // Remove file prefix

    if (fileSpecificKeys.length === 0)
      return false

    console.log(`🔄 Processing file: ${filePath}`)

    // Read the original file content
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split('\n')

    let modified = false
    const linesToRemove = []

    // Find lines to remove for each key (including multiline values)
    for (const keyToRemove of fileSpecificKeys) {
      const keyParts = keyToRemove.split('.')
      let targetLineIndex = -1
      const linesToRemoveForKey = []

      // Build regex pattern for the exact key path
      if (keyParts.length === 1) {
        // Simple key at root level like "pickDate: 'value'"
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          const simpleKeyPattern = new RegExp(`^\\s*${keyParts[0]}\\s*:`)
          if (simpleKeyPattern.test(line)) {
            targetLineIndex = i
            break
          }
        }
      }
 else {
        // Nested key - need to find the exact path
        const currentPath = []
        let braceDepth = 0

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          const trimmedLine = line.trim()

          // Track current object path
          const keyMatch = trimmedLine.match(/^(\w+)\s*:\s*{/)
          if (keyMatch) {
            currentPath.push(keyMatch[1])
            braceDepth++
          }
 else if (trimmedLine === '},' || trimmedLine === '}') {
            if (braceDepth > 0) {
              braceDepth--
              currentPath.pop()
            }
          }

          // Check if this line matches our target key
          const leafKeyMatch = trimmedLine.match(/^(\w+)\s*:/)
          if (leafKeyMatch) {
            const fullPath = [...currentPath, leafKeyMatch[1]]
            const fullPathString = fullPath.join('.')

            if (fullPathString === keyToRemove) {
              targetLineIndex = i
              break
            }
          }
        }
      }

      if (targetLineIndex !== -1) {
        linesToRemoveForKey.push(targetLineIndex)

        // Check if this is a multiline key-value pair
        const keyLine = lines[targetLineIndex]
        const trimmedKeyLine = keyLine.trim()

        // If key line ends with ":" (not ":", "{ " or complete value), it's likely multiline
        if (trimmedKeyLine.endsWith(':') && !trimmedKeyLine.includes('{') && !trimmedKeyLine.match(/:\s*['"`]/)) {
          // Find the value lines that belong to this key
          let currentLine = targetLineIndex + 1
          let foundValue = false

          while (currentLine < lines.length) {
            const line = lines[currentLine]
            const trimmed = line.trim()

            // Skip empty lines
            if (trimmed === '') {
              currentLine++
              continue
            }

            // Check if this line starts a new key (indicates end of current value)
            if (trimmed.match(/^\w+\s*:/))
              break

            // Check if this line is part of the value
            if (trimmed.startsWith('\'') || trimmed.startsWith('"') || trimmed.startsWith('`') || foundValue) {
              linesToRemoveForKey.push(currentLine)
              foundValue = true

              // Check if this line ends the value (ends with quote and comma/no comma)
              if ((trimmed.endsWith('\',') || trimmed.endsWith('",') || trimmed.endsWith('`,')
                   || trimmed.endsWith('\'') || trimmed.endsWith('"') || trimmed.endsWith('`'))
                  && !trimmed.startsWith('//'))
                break
            }
 else {
              break
            }

            currentLine++
          }
        }

        linesToRemove.push(...linesToRemoveForKey)
        console.log(`🗑️  Found key to remove: ${keyToRemove} at line ${targetLineIndex + 1}${linesToRemoveForKey.length > 1 ? ` (multiline, ${linesToRemoveForKey.length} lines)` : ''}`)
        modified = true
      }
 else {
        console.log(`⚠️  Could not find key: ${keyToRemove}`)
      }
    }

    if (modified) {
      // Remove duplicates and sort in reverse order to maintain correct indices
      const uniqueLinesToRemove = [...new Set(linesToRemove)].sort((a, b) => b - a)

      for (const lineIndex of uniqueLinesToRemove) {
        const line = lines[lineIndex]
        console.log(`🗑️  Removing line ${lineIndex + 1}: ${line.trim()}`)
        lines.splice(lineIndex, 1)

        // Also remove trailing comma from previous line if it exists and the next line is a closing brace
        if (lineIndex > 0 && lineIndex < lines.length) {
          const prevLine = lines[lineIndex - 1]
          const nextLine = lines[lineIndex] ? lines[lineIndex].trim() : ''

          if (prevLine.trim().endsWith(',') && (nextLine.startsWith('}') || nextLine === ''))
            lines[lineIndex - 1] = prevLine.replace(/,\s*$/, '')
        }
      }

      // Write back to file
      const newContent = lines.join('\n')
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
      ? allTargetKeys.filter(key => key.startsWith(`${targetFile.replace(/[-_](.)/g, (_, c) => c.toUpperCase())}.`))
      : allTargetKeys

    // Filter languages by target language if specified
    const languagesToProcess = targetLang ? [targetLang] : languages

    const allLanguagesKeys = await Promise.all(languagesToProcess.map(language => getKeysFromLanguage(language)))

    // Filter language keys by file if specified
    const languagesKeys = targetFile
      ? allLanguagesKeys.map(keys => keys.filter(key => key.startsWith(`${targetFile.replace(/[-_](.)/g, (_, c) => c.toUpperCase())}.`)))
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
