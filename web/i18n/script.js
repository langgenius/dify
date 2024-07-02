/* eslint-disable no-eval */
const fs = require('node:fs')
const path = require('node:path')
const transpile = require('typescript').transpile

const targetLanguage = 'en-US'
const data = require('./languages.json')
const languages = data.languages.filter(language => language.supported).map(language => language.value)

async function getKeysFromLanuage(language) {
  return new Promise((resolve, reject) => {
    const folderPath = path.join(__dirname, language)
    let allKeys = []
    fs.readdir(folderPath, (err, files) => {
      if (err) {
        console.error('Error reading folder:', err)
        reject(err)
        return
      }

      files.forEach((file) => {
        const filePath = path.join(folderPath, file)
        const fileName = file.replace(/\.[^/.]+$/, '') // Remove file extension
        const camelCaseFileName = fileName.replace(/[-_](.)/g, (_, c) =>
          c.toUpperCase(),
        ) // Convert to camel case
        // console.log(camelCaseFileName)
        const content = fs.readFileSync(filePath, 'utf8')
        const translation = eval(transpile(content))
        const keys = Object.keys(translation)
        const nestedKeys = []
        const iterateKeys = (obj, prefix = '') => {
          for (const key in obj) {
            const nestedKey = prefix ? `${prefix}.${key}` : key
            nestedKeys.push(nestedKey)
            if (typeof obj[key] === 'object')
              iterateKeys(obj[key], nestedKey)
          }
        }
        iterateKeys(translation)

        allKeys = [...keys, ...nestedKeys].map(
          key => `${camelCaseFileName}.${key}`,
        )
      })
      resolve(allKeys)
    })
  })
}

async function main() {
  const compareKeysCount = async () => {
    const targetKeys = await getKeysFromLanuage(targetLanguage)
    const languagesKeys = await Promise.all(languages.map(language => getKeysFromLanuage(language)))

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
