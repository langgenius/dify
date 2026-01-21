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

function extractTags(str) {
  const matches = str.matchAll(/<\/?([A-Z0-9]+)(?:\s[^<>]*)?>/gi)
  const tags = []
  for (const match of matches)
    tags.push(match[1])
  return Array.from(new Set(tags)).sort()
}

function getTagBalanceIssues(str) {
  const matches = str.matchAll(/<\/?([A-Z0-9]+)(?:\s[^<>]*)?>/gi)
  const stack = []
  const mismatches = []
  const unexpectedClosings = []

  for (const match of matches) {
    const tagName = match[1]
    const token = match[0]
    const isClosing = token.startsWith('</')
    const isSelfClosing = token.endsWith('/>')

    if (isSelfClosing)
      continue

    if (!isClosing) {
      stack.push(tagName)
      continue
    }

    if (stack.length === 0) {
      unexpectedClosings.push(tagName)
      continue
    }

    const expected = stack[stack.length - 1]
    if (expected !== tagName) {
      mismatches.push({ expected, got: tagName })
      continue
    }

    stack.pop()
  }

  return {
    missingClosings: stack.slice(),
    unexpectedClosings,
    mismatches,
  }
}

function formatTags(tags) {
  if (tags.length === 0)
    return 'none'
  return `<${tags.join('>, <')}>`
}

function formatClosingTags(tags) {
  if (tags.length === 0)
    return 'none'
  return tags.map(tag => `</${tag}>`).join(', ')
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

            let message = `Placeholder mismatch in "${key}" (${lang}): `
            const details = []

            if (missing.length > 0)
              details.push(`missing {{${missing.join('}}, {{')}}}`)

            if (extra.length > 0)
              details.push(`extra {{${extra.join('}}, {{')}}}`)

            message += details.join('; ')
            message += `. Expected: {{${englishPlaceholders.join('}}, {{') || 'none'}}}`
            message += `. Got: {{${currentPlaceholders.join('}}, {{') || 'none'}}}`

            context.report({
              node,
              message,
            })
          }

          const currentTags = extractTags(currentValue)
          const englishTags = extractTags(englishValue)

          if (!arraysEqual(currentTags, englishTags)) {
            const missing = englishTags.filter(tag => !currentTags.includes(tag))
            const extra = currentTags.filter(tag => !englishTags.includes(tag))

            let message = `Tag mismatch in "${key}" (${lang}): `
            const details = []

            if (missing.length > 0)
              details.push(`missing ${formatTags(missing)}`)

            if (extra.length > 0)
              details.push(`extra ${formatTags(extra)}`)

            message += details.join('; ')
            message += `. Expected: ${formatTags(englishTags)}`
            message += `. Got: ${formatTags(currentTags)}`

            context.report({
              node,
              message,
            })
          }

          const { missingClosings, unexpectedClosings, mismatches } = getTagBalanceIssues(currentValue)
          if (missingClosings.length > 0 || unexpectedClosings.length > 0 || mismatches.length > 0) {
            const expectedClosings = Array.from(new Set([
              ...missingClosings,
              ...mismatches.map(mismatch => mismatch.expected),
            ])).sort()
            const gotClosings = Array.from(new Set([
              ...unexpectedClosings,
              ...mismatches.map(mismatch => mismatch.got),
            ])).sort()

            const details = []
            if (missingClosings.length > 0)
              details.push(`missing ${formatClosingTags(Array.from(new Set(missingClosings)).sort())}`)
            if (unexpectedClosings.length > 0)
              details.push(`unexpected ${formatClosingTags(Array.from(new Set(unexpectedClosings)).sort())}`)
            if (mismatches.length > 0) {
              const mismatchDetails = mismatches
                .map(mismatch => `</${mismatch.expected}> vs </${mismatch.got}>`)
                .join(', ')
              details.push(`mismatched ${mismatchDetails}`)
            }

            let message = `Unbalanced tags in "${key}" (${lang}): ${details.join('; ')}`
            message += `. Expected: ${formatClosingTags(expectedClosings)}`
            message += `. Got: ${formatClosingTags(gotClosings)}`

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
