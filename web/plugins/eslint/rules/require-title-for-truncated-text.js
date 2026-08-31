import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const DEFAULT_TRUNCATION_CLASSES = new Set(['text-ellipsis', 'truncate'])
const cssModuleClassCache = new Map()
const UNSAFE_TITLE_EXPRESSION = Symbol('unsafe-title-expression')
const STYLE_WRAPPER_TYPES = new Set([
  'ChainExpression',
  'TSAsExpression',
  'TSInstantiationExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
])

function getJsxName(node) {
  if (!node) return null
  if (node.type === 'JSXIdentifier') return node.name
  if (node.type === 'JSXMemberExpression') {
    const objectName = getJsxName(node.object)
    const propertyName = getJsxName(node.property)
    return objectName && propertyName ? `${objectName}.${propertyName}` : null
  }
  if (node.type === 'JSXNamespacedName') {
    const namespaceName = getJsxName(node.namespace)
    const name = getJsxName(node.name)
    return namespaceName && name ? `${namespaceName}:${name}` : null
  }
  return null
}

function getAttribute(openingElement, attributeName) {
  return openingElement.attributes.find(
    (attribute) =>
      attribute.type === 'JSXAttribute' &&
      attribute.name.type === 'JSXIdentifier' &&
      attribute.name.name === attributeName,
  )
}

function unwrapExpression(node) {
  let current = node
  while (current && STYLE_WRAPPER_TYPES.has(current.type)) current = current.expression
  return current
}

function getStaticString(node) {
  const current = unwrapExpression(node)
  if (!current) return null
  if (current.type === 'Literal' && typeof current.value === 'string') return current.value
  if (current.type === 'TemplateLiteral' && current.expressions.length === 0)
    return current.quasis[0]?.value.cooked ?? current.quasis[0]?.value.raw ?? ''
  return null
}

function getUnprefixedClassName(token) {
  let bracketDepth = 0
  let lastVariantSeparator = -1

  for (let index = 0; index < token.length; index++) {
    const character = token[index]
    if (character === '[' || character === '(') bracketDepth++
    else if (character === ']' || character === ')') bracketDepth = Math.max(0, bracketDepth - 1)
    else if (character === ':' && bracketDepth === 0) lastVariantSeparator = index
  }

  return token
    .slice(lastVariantSeparator + 1)
    .replace(/^!/u, '')
    .replace(/!$/u, '')
}

function isTruncationClassToken(token) {
  const className = getUnprefixedClassName(token)
  if (DEFAULT_TRUNCATION_CLASSES.has(className)) return true
  if (className.startsWith('line-clamp-') && className !== 'line-clamp-none') return true

  const normalizedArbitraryClass = className.replaceAll(' ', '').toLowerCase()
  return (
    normalizedArbitraryClass === '[text-overflow:ellipsis]' ||
    /^\[(?:-webkit-)?line-clamp:(?!none(?:\]|$))[^\]]+\]$/u.test(normalizedArbitraryClass)
  )
}

function stringContainsTruncationClass(value) {
  return value.split(/\s+/u).some((token) => token && isTruncationClassToken(token))
}

function hasActiveLineClampDeclaration(cssText) {
  const lineClampPattern = /(?:-webkit-)?line-clamp\s*:\s*([^;}]+)/giu
  return [...cssText.matchAll(lineClampPattern)].some((match) => {
    const value = (match[1] ?? '').trim()
    return value !== '' && !/^(?:0|none|unset)\b/iu.test(value)
  })
}

function getTruncatingCssModuleClassNames(cssText) {
  const classNames = new Set()
  const classBlockPattern = /\.([A-Z_a-z][\w-]*)\s*\{([^{}]*)\}/gu

  for (const match of cssText.matchAll(classBlockPattern)) {
    const [, className, body = ''] = match
    const hasTextEllipsis = /text-overflow\s*:\s*ellipsis\b/iu.test(body)
    const hasLineClamp = hasActiveLineClampDeclaration(body)
    const hasTruncationApply = [...body.matchAll(/@apply\s+([^;}]+)/gu)].some((applyMatch) =>
      stringContainsTruncationClass(applyMatch[1] ?? ''),
    )

    if (hasTextEllipsis || hasLineClamp || hasTruncationApply) classNames.add(className)
  }

  return classNames
}

function getCssModuleClassNames(cssModulePath) {
  try {
    const modifiedTime = statSync(cssModulePath).mtimeMs
    const cached = cssModuleClassCache.get(cssModulePath)
    if (cached?.modifiedTime === modifiedTime) return cached.classNames

    const classNames = getTruncatingCssModuleClassNames(readFileSync(cssModulePath, 'utf8'))
    cssModuleClassCache.set(cssModulePath, { classNames, modifiedTime })
    return classNames
  } catch {
    return new Set()
  }
}

function getPropertyName(property) {
  if (!property || property.type !== 'Property') return null
  if (!property.computed && property.key.type === 'Identifier') return property.key.name
  if (property.key.type === 'Literal' && typeof property.key.value === 'string')
    return property.key.value
  return null
}

function getVariableByName(scope, name) {
  let currentScope = scope
  while (currentScope) {
    const variable = currentScope.set.get(name)
    if (variable) return variable
    currentScope = currentScope.upper
  }
  return null
}

function getVariableInitializer(identifier, sourceCode) {
  const variable = getVariableByName(sourceCode.getScope(identifier), identifier.name)
  if (!variable || variable.defs.length !== 1) return null

  const [definition] = variable.defs
  if (
    definition.type !== 'Variable' ||
    definition.node.type !== 'VariableDeclarator' ||
    definition.node.id.type !== 'Identifier' ||
    !definition.node.init
  )
    return null

  return { initializer: definition.node.init, variable }
}

function expressionContainsTruncationClass(
  node,
  sourceCode,
  cssModuleBindings,
  seenVariables = new Set(),
) {
  const current = unwrapExpression(node)
  if (!current) return false

  const staticString = getStaticString(current)
  if (staticString !== null) return stringContainsTruncationClass(staticString)

  switch (current.type) {
    case 'Identifier': {
      const resolvedVariable = getVariableInitializer(current, sourceCode)
      if (!resolvedVariable || seenVariables.has(resolvedVariable.variable)) return false
      const nextSeenVariables = new Set(seenVariables)
      nextSeenVariables.add(resolvedVariable.variable)
      return expressionContainsTruncationClass(
        resolvedVariable.initializer,
        sourceCode,
        cssModuleBindings,
        nextSeenVariables,
      )
    }
    case 'MemberExpression': {
      const object = unwrapExpression(current.object)
      if (object?.type !== 'Identifier') return false
      const propertyName = current.computed
        ? getStaticString(current.property)
        : current.property.type === 'Identifier'
          ? current.property.name
          : null
      const variable = getVariableByName(sourceCode.getScope(object), object.name)
      return propertyName !== null && cssModuleBindings.get(variable)?.has(propertyName)
    }
    case 'TemplateLiteral':
      return (
        current.quasis.some((quasi) =>
          stringContainsTruncationClass(quasi.value.cooked ?? quasi.value.raw),
        ) ||
        current.expressions.some((expression) =>
          expressionContainsTruncationClass(
            expression,
            sourceCode,
            cssModuleBindings,
            seenVariables,
          ),
        )
      )
    case 'TaggedTemplateExpression':
      return expressionContainsTruncationClass(
        current.quasi,
        sourceCode,
        cssModuleBindings,
        seenVariables,
      )
    case 'CallExpression':
    case 'NewExpression':
      return (
        expressionContainsTruncationClass(
          current.callee,
          sourceCode,
          cssModuleBindings,
          seenVariables,
        ) ||
        current.arguments.some((argument) =>
          argument.type === 'SpreadElement'
            ? expressionContainsTruncationClass(
                argument.argument,
                sourceCode,
                cssModuleBindings,
                seenVariables,
              )
            : expressionContainsTruncationClass(
                argument,
                sourceCode,
                cssModuleBindings,
                seenVariables,
              ),
        )
      )
    case 'ConditionalExpression':
      return (
        expressionContainsTruncationClass(
          current.consequent,
          sourceCode,
          cssModuleBindings,
          seenVariables,
        ) ||
        expressionContainsTruncationClass(
          current.alternate,
          sourceCode,
          cssModuleBindings,
          seenVariables,
        )
      )
    case 'LogicalExpression':
    case 'BinaryExpression':
      return (
        expressionContainsTruncationClass(
          current.left,
          sourceCode,
          cssModuleBindings,
          seenVariables,
        ) ||
        expressionContainsTruncationClass(
          current.right,
          sourceCode,
          cssModuleBindings,
          seenVariables,
        )
      )
    case 'ArrayExpression':
      return current.elements.some(
        (element) =>
          element &&
          (element.type === 'SpreadElement'
            ? expressionContainsTruncationClass(
                element.argument,
                sourceCode,
                cssModuleBindings,
                seenVariables,
              )
            : expressionContainsTruncationClass(
                element,
                sourceCode,
                cssModuleBindings,
                seenVariables,
              )),
      )
    case 'ObjectExpression':
      return current.properties.some((property) => {
        if (property.type === 'SpreadElement')
          return expressionContainsTruncationClass(
            property.argument,
            sourceCode,
            cssModuleBindings,
            seenVariables,
          )

        const propertyName = getPropertyName(property)
        return (
          (propertyName !== null && stringContainsTruncationClass(propertyName)) ||
          expressionContainsTruncationClass(
            property.value,
            sourceCode,
            cssModuleBindings,
            seenVariables,
          )
        )
      })
    case 'SequenceExpression':
      return current.expressions.some((expression) =>
        expressionContainsTruncationClass(expression, sourceCode, cssModuleBindings, seenVariables),
      )
    default:
      return false
  }
}

function isActiveLineClampValue(node) {
  const current = unwrapExpression(node)
  if (!current) return false
  if (current.type === 'Literal') {
    if (current.value === null || current.value === 0) return false
    if (typeof current.value === 'string')
      return !['', '0', 'none', 'unset'].includes(current.value.trim().toLowerCase())
    return true
  }
  return current.type !== 'Identifier' || current.name !== 'undefined'
}

function expressionContainsTruncationStyle(node, sourceCode, seenVariables = new Set()) {
  const current = unwrapExpression(node)
  if (!current) return false

  if (current.type === 'Identifier') {
    const resolvedVariable = getVariableInitializer(current, sourceCode)
    if (!resolvedVariable || seenVariables.has(resolvedVariable.variable)) return false
    const nextSeenVariables = new Set(seenVariables)
    nextSeenVariables.add(resolvedVariable.variable)
    return expressionContainsTruncationStyle(
      resolvedVariable.initializer,
      sourceCode,
      nextSeenVariables,
    )
  }

  if (current.type === 'ConditionalExpression') {
    return (
      expressionContainsTruncationStyle(current.consequent, sourceCode, seenVariables) ||
      expressionContainsTruncationStyle(current.alternate, sourceCode, seenVariables)
    )
  }

  if (current.type === 'LogicalExpression') {
    return (
      expressionContainsTruncationStyle(current.left, sourceCode, seenVariables) ||
      expressionContainsTruncationStyle(current.right, sourceCode, seenVariables)
    )
  }

  if (current.type === 'ArrayExpression') {
    return current.elements.some(
      (element) =>
        element &&
        expressionContainsTruncationStyle(
          element.type === 'SpreadElement' ? element.argument : element,
          sourceCode,
          seenVariables,
        ),
    )
  }

  if (current.type !== 'ObjectExpression') return false

  return current.properties.some((property) => {
    if (property.type === 'SpreadElement')
      return expressionContainsTruncationStyle(property.argument, sourceCode, seenVariables)

    const propertyName = getPropertyName(property)
    if (propertyName === 'textOverflow' || propertyName === 'text-overflow')
      return getStaticString(property.value)?.trim().toLowerCase() === 'ellipsis'
    if (
      ['WebkitLineClamp', 'webkitLineClamp', 'lineClamp', '-webkit-line-clamp'].includes(
        propertyName,
      )
    )
      return isActiveLineClampValue(property.value)
    return false
  })
}

function hasTruncation(openingElement, sourceCode, cssModuleBindings) {
  const classAttribute =
    getAttribute(openingElement, 'className') ?? getAttribute(openingElement, 'class')
  if (classAttribute?.value) {
    if (
      classAttribute.value.type === 'Literal' &&
      typeof classAttribute.value.value === 'string' &&
      stringContainsTruncationClass(classAttribute.value.value)
    )
      return true
    if (
      classAttribute.value.type === 'JSXExpressionContainer' &&
      expressionContainsTruncationClass(
        classAttribute.value.expression,
        sourceCode,
        cssModuleBindings,
      )
    )
      return true
  }

  const styleAttribute = getAttribute(openingElement, 'style')
  return (
    styleAttribute?.value?.type === 'JSXExpressionContainer' &&
    expressionContainsTruncationStyle(styleAttribute.value.expression, sourceCode)
  )
}

function isEmptyTitleAttribute(attribute) {
  if (!attribute || !attribute.value) return true
  if (attribute.value.type === 'Literal')
    return typeof attribute.value.value !== 'string' || attribute.value.value.trim() === ''
  if (attribute.value.type !== 'JSXExpressionContainer') return false

  const expression = unwrapExpression(attribute.value.expression)
  if (!expression || expression.type === 'JSXEmptyExpression') return true
  if (expression.type === 'Literal')
    return expression.value === null || String(expression.value).trim() === ''
  if (expression.type === 'TemplateLiteral' && expression.expressions.length === 0)
    return (expression.quasis[0]?.value.cooked ?? '').trim() === ''
  return expression.type === 'Identifier' && expression.name === 'undefined'
}

function isRenderableTitleExpression(node) {
  const current = unwrapExpression(node)
  if (!current) return false
  return ![
    'ArrowFunctionExpression',
    'FunctionExpression',
    'JSXElement',
    'JSXEmptyExpression',
    'JSXFragment',
    'ObjectExpression',
    'SequenceExpression',
  ].includes(current.type)
}

function isSafeToDuplicateTitleExpression(node) {
  const current = unwrapExpression(node)
  if (!current) return false

  if (current.type === 'Identifier') return current.name !== 'undefined'
  if (current.type === 'Literal')
    return (
      current.value !== null && !['boolean', 'object', 'undefined'].includes(typeof current.value)
    )
  if (current.type === 'TemplateLiteral' && current.expressions.length === 0)
    return (current.quasis[0]?.value.cooked ?? '').trim() !== ''
  return false
}

function getMeaningfulChildren(element) {
  return element.children.filter((child) => {
    if (child.type === 'JSXText') return child.value.trim() !== ''
    if (child.type === 'JSXExpressionContainer')
      return child.expression.type !== 'JSXEmptyExpression'
    return true
  })
}

function getSingleTextChild(element) {
  const meaningfulChildren = getMeaningfulChildren(element)
  if (meaningfulChildren.length !== 1) return null

  const child = meaningfulChildren[0]
  if (child.type === 'JSXElement') return getSingleTextChild(child)
  return child
}

function getExpressionTextChildCount(node) {
  const current = unwrapExpression(node)
  if (!current) return 0

  if (current.type === 'JSXElement' || current.type === 'JSXFragment')
    return getTextChildCount(current)
  if (current.type === 'ConditionalExpression')
    return Math.max(
      getExpressionTextChildCount(current.consequent),
      getExpressionTextChildCount(current.alternate),
    )
  if (current.type === 'LogicalExpression') {
    if (current.operator === '&&') return getExpressionTextChildCount(current.right)
    return Math.max(
      getExpressionTextChildCount(current.left),
      getExpressionTextChildCount(current.right),
    )
  }
  if (current.type === 'ArrayExpression') {
    let count = 0
    for (const element of current.elements) {
      if (!element) continue
      count += getExpressionTextChildCount(
        element.type === 'SpreadElement' ? element.argument : element,
      )
      if (count > 1) return count
    }
    return count
  }
  if (current.type === 'Literal') {
    if (current.value === null || typeof current.value === 'boolean') return 0
    if (typeof current.value === 'string') return current.value.trim() === '' ? 0 : 1
  }
  if (current.type === 'TemplateLiteral' && current.expressions.length === 0)
    return (current.quasis[0]?.value.cooked ?? '').trim() === '' ? 0 : 1
  if (current.type === 'Identifier' && current.name === 'undefined') return 0
  return isRenderableTitleExpression(current) ? 1 : 0
}

function getTextChildCount(element) {
  let count = 0

  for (const child of getMeaningfulChildren(element)) {
    if (child.type === 'JSXText') count++
    else if (child.type === 'JSXElement' || child.type === 'JSXFragment')
      count += getTextChildCount(child)
    else if (child.type === 'JSXExpressionContainer')
      count += getExpressionTextChildCount(child.expression)

    if (count > 1) return count
  }

  return count
}

function hasMultipleTextChildren(openingElement) {
  const element = openingElement.parent
  return element?.type === 'JSXElement' && getTextChildCount(element) > 1
}

function getTitleFixTextFromAttribute(attribute, sourceCode) {
  if (!attribute?.value) return null
  if (attribute.value.type === 'Literal') {
    if (typeof attribute.value.value !== 'string' || attribute.value.value.trim() === '')
      return null
    return `title=${JSON.stringify(attribute.value.value)}`
  }
  if (attribute.value.type !== 'JSXExpressionContainer') return null
  if (!isSafeToDuplicateTitleExpression(attribute.value.expression)) return UNSAFE_TITLE_EXPRESSION
  return `title={${sourceCode.getText(attribute.value.expression)}}`
}

function getTitleFixText(openingElement, sourceCode) {
  const element = openingElement.parent
  if (!element || element.type !== 'JSXElement') return null

  const child = getSingleTextChild(element)
  if (child?.type === 'JSXText') {
    const value = child.value.trim().replace(/\s+/gu, ' ')
    return value ? `title=${JSON.stringify(value)}` : null
  }
  let hasUnsafeTitleExpression = false
  if (child?.type === 'JSXExpressionContainer') {
    if (isSafeToDuplicateTitleExpression(child.expression))
      return `title={${sourceCode.getText(child.expression)}}`
    hasUnsafeTitleExpression = true
  }

  for (const attributeName of ['value', 'placeholder', 'content', 'label', 'name', 'aria-label']) {
    const attributeFixText = getTitleFixTextFromAttribute(
      getAttribute(openingElement, attributeName),
      sourceCode,
    )
    if (attributeFixText === UNSAFE_TITLE_EXPRESSION) {
      hasUnsafeTitleExpression = true
      continue
    }
    if (attributeFixText) return attributeFixText
  }

  return hasUnsafeTitleExpression ? UNSAFE_TITLE_EXPRESSION : null
}

function hasTitledSingleChild(openingElement) {
  const element = openingElement.parent
  if (!element || element.type !== 'JSXElement') return false
  const meaningfulChildren = getMeaningfulChildren(element)
  if (meaningfulChildren.length !== 1 || meaningfulChildren[0].type !== 'JSXElement') return null
  const titleAttribute = getAttribute(meaningfulChildren[0].openingElement, 'title')
  return !!titleAttribute && !isEmptyTitleAttribute(titleAttribute)
}

function isTooltipTriggerOpening(openingElement, tooltipTriggerNames) {
  const name = getJsxName(openingElement.name)
  return name !== null && tooltipTriggerNames.has(name)
}

function isInsideTooltipTrigger(openingElement, tooltipTriggerNames) {
  let current = openingElement.parent
  while (current) {
    if (
      current.type === 'JSXElement' &&
      isTooltipTriggerOpening(current.openingElement, tooltipTriggerNames)
    )
      return true
    if (
      current.type === 'JSXAttribute' &&
      current.name.type === 'JSXIdentifier' &&
      current.name.name === 'render' &&
      current.parent?.type === 'JSXOpeningElement' &&
      isTooltipTriggerOpening(current.parent, tooltipTriggerNames)
    )
      return true
    current = current.parent
  }
  return false
}

function getOwningVariableName(openingElement) {
  let current = openingElement.parent
  while (current) {
    if (current.type === 'VariableDeclarator')
      return current.id.type === 'Identifier' ? current.id.name : null
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression'
    )
      return null
    current = current.parent
  }
  return null
}

function collectReferencedIdentifiers(node, names) {
  const current = unwrapExpression(node)
  if (!current) return
  if (current.type === 'Identifier') {
    names.add(current.name)
    return
  }
  if (current.type === 'ConditionalExpression') {
    collectReferencedIdentifiers(current.consequent, names)
    collectReferencedIdentifiers(current.alternate, names)
  } else if (current.type === 'LogicalExpression') {
    collectReferencedIdentifiers(current.left, names)
    collectReferencedIdentifiers(current.right, names)
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require truncated JSX text to expose its full value through title or Tooltip',
    },
    fixable: 'code',
    messages: {
      emptyTitle: 'CSS-truncated text must have a non-empty title or be a Tooltip trigger.',
      missingTitle: 'CSS-truncated text must have a title or be a Tooltip trigger.',
    },
    schema: [],
  },
  create(context) {
    const candidates = []
    const renderIdentifiers = new Set()
    const tooltipTriggerNames = new Set()
    const cssModuleBindings = new Map()

    function recordCssModuleImport(node) {
      if (typeof node.source.value !== 'string' || !node.source.value.endsWith('.module.css'))
        return
      const defaultSpecifier = node.specifiers.find(
        (specifier) => specifier.type === 'ImportDefaultSpecifier',
      )
      if (!defaultSpecifier) return

      const filename = context.filename || context.getFilename()
      if (!filename || filename.startsWith('<')) return
      const cssModulePath = resolve(dirname(filename), node.source.value)
      const classNames = getCssModuleClassNames(cssModulePath)
      const variable = context.sourceCode.getDeclaredVariables(defaultSpecifier)[0]
      if (classNames.size > 0 && variable) cssModuleBindings.set(variable, classNames)
    }

    return {
      ImportDeclaration(node) {
        recordCssModuleImport(node)
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            (specifier.imported.name ?? specifier.imported.value) === 'TooltipTrigger'
          )
            tooltipTriggerNames.add(specifier.local.name)
        }
      },
      JSXOpeningElement(node) {
        if (isTooltipTriggerOpening(node, tooltipTriggerNames)) {
          const renderAttribute = getAttribute(node, 'render')
          if (renderAttribute?.value?.type === 'JSXExpressionContainer')
            collectReferencedIdentifiers(renderAttribute.value.expression, renderIdentifiers)
        }

        if (
          getAttribute(node, 'className') ||
          getAttribute(node, 'class') ||
          getAttribute(node, 'style')
        )
          candidates.push(node)
      },
      'Program:exit': function () {
        for (const openingElement of candidates) {
          if (!hasTruncation(openingElement, context.sourceCode, cssModuleBindings)) continue
          if (isInsideTooltipTrigger(openingElement, tooltipTriggerNames)) continue

          const owningVariableName = getOwningVariableName(openingElement)
          if (owningVariableName && renderIdentifiers.has(owningVariableName)) continue

          if (hasMultipleTextChildren(openingElement)) continue
          if (hasTitledSingleChild(openingElement)) continue

          const titleAttribute = getAttribute(openingElement, 'title')
          if (titleAttribute && !isEmptyTitleAttribute(titleAttribute)) continue

          const fixText = getTitleFixText(openingElement, context.sourceCode)
          if (fixText === UNSAFE_TITLE_EXPRESSION) continue

          context.report({
            node: titleAttribute ?? openingElement.name,
            messageId: titleAttribute ? 'emptyTitle' : 'missingTitle',
            fix:
              fixText === null
                ? null
                : (fixer) =>
                    titleAttribute
                      ? fixer.replaceText(titleAttribute, fixText)
                      : fixer.insertTextAfter(openingElement.attributes.at(-1), ` ${fixText}`),
          })
        }
      },
    }
  },
}
