/* eslint-disable no-eval */
const fs = require('node:fs')
const path = require('node:path')
const transpile = require('typescript').transpile
const magicast = require('magicast')
const { parseModule, generateCode, loadFile } = magicast
// https://github.com/vitalets/google-translate-api
const bingTranslate = require('bing-translate-api')
const { translate } = bingTranslate
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const targetLanguage = 'en-US'
const data = require('./languages.json')
const languages = data.languages.filter(language => language.supported && language.value === 'zh-Hant').map(language => language.value)

async function translateMissingKeyDeeply(sourceObj, targetObject, toLanguage) {
  await Promise.all(Object.keys(sourceObj).map(async (key) => {
    if (targetObject[key] === undefined) {
      if (typeof sourceObj[key] === 'object') {
        targetObject[key] = {}
        await translateMissingKeyDeeply(sourceObj[key], targetObject[key], toLanguage)
      }
      else {
        const { translation } = await translate(sourceObj[key], null, toLanguage)
        targetObject[key] = translation
        // console.log(translation)
      }
    }
    else if (typeof sourceObj[key] === 'object') {
      targetObject[key] = targetObject[key] || {}
      await translateMissingKeyDeeply(sourceObj[key], targetObject[key], toLanguage)
    }
  }))
}

async function autoGenTrans(fileName, toGenLanguage) {
  const fullKeyFilePath = path.join(__dirname, targetLanguage, `${fileName}.ts`)
  const toGenLanguageFilePath = path.join(__dirname, toGenLanguage, `${fileName}.ts`)
  const fullKeyContent = eval(transpile(fs.readFileSync(fullKeyFilePath, 'utf8')))
  // To keep object format and format it for magicast to work: const translation = { ... } => export default {...}
  const readContent = await loadFile(toGenLanguageFilePath)
  const { code: toGenContent } = generateCode(readContent)
  const mod = await parseModule(`export default ${toGenContent.replace('export default translation', '').replace('const translation = ', '')}`)
  const toGenOutPut = mod.exports.default

  await translateMissingKeyDeeply(fullKeyContent, toGenOutPut, toGenLanguage)
  const { code } = generateCode(mod)
  const res = `const translation =${code.replace('export default', '')}

export default translation
`.replace(/,\n\n/g, ',\n').replace('};', '}')

  fs.writeFileSync(toGenLanguageFilePath, res)
}

async function main() {
  // for example
  // autoGenTrans('workflow', 'zh-Hant')

  // get error may cause the rate limit
  // get all files names in en-US folder
  // const files = fs.readdirSync(path.join(__dirname, targetLanguage)).map(file => file.replace(/\.ts/, '')).slice(0, 1)
  // await Promise.all(files.map(async (file) => {
  //   await Promise.all(languages.map(async (language) => {
  //     await autoGenTrans(file, language)
  //     await sleep(1000)
  //   }))
  // }))
}

main()
