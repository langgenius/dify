/* eslint-disable no-eval */
const fs = require('node:fs')
const path = require('node:path')
const transpile = require('typescript').transpile
const magicast = require('magicast')
const { parseModule, generateCode, loadFile } = magicast
const bingTranslate = require('bing-translate-api')
const { translate } = bingTranslate
const data = require('./languages.json')

const targetLanguage = 'en-US'
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
  await Promise.all(Object.keys(sourceObj).map(async (key) => {
    if (targetObject[key] === undefined) {
      if (typeof sourceObj[key] === 'object') {
        targetObject[key] = {}
        await translateMissingKeyDeeply(sourceObj[key], targetObject[key], toLanguage)
      }
      else {
        const { translation } = await translate(sourceObj[key], null, languageKeyMap[toLanguage])
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
  // const fileName = 'workflow'
  // Promise.all(Object.keys(languageKeyMap).map(async (toLanguage) => {
  //   await autoGenTrans(fileName, toLanguage)
  // }))

  const files = fs
    .readdirSync(path.join(__dirname, targetLanguage))
    .map(file => file.replace(/\.ts/, ''))
    .filter(f => f !== 'app-debug') // ast parse error in app-debug

  await Promise.all(files.map(async (file) => {
    await Promise.all(Object.keys(languageKeyMap).map(async (language) => {
      await autoGenTrans(file, language)
    }))
  }))
}

main()
