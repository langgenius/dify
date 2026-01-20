/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ensure package.json dependencies and devDependencies do not use version prefixes (^ or ~)',
    },
    fixable: 'code',
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
        const fixes = {}

        for (const depType of dependencyTypes) {
          if (!packageJson[depType])
            continue

          const dependencies = packageJson[depType]
          for (const [name, version] of Object.entries(dependencies)) {
            // Check if version starts with ^ or ~
            if (typeof version === 'string' && (version.startsWith('^') || version.startsWith('~'))) {
              const cleanVersion = version.substring(1)
              context.report({
                node,
                message: `Dependency "${name}" in "${depType}" should not use version prefix. Use "${cleanVersion}" instead of "${version}"`,
                fix(_fixer) {
                  // Store fix for later
                  if (!fixes[depType])
                    fixes[depType] = {}

                  fixes[depType][name] = cleanVersion
                  return null
                },
              })
            }
          }
        }

        // Apply all fixes at once if there are any
        if (Object.keys(fixes).length > 0) {
          context.report({
            node,
            message: 'Some dependencies have version prefixes that should be removed',
            fix(fixer) {
              const newPackageJson = { ...packageJson }

              for (const [depType, deps] of Object.entries(fixes)) {
                newPackageJson[depType] = { ...newPackageJson[depType] }
                for (const [name, version] of Object.entries(deps)) {
                  newPackageJson[depType][name] = version
                }
              }

              const newText = `${JSON.stringify(newPackageJson, null, 2)}\n`
              return fixer.replaceText(node, newText)
            },
          })
        }
      },
    }
  },
}
