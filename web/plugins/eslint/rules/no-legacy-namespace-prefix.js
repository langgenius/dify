import { extractNamespace, removeNamespacePrefix } from '../namespaces.js'

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow legacy namespace prefix in i18n translation keys',
    },
    fixable: 'code',
    schema: [],
    messages: {
      legacyNamespacePrefix:
        'Translation key "{{key}}" should not include namespace prefix. Use t(\'{{localKey}}\') with useTranslation(\'{{ns}}\') instead.',
      legacyNamespacePrefixInVariable:
        'Variable "{{name}}" contains namespace prefix "{{ns}}". Remove the prefix and use useTranslation(\'{{ns}}\') instead.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode

    const tCallsToFix = []
    const variablesToFix = new Map()
    const namespacesUsed = new Set()
    const variableValues = new Map()

    function analyzeTemplateLiteral(node) {
      const quasis = node.quasis
      const expressions = node.expressions

      const firstQuasi = quasis[0].value.raw

      // Check if first quasi starts with namespace
      const extracted = extractNamespace(firstQuasi)
      if (extracted) {
        const fixedQuasis = [extracted.localKey, ...quasis.slice(1).map(q => q.value.raw)]
        return { ns: extracted.ns, canFix: true, fixedQuasis, variableToUpdate: null }
      }

      // Check if first expression is a variable with namespace prefix
      if (expressions.length > 0 && firstQuasi === '') {
        const firstExpr = expressions[0]
        if (firstExpr.type === 'Identifier') {
          const varValue = variableValues.get(firstExpr.name)
          if (varValue) {
            const extracted = removeNamespacePrefix(varValue)
            if (extracted) {
              return {
                ns: extracted.ns,
                canFix: true,
                fixedQuasis: null,
                variableToUpdate: {
                  name: firstExpr.name,
                  newValue: extracted.newValue,
                  ns: extracted.ns,
                },
              }
            }
          }
        }
      }

      return { ns: null, canFix: false, fixedQuasis: null, variableToUpdate: null }
    }

    function buildTemplateLiteral(quasis, expressions) {
      let result = '`'
      for (let i = 0; i < quasis.length; i++) {
        result += quasis[i]
        if (i < expressions.length) {
          result += `\${${sourceCode.getText(expressions[i])}}`
        }
      }
      result += '`'
      return result
    }

    function hasNsArgument(node) {
      if (node.arguments.length < 2)
        return false
      const secondArg = node.arguments[1]
      if (secondArg.type !== 'ObjectExpression')
        return false
      return secondArg.properties.some(
        prop => prop.type === 'Property'
          && prop.key.type === 'Identifier'
          && prop.key.name === 'ns',
      )
    }

    return {
      // Track variable declarations
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || !node.init)
          return

        // Case 1: Static string literal
        if (node.init.type === 'Literal' && typeof node.init.value === 'string') {
          variableValues.set(node.id.name, node.init.value)

          const extracted = removeNamespacePrefix(node.init.value)
          if (extracted) {
            variablesToFix.set(node.id.name, {
              node,
              name: node.id.name,
              oldValue: node.init.value,
              newValue: extracted.newValue,
              ns: extracted.ns,
            })
          }
        }

        // Case 2: Template literal with static first quasi containing namespace prefix
        // e.g., const i18nPrefix = `billing.plans.${plan}`
        if (node.init.type === 'TemplateLiteral') {
          const firstQuasi = node.init.quasis[0].value.raw
          const extracted = extractNamespace(firstQuasi)
          if (extracted) {
            // Store the first quasi value for template literal analysis
            variableValues.set(node.id.name, firstQuasi)

            variablesToFix.set(node.id.name, {
              node,
              name: node.id.name,
              oldValue: firstQuasi,
              newValue: extracted.localKey,
              ns: extracted.ns,
              isTemplateLiteral: true,
            })
          }
        }
      },

      CallExpression(node) {
        // Check for t() calls - both direct t() and i18n.t()
        const isTCall = (
          node.callee.type === 'Identifier'
          && node.callee.name === 't'
        ) || (
          node.callee.type === 'MemberExpression'
          && node.callee.property.type === 'Identifier'
          && node.callee.property.name === 't'
        )

        if (isTCall && node.arguments.length > 0) {
          // Skip if already has ns argument
          if (hasNsArgument(node))
            return

          // Unwrap TSAsExpression (e.g., `key as any`)
          let firstArg = node.arguments[0]
          const hasTsAsExpression = firstArg.type === 'TSAsExpression'
          if (hasTsAsExpression) {
            firstArg = firstArg.expression
          }

          // Case 1: Static string literal
          if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
            const extracted = extractNamespace(firstArg.value)
            if (extracted) {
              namespacesUsed.add(extracted.ns)
              tCallsToFix.push({ node })

              context.report({
                node: firstArg,
                messageId: 'legacyNamespacePrefix',
                data: {
                  key: firstArg.value,
                  localKey: extracted.localKey,
                  ns: extracted.ns,
                },
              })
            }
          }

          // Case 2: Template literal
          if (firstArg.type === 'TemplateLiteral') {
            const analysis = analyzeTemplateLiteral(firstArg)
            if (analysis.ns) {
              namespacesUsed.add(analysis.ns)
              tCallsToFix.push({ node })

              if (!analysis.variableToUpdate) {
                const firstQuasi = firstArg.quasis[0].value.raw
                const extracted = extractNamespace(firstQuasi)
                if (extracted) {
                  context.report({
                    node: firstArg,
                    messageId: 'legacyNamespacePrefix',
                    data: {
                      key: `${firstQuasi}...`,
                      localKey: `${extracted.localKey}...`,
                      ns: extracted.ns,
                    },
                  })
                }
              }
            }
          }

          // Case 3: Conditional expression
          if (firstArg.type === 'ConditionalExpression') {
            const consequent = firstArg.consequent
            const alternate = firstArg.alternate
            let hasNs = false

            if (consequent.type === 'Literal' && typeof consequent.value === 'string') {
              const extracted = extractNamespace(consequent.value)
              if (extracted) {
                hasNs = true
                namespacesUsed.add(extracted.ns)
              }
            }

            if (alternate.type === 'Literal' && typeof alternate.value === 'string') {
              const extracted = extractNamespace(alternate.value)
              if (extracted) {
                hasNs = true
                namespacesUsed.add(extracted.ns)
              }
            }

            if (hasNs) {
              tCallsToFix.push({ node })

              context.report({
                node: firstArg,
                messageId: 'legacyNamespacePrefix',
                data: {
                  key: '(conditional)',
                  localKey: '...',
                  ns: '...',
                },
              })
            }
          }
        }
      },

      'Program:exit': function (program) {
        if (namespacesUsed.size === 0)
          return

        // Report variables with namespace prefix (once per variable)
        for (const [, varInfo] of variablesToFix) {
          if (namespacesUsed.has(varInfo.ns)) {
            context.report({
              node: varInfo.node,
              messageId: 'legacyNamespacePrefixInVariable',
              data: {
                name: varInfo.name,
                ns: varInfo.ns,
              },
            })
          }
        }

        // Report on program with fix
        const sortedNamespaces = Array.from(namespacesUsed).sort()

        context.report({
          node: program,
          messageId: 'legacyNamespacePrefix',
          data: {
            key: '(file)',
            localKey: '...',
            ns: sortedNamespaces.join(', '),
          },
          fix(fixer) {
            /** @type {import('eslint').Rule.Fix[]} */
            const fixes = []

            // Fix variable declarations - remove namespace prefix
            for (const [, varInfo] of variablesToFix) {
              if (namespacesUsed.has(varInfo.ns) && varInfo.node.init) {
                if (varInfo.isTemplateLiteral) {
                  // For template literals, rebuild with updated first quasi
                  const templateLiteral = varInfo.node.init
                  const quasis = templateLiteral.quasis.map((q, i) =>
                    i === 0 ? varInfo.newValue : q.value.raw,
                  )
                  const newTemplate = buildTemplateLiteral(quasis, templateLiteral.expressions)
                  fixes.push(fixer.replaceText(varInfo.node.init, newTemplate))
                }
                else {
                  fixes.push(fixer.replaceText(varInfo.node.init, `'${varInfo.newValue}'`))
                }
              }
            }

            // Fix t() calls - use { ns: 'xxx' } as second argument
            for (const { node } of tCallsToFix) {
              const originalFirstArg = node.arguments[0]
              const secondArg = node.arguments[1]
              const hasSecondArg = node.arguments.length >= 2

              // Unwrap TSAsExpression for analysis, but keep it for replacement
              const hasTsAs = originalFirstArg.type === 'TSAsExpression'
              const firstArg = hasTsAs ? originalFirstArg.expression : originalFirstArg

              /**
               * Add ns to existing object or create new object
               * @param {string} ns
               */
              const addNsToArgs = (ns) => {
                if (hasSecondArg && secondArg.type === 'ObjectExpression') {
                  // Add ns property to existing object
                  if (secondArg.properties.length === 0) {
                    // Empty object: {} -> { ns: 'xxx' }
                    fixes.push(fixer.replaceText(secondArg, `{ ns: '${ns}' }`))
                  }
                  else {
                    // Non-empty object: { foo } -> { ns: 'xxx', foo }
                    const firstProp = secondArg.properties[0]
                    fixes.push(fixer.insertTextBefore(firstProp, `ns: '${ns}', `))
                  }
                }
                else if (hasSecondArg && secondArg.type === 'Literal' && typeof secondArg.value === 'string') {
                  // Second arg is a string (default value): 'default' -> { ns: 'xxx', defaultValue: 'default' }
                  fixes.push(fixer.replaceText(secondArg, `{ ns: '${ns}', defaultValue: ${sourceCode.getText(secondArg)} }`))
                }
                else if (!hasSecondArg) {
                  // No second argument, add new object
                  fixes.push(fixer.insertTextAfter(originalFirstArg, `, { ns: '${ns}' }`))
                }
                // If second arg exists but is not an object or string, skip (can't safely add ns)
              }

              if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
                const extracted = extractNamespace(firstArg.value)
                if (extracted) {
                  // Replace key (preserve as any if present)
                  if (hasTsAs) {
                    fixes.push(fixer.replaceText(originalFirstArg, `'${extracted.localKey}' as any`))
                  }
                  else {
                    fixes.push(fixer.replaceText(firstArg, `'${extracted.localKey}'`))
                  }
                  // Add ns
                  addNsToArgs(extracted.ns)
                }
              }
              else if (firstArg.type === 'TemplateLiteral') {
                const analysis = analyzeTemplateLiteral(firstArg)
                if (analysis.canFix && analysis.fixedQuasis) {
                  // For template literals with namespace prefix directly in template
                  const newTemplate = buildTemplateLiteral(analysis.fixedQuasis, firstArg.expressions)
                  if (hasTsAs) {
                    fixes.push(fixer.replaceText(originalFirstArg, `${newTemplate} as any`))
                  }
                  else {
                    fixes.push(fixer.replaceText(firstArg, newTemplate))
                  }
                  addNsToArgs(analysis.ns)
                }
                else if (analysis.canFix && analysis.variableToUpdate) {
                  // Variable's namespace prefix is being removed
                  const quasis = firstArg.quasis.map(q => q.value.raw)
                  // If variable becomes empty and next quasi starts with '.', remove the dot
                  if (analysis.variableToUpdate.newValue === '' && quasis.length > 1 && quasis[1].startsWith('.')) {
                    quasis[1] = quasis[1].slice(1)
                  }
                  const newTemplate = buildTemplateLiteral(quasis, firstArg.expressions)
                  if (hasTsAs) {
                    fixes.push(fixer.replaceText(originalFirstArg, `${newTemplate} as any`))
                  }
                  else {
                    fixes.push(fixer.replaceText(firstArg, newTemplate))
                  }
                  addNsToArgs(analysis.ns)
                }
              }
              else if (firstArg.type === 'ConditionalExpression') {
                const consequent = firstArg.consequent
                const alternate = firstArg.alternate
                let ns = null

                if (consequent.type === 'Literal' && typeof consequent.value === 'string') {
                  const extracted = extractNamespace(consequent.value)
                  if (extracted) {
                    ns = extracted.ns
                    fixes.push(fixer.replaceText(consequent, `'${extracted.localKey}'`))
                  }
                }

                if (alternate.type === 'Literal' && typeof alternate.value === 'string') {
                  const extracted = extractNamespace(alternate.value)
                  if (extracted) {
                    ns = ns || extracted.ns
                    fixes.push(fixer.replaceText(alternate, `'${extracted.localKey}'`))
                  }
                }

                // Add ns argument
                if (ns) {
                  addNsToArgs(ns)
                }
              }
            }

            return fixes
          },
        })
      },
    }
  },
}
