/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ensure package.json dependencies do not use version prefixes (^ or ~)',
    },
  },
  create(context) {
    const { filename } = context

    // Only check package.json files
    if (!filename.endsWith('package.json'))
      return {}

    const dependencyTypes = new Set(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'])
    let currentDependencyType = null

    return {
      // Track when we enter a dependency section
      'Property[key.value=/^(dependencies|devDependencies|peerDependencies|optionalDependencies)$/] > ObjectExpression'(node) {
        const parent = node.parent
        if (parent && parent.key && parent.key.value) {
          currentDependencyType = parent.key.value
        }
      },

      // Check each property in dependency sections
      'Property[key.value=/^(dependencies|devDependencies|peerDependencies|optionalDependencies)$/] > ObjectExpression > Property'(node) {
        const versionNode = node.value

        // Check if the version value starts with ^ or ~
        if (versionNode && versionNode.type === 'Literal' && typeof versionNode.value === 'string') {
          const version = versionNode.value
          if (version.startsWith('^') || version.startsWith('~')) {
            const packageName = node.key.value || node.key.name
            const prefix = version[0]
            context.report({
              node: versionNode,
              message: `Dependency "${packageName}" has version prefix "${prefix}" that should be removed (found: "${version}", expected: "${version.substring(1)}")`,
            })
          }
        }
      },
    }
  },
}
