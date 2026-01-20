// Constants for dependency field names and version prefixes
const DEPENDENCY_KEYS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const VERSION_PREFIXES = ['^', '~']

// Generate regex pattern for dependency keys
const DEPENDENCY_KEYS_PATTERN = `^(${DEPENDENCY_KEYS.join('|')})$`

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: `Ensure package.json dependencies do not use version prefixes (${VERSION_PREFIXES.join(' or ')})`,
    },
  },
  create(context) {
    const { filename } = context

    // Only check package.json files
    if (!filename.endsWith('package.json'))
      return {}

    return {
      // Check each property in dependency sections
      [`Property[key.value=/${DEPENDENCY_KEYS_PATTERN}/] > ObjectExpression > Property`](node) {
        const versionNode = node.value

        // Check if the version value starts with any forbidden prefix
        if (versionNode && versionNode.type === 'Literal' && typeof versionNode.value === 'string') {
          const version = versionNode.value
          const foundPrefix = VERSION_PREFIXES.find(prefix => version.startsWith(prefix))

          if (foundPrefix) {
            const packageName = node.key.value || node.key.name
            const cleanVersion = version.substring(1)
            context.report({
              node: versionNode,
              message: `Dependency "${packageName}" has version prefix "${foundPrefix}" that should be removed (found: "${version}", expected: "${cleanVersion}")`,
            })
          }
        }
      },
    }
  },
}
