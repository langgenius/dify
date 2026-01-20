const DEPENDENCY_KEYS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const VERSION_PREFIXES = ['^', '~']

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: `Ensure package.json dependencies do not use version prefixes (${VERSION_PREFIXES.join(' or ')})`,
    },
    fixable: 'code',
  },
  create(context) {
    const { filename } = context

    if (!filename.endsWith('package.json'))
      return {}

    const selector = `JSONProperty:matches(${DEPENDENCY_KEYS.map(k => `[key.value="${k}"]`).join(', ')}) > JSONObjectExpression > JSONProperty`

    return {
      [selector](node) {
        const versionNode = node.value

        if (versionNode && versionNode.type === 'JSONLiteral' && typeof versionNode.value === 'string') {
          const version = versionNode.value
          const foundPrefix = VERSION_PREFIXES.find(prefix => version.startsWith(prefix))

          if (foundPrefix) {
            const packageName = node.key.value || node.key.name
            const cleanVersion = version.substring(1)
            const canAutoFix = /^\d+\.\d+\.\d+$/.test(cleanVersion)
            context.report({
              node: versionNode,
              message: `Dependency "${packageName}" has version prefix "${foundPrefix}" that should be removed (found: "${version}", expected: "${cleanVersion}")`,
              fix: canAutoFix
                ? fixer => fixer.replaceText(versionNode, `"${cleanVersion}"`)
                : undefined,
            })
          }
        }
      },
    }
  },
}
