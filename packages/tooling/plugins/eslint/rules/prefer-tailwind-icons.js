const CAMEL_TO_KEBAB_UPPERCASE_REGEX = /([A-Z]+)([A-Z][a-z])/gu
const CAMEL_TO_KEBAB_LETTER_DIGIT_REGEX = /([a-z])(\d)/giu
const CAMEL_TO_KEBAB_DIGIT_LETTER_REGEX = /(\d)([a-z])/giu
const CAMEL_TO_KEBAB_LOWER_UPPER_REGEX = /([a-z\d])([A-Z])/gu
const CAMEL_TO_KEBAB_SEPARATOR_REGEX = /[_\s]+/gu
const REPEATED_DASH_REGEX = /-+/gu
const EDGE_DASH_REGEX = /^-|-$/gu
const REGEX_FLAGS_PATTERN = /^[a-z]*$/iu
const NORMALIZE_SEGMENT_SPACES_REGEX = /\s+/gu
const warned = new Set()

function warnOnce(message) {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(message)
}

function camelToKebab(value) {
  return value
    .replace(CAMEL_TO_KEBAB_UPPERCASE_REGEX, '$1-$2')
    .replace(CAMEL_TO_KEBAB_LETTER_DIGIT_REGEX, '$1-$2')
    .replace(CAMEL_TO_KEBAB_DIGIT_LETTER_REGEX, '$1-$2')
    .replace(CAMEL_TO_KEBAB_LOWER_UPPER_REGEX, '$1-$2')
    .replace(CAMEL_TO_KEBAB_SEPARATOR_REGEX, '-')
    .replace(REPEATED_DASH_REGEX, '-')
    .replace(EDGE_DASH_REGEX, '')
    .toLowerCase()
}

function pixelToClass(pixels, classPrefix) {
  if (pixels % 4 === 0) return `${classPrefix}-${pixels / 4}`
  return `${classPrefix}-[${pixels}px]`
}

function parseRegexPattern(pattern) {
  if (!pattern.startsWith('/')) return null
  let closingSlashIndex = -1
  for (let i = pattern.length - 1; i > 0; i--) {
    if (pattern[i] !== '/') continue
    let backslashCount = 0
    for (let j = i - 1; j >= 0 && pattern[j] === '\\'; j--) backslashCount++
    if (backslashCount % 2 === 0) {
      closingSlashIndex = i
      break
    }
  }
  if (closingSlashIndex <= 1) return null
  const source = pattern.slice(1, closingSlashIndex)
  const flags = pattern.slice(closingSlashIndex + 1)
  if (!REGEX_FLAGS_PATTERN.test(flags)) return null
  try {
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

function createRegex(pattern, optionName) {
  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    const literalRegex = parseRegexPattern(pattern)
    if (literalRegex) return literalRegex
    warnOnce(`[prefer-tailwind-icons] Invalid regex literal in "${optionName}": ${pattern}`)
    return null
  }
  try {
    return new RegExp(pattern)
  } catch {
    warnOnce(`[prefer-tailwind-icons] Invalid regex in "${optionName}": ${pattern}`)
    return null
  }
}

function hasRegexMatch(value, regex) {
  regex.lastIndex = 0
  return regex.test(value)
}

function normalizeSegment(value) {
  return value
    .replaceAll('/', '-')
    .replaceAll('_', '-')
    .replace(NORMALIZE_SEGMENT_SPACES_REGEX, '')
    .replace(REPEATED_DASH_REGEX, '-')
    .replace(EDGE_DASH_REGEX, '')
    .toLowerCase()
}

function getIconClass(importName, source, config, globalPrefix) {
  const prefix = config.prefix ?? globalPrefix
  config.sourceRegex.lastIndex = 0
  config.nameRegex.lastIndex = 0
  const sourceMatch = source.match(config.sourceRegex)
  const nameMatch = importName.match(config.nameRegex)
  const getGroup = (...keys) => {
    for (const key of keys) {
      const fromName = nameMatch?.groups?.[key]
      if (fromName) return fromName
      const fromSource = sourceMatch?.groups?.[key]
      if (fromSource) return fromSource
    }
    return ''
  }
  const iconSetPart = normalizeSegment(getGroup('set', 'iconSet'))
  const iconNamePart =
    camelToKebab(getGroup('name', 'icon') || importName) || camelToKebab(importName)
  const variantPart = normalizeSegment(getGroup('variant'))
  return [prefix, iconSetPart, iconNamePart, variantPart]
    .filter(Boolean)
    .join('-')
    .replace(REPEATED_DASH_REGEX, '-')
}

function normalizeLibraryConfig(config) {
  const sourceRegex = createRegex(config.source, 'libraries[].source')
  if (!sourceRegex) return null
  const nameRegex = createRegex(config.name ?? '.*', 'libraries[].name')
  if (!nameRegex) return null
  return {
    sourceRegex,
    nameRegex,
    prefix: config.prefix,
  }
}

function normalizeLibraryConfigs(configs) {
  const resolved = []
  for (const config of configs) {
    const normalized = normalizeLibraryConfig(config)
    if (normalized) resolved.push(normalized)
  }
  return resolved
}

function isNamedImportSpecifier(specifier) {
  return (
    specifier.type === 'ImportSpecifier' &&
    specifier.imported.type === 'Identifier' &&
    specifier.local.type === 'Identifier'
  )
}

function isJsxAttributeNamed(attribute, name) {
  return (
    attribute.type === 'JSXAttribute' &&
    attribute.name.type === 'JSXIdentifier' &&
    attribute.name.name === name
  )
}

function getNumericJsxAttributeValue(attribute) {
  if (!attribute.value) return null
  if (attribute.value.type === 'Literal' && typeof attribute.value.value === 'number')
    return attribute.value.value
  if (
    attribute.value.type === 'JSXExpressionContainer' &&
    attribute.value.expression.type === 'Literal' &&
    typeof attribute.value.expression.value === 'number'
  ) {
    return attribute.value.expression.value
  }
  return null
}

function getClassNameValueText(classNames, classNameAttribute, sourceCode) {
  if (!classNameAttribute?.value) return `{${JSON.stringify(classNames)}}`
  if (
    classNameAttribute.value.type === 'Literal' &&
    typeof classNameAttribute.value.value === 'string'
  ) {
    const merged = `${classNames} ${classNameAttribute.value.value}`.trim()
    return `{${JSON.stringify(merged)}}`
  }
  if (classNameAttribute.value.type === 'JSXExpressionContainer') {
    const expression = classNameAttribute.value.expression
    if (expression.type === 'JSXEmptyExpression') return `{${JSON.stringify(classNames)}}`
    if (
      expression.type === 'CallExpression' &&
      expression.callee.type === 'Identifier' &&
      expression.callee.name === 'cn'
    ) {
      const existingArguments = expression.arguments.map((argument) => sourceCode.getText(argument))
      const argumentsText = [JSON.stringify(classNames), ...existingArguments].join(', ')
      return `{cn(${argumentsText})}`
    }
    const expressionText = sourceCode.getText(expression)
    const escapedClassNames = classNames
      .replaceAll('\\', '\\\\')
      .replaceAll('`', '\\`')
      .replaceAll('${', '\\${')
    return `{\`${escapedClassNames} \${${expressionText}}\`}`
  }
  return null
}

function hasRuntimeReference(sourceCode, specifier) {
  try {
    const variable = sourceCode.getDeclaredVariables(specifier)[0]
    if (!variable) return false
    return variable.references.some((reference) => {
      if (reference.identifier === specifier.local) return false
      if (typeof reference.isTypeReference === 'boolean') return !reference.isTypeReference
      if (typeof reference.isValueReference === 'boolean') return reference.isValueReference
      return true
    })
  } catch {
    return false
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    hasSuggestions: true,
    docs: {
      description: 'Prefer Tailwind CSS icon classes over icon library components',
    },
    schema: [
      {
        type: 'object',
        properties: {
          libraries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source: { type: 'string' },
                name: { type: 'string' },
                prefix: { type: 'string' },
              },
              required: ['source'],
              additionalProperties: false,
            },
          },
          prefix: {
            type: 'string',
            description: 'Global class prefix added before generated icon classes',
          },
          propMappings: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Maps component props to Tailwind class prefixes',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      preferTailwindIcon:
        'Prefer using Tailwind CSS icon class "{{iconClass}}" over "{{componentName}}" from "{{source}}"',
      preferTailwindIconImport:
        'Icon "{{importedName}}" from "{{source}}" can be replaced with Tailwind CSS class "{{iconClass}}"',
    },
  },
  create(context) {
    const [options = {}] = context.options
    const resolvedConfigs = normalizeLibraryConfigs(options.libraries ?? [])
    if (resolvedConfigs.length === 0) return {}

    const globalPrefix = options.prefix ?? ''
    const propMappings = options.propMappings ?? {}
    const iconImports = new Map()
    const sourceCode = context.sourceCode

    return {
      ImportDeclaration(node) {
        if (node.importKind === 'type' || typeof node.source.value !== 'string') return
        const source = node.source.value
        const matchedConfig = resolvedConfigs.find((config) =>
          hasRegexMatch(source, config.sourceRegex),
        )
        if (!matchedConfig) return

        for (const specifier of node.specifiers) {
          if (!isNamedImportSpecifier(specifier) || specifier.importKind === 'type') continue
          const importedName = specifier.imported.name
          if (!hasRegexMatch(importedName, matchedConfig.nameRegex)) continue
          const localName = specifier.local.name
          iconImports.set(localName, {
            node: specifier,
            importedName,
            localName,
            config: matchedConfig,
            source,
            used: false,
          })
        }
      },
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier') return
        const iconInfo = iconImports.get(node.name.name)
        if (!iconInfo) return

        iconInfo.used = true
        const iconClass = getIconClass(
          iconInfo.importedName,
          iconInfo.source,
          iconInfo.config,
          globalPrefix,
        )
        const classNameAttribute = node.attributes.find((attribute) =>
          isJsxAttributeNamed(attribute, 'className'),
        )
        const mappedClasses = []
        const consumedMappedAttributes = new Set()
        for (const [propName, classPrefix] of Object.entries(propMappings)) {
          const mappedAttribute = node.attributes.find((attribute) =>
            isJsxAttributeNamed(attribute, propName),
          )
          if (!mappedAttribute) continue
          const pixelValue = getNumericJsxAttributeValue(mappedAttribute)
          if (pixelValue === null) continue
          mappedClasses.push(pixelToClass(pixelValue, classPrefix))
          consumedMappedAttributes.add(mappedAttribute)
        }

        const classesToAdd = [iconClass, ...mappedClasses].filter(Boolean).join(' ')
        const classValue = getClassNameValueText(classesToAdd, classNameAttribute, sourceCode)
        if (node.parent.type !== 'JSXElement') return

        context.report({
          node,
          messageId: 'preferTailwindIcon',
          data: {
            iconClass,
            componentName: iconInfo.localName,
            source: iconInfo.source,
          },
          ...(classValue
            ? {
                suggest: [
                  {
                    messageId: 'preferTailwindIcon',
                    data: {
                      iconClass,
                      componentName: iconInfo.localName,
                      source: iconInfo.source,
                    },
                    fix(fixer) {
                      const otherAttributes = node.attributes
                        .filter((attribute) => {
                          if (attribute === classNameAttribute) return false
                          if (attribute.type !== 'JSXAttribute') return true
                          return !consumedMappedAttributes.has(attribute)
                        })
                        .map((attribute) => sourceCode.getText(attribute))
                        .join(' ')
                      const attrsText = otherAttributes
                        ? `className=${classValue} ${otherAttributes}`
                        : `className=${classValue}`
                      if (node.selfClosing)
                        return fixer.replaceText(node.parent, `<span ${attrsText} />`)
                      const fixes = [fixer.replaceText(node, `<span ${attrsText}>`)]
                      if (node.parent.closingElement)
                        fixes.push(fixer.replaceText(node.parent.closingElement, '</span>'))
                      return fixes
                    },
                  },
                ],
              }
            : {}),
        })
      },
      'Program:exit': () => {
        for (const iconInfo of iconImports.values()) {
          if (iconInfo.used || !hasRuntimeReference(sourceCode, iconInfo.node)) continue
          const iconClass = getIconClass(
            iconInfo.importedName,
            iconInfo.source,
            iconInfo.config,
            globalPrefix,
          )
          context.report({
            node: iconInfo.node,
            messageId: 'preferTailwindIconImport',
            data: {
              importedName: iconInfo.importedName,
              source: iconInfo.source,
              iconClass,
            },
          })
        }
      },
    }
  },
}
