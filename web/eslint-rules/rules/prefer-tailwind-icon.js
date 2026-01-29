/**
 * Default prop-to-class mappings
 * Maps component props to Tailwind class prefixes
 */
const DEFAULT_PROP_MAPPINGS = {
  size: 'size',
  width: 'w',
  height: 'h',
}

/**
 * Convert PascalCase/camelCase to kebab-case
 * @param {string} name
 * @returns {string} The kebab-case string
 */
function camelToKebab(name) {
  return name
    .replace(/([a-z])(\d)/g, '$1-$2')
    .replace(/(\d)([a-z])/gi, '$1-$2')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
}

/**
 * Default icon library configurations
 *
 * Config options:
 * - pattern: string | RegExp - Pattern to match import source
 * - prefix: string | ((match: RegExpMatchArray) => string) - Icon class prefix
 * - suffix: string | ((match: RegExpMatchArray) => string) - Icon class suffix
 * - extractSubPath: boolean - Extract subdirectory path and add to prefix
 * - iconFilter: (name: string) => boolean - Filter which imports to process
 * - stripPrefix: string - Prefix to remove from icon name before transform
 * - stripSuffix: string - Suffix to remove from icon name before transform
 */
const DEFAULT_ICON_CONFIGS = [
  {
    // @/app/components/base/icons/src/public/* and vender/*
    pattern: /^@\/app\/components\/base\/icons\/src\/(public|vender)/,
    prefix: match => `i-custom-${match[1]}-`,
    extractSubPath: true,
  },
  {
    // @remixicon/react
    pattern: '@remixicon/react',
    prefix: 'i-ri-',
    iconFilter: name => name.startsWith('Ri'),
    stripPrefix: 'Ri',
  },
  {
    // @heroicons/react/{size}/{variant}
    pattern: /^@heroicons\/react\/(\d+)\/(solid|outline)$/,
    prefix: 'i-heroicons-',
    suffix: match => `-${match[1]}-${match[2]}`,
    iconFilter: name => name.endsWith('Icon'),
    stripSuffix: 'Icon',
  },
]

/**
 * Convert pixel value to Tailwind class
 * @param {number} pixels
 * @param {string} classPrefix - e.g., 'size', 'w', 'h'
 * @returns {string} The Tailwind class string
 */
function pixelToClass(pixels, classPrefix) {
  const units = pixels / 4
  return `${classPrefix}-${units}`
}

/**
 * Match source against config pattern
 * @param {string} source - The import source path
 * @param {object} config - The icon config
 * @returns {{ matched: boolean, match: RegExpMatchArray | null, basePath: string }} Match result
 */
function matchPattern(source, config) {
  const { pattern } = config
  if (pattern instanceof RegExp) {
    const match = source.match(pattern)
    if (match) {
      return { matched: true, match, basePath: match[0] }
    }
    return { matched: false, match: null, basePath: '' }
  }
  // String pattern: exact match or prefix match
  if (source === pattern || source.startsWith(`${pattern}/`)) {
    return { matched: true, match: null, basePath: pattern }
  }
  return { matched: false, match: null, basePath: '' }
}

/**
 * Get icon class from config
 * @param {string} iconName
 * @param {object} config
 * @param {string} source - The import source path
 * @param {RegExpMatchArray | null} match - The regex match result
 * @returns {string} The full Tailwind icon class string
 */
function getIconClass(iconName, config, source, match) {
  // Strip prefix/suffix from icon name if configured
  let name = iconName
  if (config.stripPrefix && name.startsWith(config.stripPrefix)) {
    name = name.slice(config.stripPrefix.length)
  }
  if (config.stripSuffix && name.endsWith(config.stripSuffix)) {
    name = name.slice(0, -config.stripSuffix.length)
  }

  // Transform name (use custom or default camelToKebab)
  const transformed = config.transformName ? config.transformName(name, source) : camelToKebab(name)

  // Get prefix (can be string or function)
  const prefix = typeof config.prefix === 'function' ? config.prefix(match) : config.prefix

  // Get suffix (can be string or function)
  const suffix = typeof config.suffix === 'function' ? config.suffix(match) : (config.suffix || '')

  // Extract subdirectory path after the pattern to include in prefix (only if extractSubPath is enabled)
  let subPrefix = ''
  if (config.extractSubPath) {
    const basePath = match ? match[0] : config.pattern
    if (source.startsWith(`${basePath}/`)) {
      const subPath = source.slice(basePath.length + 1)
      if (subPath) {
        subPrefix = `${subPath.replace(/\//g, '-')}-`
      }
    }
  }

  return `${prefix}${subPrefix}${transformed}${suffix}`
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer Tailwind CSS icon classes over icon library components',
    },
    hasSuggestions: true,
    schema: [
      {
        type: 'object',
        properties: {
          libraries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                pattern: { type: 'string' },
                prefix: { type: 'string' },
                suffix: { type: 'string' },
                extractSubPath: { type: 'boolean' },
              },
              required: ['pattern', 'prefix'],
            },
          },
          propMappings: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Maps component props to Tailwind class prefixes, e.g., { size: "size", width: "w", height: "h" }',
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
    const options = context.options[0] || {}
    const iconConfigs = options.libraries || DEFAULT_ICON_CONFIGS
    const propMappings = options.propMappings || DEFAULT_PROP_MAPPINGS

    // Track imports: localName -> { node, importedName, config, source, match, used }
    const iconImports = new Map()

    return {
      ImportDeclaration(node) {
        const source = node.source.value

        // Find matching config
        let matchedConfig = null
        let matchResult = null
        for (const config of iconConfigs) {
          const result = matchPattern(source, config)
          if (result.matched) {
            matchedConfig = config
            matchResult = result.match
            break
          }
        }
        if (!matchedConfig)
          return

        // Use default filter if not provided (for user-configured libraries)
        const iconFilter = matchedConfig.iconFilter || (() => true)

        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier') {
            const importedName = specifier.imported.name
            const localName = specifier.local.name

            if (iconFilter(importedName)) {
              iconImports.set(localName, {
                node: specifier,
                importedName,
                localName,
                config: matchedConfig,
                source,
                match: matchResult,
                used: false,
              })
            }
          }
        }
      },

      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier')
          return

        const componentName = node.name.name
        const iconInfo = iconImports.get(componentName)

        if (!iconInfo)
          return

        iconInfo.used = true

        const iconClass = getIconClass(iconInfo.importedName, iconInfo.config, iconInfo.source, iconInfo.match)

        // Find className attribute
        const classNameAttr = node.attributes.find(
          attr => attr.type === 'JSXAttribute' && attr.name.name === 'className',
        )

        // Process prop mappings (size, width, height, etc.)
        const mappedClasses = []
        const mappedPropNames = Object.keys(propMappings)

        for (const propName of mappedPropNames) {
          const attr = node.attributes.find(
            a => a.type === 'JSXAttribute' && a.name.name === propName,
          )

          if (attr && attr.value) {
            let pixelValue = null

            if (attr.value.type === 'JSXExpressionContainer'
              && attr.value.expression.type === 'Literal'
              && typeof attr.value.expression.value === 'number') {
              pixelValue = attr.value.expression.value
            }
            else if (attr.value.type === 'Literal'
              && typeof attr.value.value === 'number') {
              pixelValue = attr.value.value
            }

            if (pixelValue !== null) {
              mappedClasses.push(pixelToClass(pixelValue, propMappings[propName]))
            }
          }
        }

        // Build new className
        const sourceCode = context.sourceCode
        let newClassName
        const classesToAdd = [iconClass, ...mappedClasses].filter(Boolean).join(' ')

        if (classNameAttr && classNameAttr.value) {
          if (classNameAttr.value.type === 'Literal') {
            newClassName = `${classesToAdd} ${classNameAttr.value.value}`
          }
          else if (classNameAttr.value.type === 'JSXExpressionContainer') {
            const expression = sourceCode.getText(classNameAttr.value.expression)
            newClassName = `\`${classesToAdd} \${${expression}}\``
          }
        }
        else {
          newClassName = classesToAdd
        }

        const parent = node.parent
        const isSelfClosing = node.selfClosing
        const excludedAttrs = ['className', ...mappedPropNames]

        context.report({
          node,
          messageId: 'preferTailwindIcon',
          data: {
            iconClass,
            componentName,
            source: iconInfo.source,
          },
          suggest: [
            {
              messageId: 'preferTailwindIcon',
              data: {
                iconClass,
                componentName,
                source: iconInfo.source,
              },
              fix(fixer) {
                const fixes = []

                const classValue = newClassName.startsWith('`')
                  ? `{${newClassName}}`
                  : `"${newClassName}"`

                const otherAttrs = node.attributes
                  .filter(attr => !(attr.type === 'JSXAttribute' && excludedAttrs.includes(attr.name.name)))
                  .map(attr => sourceCode.getText(attr))
                  .join(' ')

                const attrsStr = otherAttrs
                  ? `className=${classValue} ${otherAttrs}`
                  : `className=${classValue}`

                if (isSelfClosing) {
                  fixes.push(fixer.replaceText(parent, `<span ${attrsStr} />`))
                }
                else {
                  const closingElement = parent.closingElement
                  fixes.push(fixer.replaceText(node, `<span ${attrsStr}>`))
                  if (closingElement) {
                    fixes.push(fixer.replaceText(closingElement, '</span>'))
                  }
                }

                return fixes
              },
            },
          ],
        })
      },

      'Program:exit': function () {
        const sourceCode = context.sourceCode

        // Report icons that were imported but not found in JSX
        for (const [, iconInfo] of iconImports) {
          if (!iconInfo.used) {
            // Verify the import is still referenced somewhere in the file (besides the import itself)
            try {
              const variables = sourceCode.getDeclaredVariables(iconInfo.node)
              const variable = variables[0]
              // Check if there are any references besides the import declaration
              const hasReferences = variable && variable.references.some(
                ref => ref.identifier !== iconInfo.node.local,
              )
              if (!hasReferences)
                continue
            }
            catch {
              continue
            }

            const iconClass = getIconClass(iconInfo.importedName, iconInfo.config, iconInfo.source, iconInfo.match)
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
        }
      },
    }
  },
}
