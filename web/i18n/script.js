/* eslint-disable no-eval */
const fs = require('node:fs')
const path = require('node:path')
const transpile = require('typescript').transpile
const folderPath = path.join(__dirname, 'en-US')

fs.readdir(folderPath, (err, files) => {
  if (err) {
    console.error('Error reading folder:', err)
    return
  }

  files.forEach((file) => {
    const filePath = path.join(folderPath, file)
    const fileName = file.replace(/\.[^/.]+$/, '') // Remove file extension
    const camelCaseFileName = fileName.replace(/[-_](.)/g, (_, c) => c.toUpperCase()) // Convert to camel case
    console.log(camelCaseFileName)

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

    const allKeys = [...keys, ...nestedKeys].map(key => `${camelCaseFileName}.${key}`)
    console.log(allKeys)
  })
})
