import { docRedirects } from '../doc-redirects.js'

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow deprecated documentation paths in useDocLink calls and auto-fix to new paths',
    },
    fixable: 'code',
    schema: [],
    messages: {
      deprecatedDocLink:
        'Deprecated documentation path detected. The path "{{oldPath}}" has been moved to "{{newPath}}".',
    },
  },
  create(context) {
    /**
     * Check if the path needs redirect
     * @param {string} docPath - Path without language prefix
     */
    function checkRedirect(docPath) {
      // Normalize path (remove leading slash if present)
      const normalizedPath = docPath.startsWith('/') ? docPath.slice(1) : docPath

      if (docRedirects.has(normalizedPath)) {
        return {
          oldPath: normalizedPath,
          newPath: docRedirects.get(normalizedPath),
        }
      }

      // Also check with leading slash
      if (docRedirects.has(`/${normalizedPath}`)) {
        return {
          oldPath: normalizedPath,
          newPath: docRedirects.get(`/${normalizedPath}`).replace(/^\//, ''),
        }
      }

      return null
    }

    /**
     * Check if node is a useDocLink call
     * @param {import('estree').CallExpression} node
     */
    function isUseDocLinkCall(node) {
      // Check for direct useDocLink() call that returns a function
      // The actual doc path is passed to the returned function
      // e.g., const getLink = useDocLink(); getLink('path')
      // or useDocLink()('path')

      // For the pattern: useDocLink()('path')
      if (
        node.callee.type === 'CallExpression'
        && node.callee.callee.type === 'Identifier'
        && node.callee.callee.name === 'useDocLink'
      ) {
        return true
      }

      return false
    }

    /**
     * Check if node is a call to a function returned by useDocLink
     * This handles: const docLink = useDocLink(); docLink('path')
     */
    function isDocLinkFunctionCall(node, scope) {
      if (node.callee.type !== 'Identifier')
        return false

      const calleeName = node.callee.name

      // Look for variable declaration that assigns useDocLink()
      const variable = scope.variables.find(v => v.name === calleeName)
      if (!variable || variable.defs.length === 0)
        return false

      const def = variable.defs[0]
      if (def.type !== 'Variable' || !def.node.init)
        return false

      const init = def.node.init

      // Check if initialized with useDocLink()
      if (
        init.type === 'CallExpression'
        && init.callee.type === 'Identifier'
        && init.callee.name === 'useDocLink'
      ) {
        return true
      }

      return false
    }

    /**
     * Report a deprecated path and provide fix
     */
    function reportDeprecatedPath(node, redirect, sourceCode) {
      context.report({
        node,
        messageId: 'deprecatedDocLink',
        data: {
          oldPath: redirect.oldPath,
          newPath: redirect.newPath,
        },
        fix(fixer) {
          // Replace the string value, preserving the quote style
          const raw = sourceCode.getText(node)
          const quote = raw[0]
          return fixer.replaceText(node, `${quote}${redirect.newPath}${quote}`)
        },
      })
    }

    /**
     * Check a string literal node for deprecated path
     */
    function checkStringLiteral(node, sourceCode) {
      if (node.type !== 'Literal' || typeof node.value !== 'string')
        return

      const redirect = checkRedirect(node.value)
      if (redirect)
        reportDeprecatedPath(node, redirect, sourceCode)
    }

    /**
     * Check pathMap object for deprecated paths
     * pathMap is like { en: 'path1', zh: 'path2' }
     */
    function checkPathMapObject(node, sourceCode) {
      if (node.type !== 'ObjectExpression')
        return

      for (const prop of node.properties) {
        if (prop.type !== 'Property')
          continue

        // Check the value of each property
        checkStringLiteral(prop.value, sourceCode)
      }
    }

    return {
      CallExpression(node) {
        const sourceCode = context.sourceCode || context.getSourceCode()
        const scope = sourceCode.getScope?.(node) || context.getScope()

        // Check if this is useDocLink()('path') pattern
        const isDirectCall = isUseDocLinkCall(node)

        // Check if this is docLink('path') where docLink = useDocLink()
        const isIndirectCall = isDocLinkFunctionCall(node, scope)

        if (!isDirectCall && !isIndirectCall)
          return

        // Check first argument (the doc path)
        if (node.arguments.length >= 1)
          checkStringLiteral(node.arguments[0], sourceCode)

        // Check second argument (pathMap object)
        if (node.arguments.length >= 2)
          checkPathMapObject(node.arguments[1], sourceCode)
      },
    }
  },
}
