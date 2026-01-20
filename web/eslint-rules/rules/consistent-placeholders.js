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
 * Extract Trans component tag markers from a string.
 * Keeps opening/closing/self-closing tags distinct.
 * @param {string} str
 * @returns {string[]} Sorted array of tag markers
 */
function extractTagMarkers(str) {
  const matches = Array.from(str.matchAll(/<\/?([A-Z][\w-]*)\b[^>]*>/gi))
  const markers = matches.map((match) => {
    const fullMatch = match[0]
    const name = match[1]
    const isClosing = fullMatch.startsWith('</')
    const isSelfClosing = !isClosing && fullMatch.endsWith('/>')

    if (isClosing)
      return `close:${name}`
    if (isSelfClosing)
      return `self:${name}`
    return `open:${name}`
  })

  return markers.sort()
}

function formatTagMarker(marker) {
  if (marker.startsWith('close:'))
    return marker.slice('close:'.length)
  if (marker.startsWith('self:'))
    return marker.slice('self:'.length)
  return marker.slice('open:'.length)
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

function uniqueSorted(items) {
  return Array.from(new Set(items)).sort()
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ensure placeholders and Trans tags in translations match the en-US source',
    },
  },
  create(context) {
    const state = {
      enabled: false,
      englishJson: null,
      englishError: null,
    }

    function isTopLevelProperty(node) {
      const objectNode = node.parent
      if (!objectNode || objectNode.type !== 'JSONObjectExpression')
        return false
      const expressionNode = objectNode.parent
      return !!expressionNode
        && (expressionNode.type === 'JSONExpressionStatement'
          || expressionNode.type === 'Program'
          || expressionNode.type === 'JSONProgram')
    }

    return {
      Program(node) {
        const { filename } = context

        if (!filename.endsWith('.json'))
          return

        const parts = normalize(filename).split(sep)
        const jsonFile = parts.at(-1)
        const lang = parts.at(-2)

        // Skip English files - they are the source of truth
        if (lang === 'en-US')
          return

        state.enabled = true

        try {
          const englishFilePath = path.join(path.dirname(filename), '..', 'en-US', jsonFile ?? '')
          const englishText = fs.readFileSync(englishFilePath, 'utf8')
          state.englishJson = JSON.parse(cleanJsonText(englishText))
        }
        catch (error) {
          state.englishError = error
          state.enabled = false
          context.report({
            node,
            message: `Error parsing JSON: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      },
      JSONProperty(node) {
        if (!state.enabled)
          return

        if (!state.englishJson || !isTopLevelProperty(node))
          return

        const key = node.key.value ?? node.key.name
        if (!key)
          return

        if (!Object.prototype.hasOwnProperty.call(state.englishJson, key))
          return

        const currentNode = node.value ?? node
        const currentValue = currentNode && currentNode.type === 'JSONLiteral' ? currentNode.value : undefined
        const englishValue = state.englishJson[key]

        // Skip non-string values
        if (typeof currentValue !== 'string' || typeof englishValue !== 'string')
          return

        const currentPlaceholders = extractPlaceholders(currentValue)
        const englishPlaceholders = extractPlaceholders(englishValue)
        const currentTagMarkers = extractTagMarkers(currentValue)
        const englishTagMarkers = extractTagMarkers(englishValue)

        if (!arraysEqual(currentPlaceholders, englishPlaceholders)) {
          const missing = englishPlaceholders.filter(p => !currentPlaceholders.includes(p))
          const extra = currentPlaceholders.filter(p => !englishPlaceholders.includes(p))

          let message = `Placeholder mismatch with en-US in "${key}": `
          const details = []

          if (missing.length > 0)
            details.push(`missing {{${missing.join('}}, {{')}}}`)

          if (extra.length > 0)
            details.push(`extra {{${extra.join('}}, {{')}}}`)

          message += details.join('; ')
          message += `. Expected: {{${englishPlaceholders.join('}}, {{') || 'none'}}}`

          context.report({
            node: currentNode,
            message,
          })
        }

        if (!arraysEqual(currentTagMarkers, englishTagMarkers)) {
          const missing = englishTagMarkers.filter(p => !currentTagMarkers.includes(p))
          const extra = currentTagMarkers.filter(p => !englishTagMarkers.includes(p))

          let message = `Trans tag mismatch with en-US in "${key}": `
          const details = []

          if (missing.length > 0)
            details.push(`missing ${uniqueSorted(missing.map(formatTagMarker)).join(', ')}`)

          if (extra.length > 0)
            details.push(`extra ${uniqueSorted(extra.map(formatTagMarker)).join(', ')}`)

          message += details.join('; ')
          message += `. Expected: ${uniqueSorted(englishTagMarkers.map(formatTagMarker)).join(', ') || 'none'}`

          context.report({
            node: currentNode,
            message,
          })
        }
      },
    }
  },
}
