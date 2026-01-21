import fs from 'node:fs'
import path, { normalize, sep } from 'node:path'
import { cleanJsonText } from '../utils.js'

/**
 * Extract placeholders from a string
 * Matches patterns like {{name}}, {{count}}, etc.
 * @param {string} str
 * @returns {string[]} Sorted array of placeholder names
 */
function extractPlaceholders(str) {
  const matches = str.match(/\{\{\w+\}\}/g) || []
  return matches.map(m => m.slice(2, -2)).sort()
}

/**
 * Compare two arrays and return if they're equal
 * @param {string[]} arr1
 * @param {string[]} arr2
 * @returns {boolean} True if arrays contain the same elements in the same order
 */
function arraysEqual(arr1, arr2) {
  if (arr1.length !== arr2.length)
    return false
  return arr1.every((val, i) => val === arr2[i])
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ensure placeholders in translations match the en-US source',
    },
  },
  create(context) {
    return {
      Program(node) {
        const { filename, sourceCode } = context

        if (!filename.endsWith('.json'))
          return

        const parts = normalize(filename).split(sep)
        const jsonFile = parts.at(-1)
        const lang = parts.at(-2)

        // Skip English files - they are the source of truth
        if (lang === 'en-US')
          return

        let currentJson = {}
        let englishJson = {}

        try {
          currentJson = JSON.parse(cleanJsonText(sourceCode.text))
          const englishFilePath = path.join(path.dirname(filename), '..', 'en-US', jsonFile ?? '')
          englishJson = JSON.parse(fs.readFileSync(englishFilePath, 'utf8'))
        }
        catch (error) {
          context.report({
            node,
            message: `Error parsing JSON: ${error instanceof Error ? error.message : String(error)}`,
          })
          return
        }

        // Check each key in the current translation
        for (const key of Object.keys(currentJson)) {
          // Skip if the key doesn't exist in English (handled by no-extra-keys rule)
          if (!Object.prototype.hasOwnProperty.call(englishJson, key))
            continue

          const currentValue = currentJson[key]
          const englishValue = englishJson[key]

          // Skip non-string values
          if (typeof currentValue !== 'string' || typeof englishValue !== 'string')
            continue

          const currentPlaceholders = extractPlaceholders(currentValue)
          const englishPlaceholders = extractPlaceholders(englishValue)

          if (!arraysEqual(currentPlaceholders, englishPlaceholders)) {
            const missing = englishPlaceholders.filter(p => !currentPlaceholders.includes(p))
            const extra = currentPlaceholders.filter(p => !englishPlaceholders.includes(p))

            let message = `Placeholder mismatch in "${key}": `
            const details = []

            if (missing.length > 0)
              details.push(`missing {{${missing.join('}}, {{')}}}`)

            if (extra.length > 0)
              details.push(`extra {{${extra.join('}}, {{')}}}`)

            message += details.join('; ')
            message += `. Expected: {{${englishPlaceholders.join('}}, {{') || 'none'}}}`

            context.report({
              node,
              message,
            })
          }
        }
      },
    }
  },
}
