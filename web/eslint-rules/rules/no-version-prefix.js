/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ensure package.json dependencies and devDependencies do not use version prefixes (^ or ~)',
    },
  },
  create(context) {
    return {
      Program(node) {
        const { filename, sourceCode } = context

        // Only check package.json files
        if (!filename.endsWith('package.json'))
          return

        let packageJson = {}
        try {
          packageJson = JSON.parse(sourceCode.text)
        }
        catch (error) {
          context.report({
            node,
            message: `Error parsing package.json: ${error instanceof Error ? error.message : String(error)}`,
          })
          return
        }

        const dependencyTypes = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
        const errors = []

        for (const depType of dependencyTypes) {
          if (!packageJson[depType])
            continue

          const dependencies = packageJson[depType]
          for (const [name, version] of Object.entries(dependencies)) {
            // Check if version starts with ^ or ~
            if (typeof version === 'string' && (version.startsWith('^') || version.startsWith('~'))) {
              errors.push({ depType, name, version })
            }
          }
        }

        // Report all errors
        if (errors.length > 0) {
          const errorList = errors.map(({ depType, name, version }) => `  - ${depType}.${name}: ${version}`).join('\n')
          context.report({
            node,
            message: `Dependencies have version prefixes (^ or ~) that should be removed:\n${errorList}`,
          })
        }
      },
    }
  },
}
