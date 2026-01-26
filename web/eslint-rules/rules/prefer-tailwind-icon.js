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
 * Default icon library configurations
 */
const DEFAULT_ICON_CONFIGS = [
  {
    // @remixicon/react
    pattern: '@remixicon/react',
    prefix: 'i-ri-',
    iconFilter: name => name.startsWith('Ri'),
    transformName: (iconName) => {
      // RiApps2AddLine -> apps-2-add-line
      const withoutPrefix = iconName.slice(2) // Remove 'Ri'
      return withoutPrefix
        .replace(/([a-z])(\d)/g, '$1-$2')
        .replace(/(\d)([a-z])/gi, '$1-$2')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()
    },
  },
  {
    // @heroicons/react/20/solid
    pattern: '@heroicons/react/20/solid',
    prefix: 'i-heroicons-',
    suffix: '-20-solid',
    iconFilter: name => name.endsWith('Icon'),
    transformName: (iconName) => {
      // ChevronDownIcon -> chevron-down
      const withoutSuffix = iconName.slice(0, -4) // Remove 'Icon'
      return withoutSuffix
        .replace(/([a-z])(\d)/g, '$1-$2')
        .replace(/(\d)([a-z])/gi, '$1-$2')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()
    },
  },
  {
    // @heroicons/react/24/solid
    pattern: '@heroicons/react/24/solid',
    prefix: 'i-heroicons-',
    suffix: '-24-solid',
    iconFilter: name => name.endsWith('Icon'),
    transformName: (iconName) => {
      const withoutSuffix = iconName.slice(0, -4)
      return withoutSuffix
        .replace(/([a-z])(\d)/g, '$1-$2')
        .replace(/(\d)([a-z])/gi, '$1-$2')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()
    },
  },
  {
    // @heroicons/react/24/outline
    pattern: '@heroicons/react/24/outline',
    prefix: 'i-heroicons-',
    suffix: '-24-outline',
    iconFilter: name => name.endsWith('Icon'),
    transformName: (iconName) => {
      const withoutSuffix = iconName.slice(0, -4)
      return withoutSuffix
        .replace(/([a-z])(\d)/g, '$1-$2')
        .replace(/(\d)([a-z])/gi, '$1-$2')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()
    },
  },
  {
    // @heroicons/react/20/outline
    pattern: '@heroicons/react/20/outline',
    prefix: 'i-heroicons-',
    suffix: '-20-outline',
    iconFilter: name => name.endsWith('Icon'),
    transformName: (iconName) => {
      const withoutSuffix = iconName.slice(0, -4)
      return withoutSuffix
        .replace(/([a-z])(\d)/g, '$1-$2')
        .replace(/(\d)([a-z])/gi, '$1-$2')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()
    },
  },
]

/**
 * Convert pixel value to Tailwind class
 * @param {number} pixels
 * @param {string} classPrefix - e.g., 'size', 'w', 'h'
 * @returns {string}
 */
function pixelToClass(pixels, classPrefix) {
  const units = pixels / 4
  return `${classPrefix}-${units}`
}

/**
 * Get icon class from config
 * @param {string} iconName
 * @param {object} config
 * @returns {string}
 */
function getIconClass(iconName, config) {
  const transformed = config.transformName(iconName)
  return `${config.prefix}${transformed}${config.suffix || ''}`
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer Tailwind CSS icon classes over icon library components',
    },
    fixable: 'code',
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

    // Track imports: localName -> { node, importedName, config, source, used }
    const iconImports = new Map()

    return {
      ImportDeclaration(node) {
        const source = node.source.value

        // Find matching config
        const config = iconConfigs.find(c => source === c.pattern || source.startsWith(`${c.pattern}/`))
        if (!config)
          return

        // Use default filter if not provided (for user-configured libraries)
        const iconFilter = config.iconFilter || (() => true)

        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier') {
            const importedName = specifier.imported.name
            const localName = specifier.local.name

            if (iconFilter(importedName)) {
              iconImports.set(localName, {
                node: specifier,
                importedName,
                localName,
                config,
                source,
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

        const iconClass = getIconClass(iconInfo.importedName, iconInfo.config)

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

            const iconClass = getIconClass(iconInfo.importedName, iconInfo.config)
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
