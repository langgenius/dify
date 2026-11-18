import type { Rule } from 'eslint'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { editionBaseline } from '../../../git-baseline.ts'

const policyModules: ReadonlySet<string> = new Set([
  'web/features/system-features/state.ts',
  'web/features/agent-v2/feature-flag.ts',
  'web/features/agent-v2/agent-detail/configure/feature-flags.ts',
  'web/features/contacts/management/feature-flag.ts',
  'web/features/contacts/im-platform/feature-flag.ts',
])
const editionNames: ReadonlySet<string> = new Set([
  'edition',
  'deploymentEdition',
  'deployment_edition',
  'DEPLOYMENT_EDITION',
  'EDITION',
])
const comparisons: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.InKeyword,
])
const contractModule = '@dify/contracts/api/console/system-features/types.gen'
const stateModule = '@/features/system-features/state'

type Bindings = { names: Map<string, string>; types: Set<string>; namespaces: Set<string> }
type Occurrence = { node: ts.Node; key: string }

function moduleSource(node: ts.ImportDeclaration, file: ts.SourceFile): string {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return ''
  const source = node.moduleSpecifier.text.replace(/\.ts$/, '')
  if (source.startsWith('.')) {
    const absolute = resolve(dirname(file.fileName), source).replaceAll('\\', '/')
    if (absolute.endsWith('/web/features/system-features/state')) return stateModule
  }
  return source
}

function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

function containsEdition(node: ts.Node, bindings: Bindings): boolean {
  if (ts.isIdentifier(node) && bindings.names.has(node.text)) return true
  if (ts.isPropertyAccessExpression(node) && editionNames.has(node.name.text)) return true
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteral(node.argumentExpression) &&
    editionNames.has(node.argumentExpression.text)
  )
    return true
  return (
    ts.forEachChild(node, (child) => (containsEdition(child, bindings) ? true : undefined)) ?? false
  )
}

function sourceBindings(file: ts.SourceFile): Bindings {
  const bindings: Bindings = {
    names: new Map([...editionNames].map((name) => [name, 'deploymentEdition'])),
    types: new Set(),
    namespaces: new Set(),
  }
  walk(file, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const source = moduleSource(node, file)
      const imported = node.importClause?.namedBindings
      if (
        imported &&
        ts.isNamespaceImport(imported) &&
        [contractModule, stateModule].includes(source)
      )
        bindings.namespaces.add(imported.name.text)
      if (imported && ts.isNamedImports(imported)) {
        for (const specifier of imported.elements) {
          const original = (specifier.propertyName ?? specifier.name).text
          if (
            (source === contractModule && original === 'DeploymentEdition') ||
            (source === stateModule && original === 'deploymentEditionAtom')
          ) {
            bindings.names.set(specifier.name.text, original)
            if (original === 'DeploymentEdition') bindings.types.add(specifier.name.text)
          }
        }
      }
    }
  })
  walk(file, (node) => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
      const typeName =
        node.type && ts.isTypeReferenceNode(node.type) ? node.type.typeName : undefined
      const rawType =
        typeName &&
        ((ts.isIdentifier(typeName) && bindings.types.has(typeName.text)) ||
          (ts.isQualifiedName(typeName) &&
            ts.isIdentifier(typeName.left) &&
            bindings.namespaces.has(typeName.left.text) &&
            typeName.right.text === 'DeploymentEdition'))
      const initializer = node.initializer
      if (initializer && ts.isIdentifier(initializer) && bindings.namespaces.has(initializer.text))
        bindings.namespaces.add(node.name.text)
      const directAlias =
        initializer &&
        (ts.isIdentifier(initializer) ||
          ts.isPropertyAccessExpression(initializer) ||
          ts.isElementAccessExpression(initializer))
      const atomRead =
        initializer &&
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        ['get', 'useAtomValue', 'useAtomValueRawSync'].includes(initializer.expression.text)
      const rawInitializer =
        initializer && (directAlias || atomRead) && containsEdition(initializer, bindings)
      if (rawType || rawInitializer) bindings.names.set(node.name.text, 'deploymentEdition')
    }
    if (
      ts.isBindingElement(node) &&
      ts.isIdentifier(node.name) &&
      node.propertyName &&
      ts.isIdentifier(node.propertyName) &&
      editionNames.has(node.propertyName.text)
    )
      bindings.names.set(node.name.text, 'deploymentEdition')
  })
  return bindings
}

function fingerprint(node: ts.Node, file: ts.SourceFile, bindings: Bindings): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    node.getText(file),
  )
  const tokens: [ts.SyntaxKind, string][] = []
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const text =
      token === ts.SyntaxKind.StringLiteral || token === ts.SyntaxKind.NumericLiteral
        ? scanner.getTokenValue()
        : scanner.getTokenText()
    tokens.push([
      token,
      token === ts.SyntaxKind.Identifier ? (bindings.names.get(text) ?? text) : text,
    ])
  }
  return JSON.stringify(tokens)
}

function occurrences(file: ts.SourceFile): Occurrence[] {
  const bindings = sourceBindings(file)
  const matches: Occurrence[] = []
  walk(file, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const imported = node.importClause?.namedBindings
      const source = moduleSource(node, file)
      if (imported && ts.isNamedImports(imported)) {
        for (const specifier of imported.elements) {
          const original = (specifier.propertyName ?? specifier.name).text
          if (
            (source === contractModule && original === 'DeploymentEdition') ||
            (source === stateModule && original === 'deploymentEditionAtom')
          )
            matches.push({ node: specifier, key: `import:${source}:${original}` })
        }
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      comparisons.has(node.operatorToken.kind) &&
      containsEdition(node, bindings)
    )
      matches.push({ node, key: fingerprint(node, file, bindings) })
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['includes', 'has'].includes(node.expression.name.text) &&
      containsEdition(node, bindings)
    )
      matches.push({ node, key: fingerprint(node, file, bindings) })
    if (ts.isSwitchStatement(node) && containsEdition(node.expression, bindings)) {
      for (const clause of node.caseBlock.clauses) {
        const pattern = ts.isCaseClause(clause)
          ? fingerprint(clause.expression, file, bindings)
          : 'default'
        matches.push({
          node: clause,
          key: `switch:${fingerprint(node.expression, file, bindings)}:${pattern}`,
        })
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      bindings.namespaces.has(node.expression.text) &&
      ['DeploymentEdition', 'deploymentEditionAtom'].includes(node.name.text)
    )
      matches.push({ node, key: `reference:${node.name.text}` })
    if (
      ts.isQualifiedName(node) &&
      ts.isIdentifier(node.left) &&
      bindings.namespaces.has(node.left.text) &&
      node.right.text === 'DeploymentEdition'
    )
      matches.push({ node, key: 'reference:DeploymentEdition' })
  })
  return matches
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    schema: [],
    docs: {
      description:
        'Reject new raw deployment-edition dependencies and decisions outside feature policy modules.',
    },
    messages: {
      edition:
        'New deployment-edition dependency or decision. Consume a named feature policy or capability atom. Add a missing capability in the matching allowlisted policy (such as web/features/agent-v2/feature-flag.ts), or web/features/system-features/state.ts for derived capability atoms. See packages/tooling/README.md (Deployment Edition Policies) for the exact allowlist.',
      baseline:
        'Cannot check the deployment-edition baseline: {{reason}}. Fetch the target branch or set DIFY_EDITION_GUARD_BASE_REV to an available target commit, then rerun lint.',
    },
  },
  create(context) {
    return {
      'Program:exit': function () {
        if (!/edition/i.test(context.sourceCode.text)) return
        const file = ts.createSourceFile(
          context.filename,
          context.sourceCode.text,
          ts.ScriptTarget.Latest,
          true,
        )
        const current = occurrences(file)
        if (!current.length) return
        try {
          const baseline = editionBaseline(context.cwd, context.filename, policyModules)
          if (!baseline.path.startsWith('web/') || policyModules.has(baseline.path)) return
          const before = ts.createSourceFile(
            baseline.filename,
            baseline.source,
            ts.ScriptTarget.Latest,
            true,
          )
          const existing = new Map<string, number>()
          for (const match of occurrences(before))
            existing.set(match.key, (existing.get(match.key) ?? 0) + 1)
          for (const match of current) {
            const remaining = existing.get(match.key) ?? 0
            if (remaining) existing.set(match.key, remaining - 1)
            else {
              const start = file.getLineAndCharacterOfPosition(match.node.getStart(file))
              const end = file.getLineAndCharacterOfPosition(match.node.getEnd())
              context.report({
                loc: {
                  start: { line: start.line + 1, column: start.character },
                  end: { line: end.line + 1, column: end.character },
                },
                messageId: 'edition',
              })
            }
          }
        } catch (error) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: 'baseline',
            data: { reason: error instanceof Error ? error.message : String(error) },
          })
        }
      },
    }
  },
}

export default rule
