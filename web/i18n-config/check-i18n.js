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

async function main() {
  const compareKeysCount = async () => {
    const targetKeys = await getKeysFromLanguage(targetLanguage)
    const languagesKeys = await Promise.all(languages.map(language => getKeysFromLanguage(language)))

    const keysCount = languagesKeys.map(keys => keys.length)
    const targetKeysCount = targetKeys.length

    const comparison = languages.reduce((result, language, index) => {
      const languageKeysCount = keysCount[index]
      const difference = targetKeysCount - languageKeysCount
      result[language] = difference
      return result
    }, {})

    console.log(comparison)

    // Print missing keys
    languages.forEach((language, index) => {
      const missingKeys = targetKeys.filter(key => !languagesKeys[index].includes(key))
      console.log(`Missing keys in ${language}:`, missingKeys)
    })
  }

  compareKeysCount()
}

main()
