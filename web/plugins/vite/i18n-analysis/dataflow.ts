import * as ts from 'typescript'

export function unwrapValue(node: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isAwaitExpression(node)
  )
    return unwrapValue(node.expression)
  return node
}

// Traversal mechanics are shared; callers own mutation and API trust decisions.
export function createLocalDataflow(declarations: (node: ts.Node) => readonly ts.Declaration[]) {
  function initializers(node: ts.Node): ts.Expression[] {
    if (!ts.isIdentifier(node)) return []
    return declarations(node).flatMap((declaration) =>
      ts.isVariableDeclaration(declaration) && declaration.initializer
        ? [declaration.initializer]
        : [],
    )
  }

  function forEachReference<T>(
    node: ts.Node,
    visit: (node: ts.Node) => T | undefined,
  ): T | undefined {
    for (const initializer of initializers(node)) {
      const result = visit(initializer)
      if (result) return result
    }
    return ts.forEachChild(node, visit)
  }

  // A visitor owns its visited set: write tracking and escape tracking must never
  // suppress one another. Cyclic aliases terminate without dropping other edges.
  function createReferenceVisitor(options: {
    stop: (node: ts.Node) => boolean
    visit: (node: ts.Node) => void
  }) {
    const seen = new Set<ts.Node>()
    function walk(node: ts.Node) {
      if (seen.has(node)) return
      seen.add(node)
      if (options.stop(node)) return
      options.visit(node)
      forEachReference(node, (child) => {
        walk(child)
        return undefined
      })
    }
    return walk
  }

  // Value containment follows aliases, arrays and object values, but does not
  // descend into arbitrary calls or function bodies merely holding a reference.
  function someContainedValue(
    expression: ts.Expression,
    predicate: (expression: ts.Expression) => boolean,
    seen = new Set<ts.Node>(),
  ): boolean {
    if (seen.has(expression)) return false
    const next = new Set(seen).add(expression)
    if (predicate(expression)) return true
    const node = unwrapValue(expression)
    const contains = (value: ts.Expression) => someContainedValue(value, predicate, next)
    if (ts.isObjectLiteralExpression(node))
      return node.properties.some((member) =>
        ts.isSpreadAssignment(member)
          ? contains(member.expression)
          : ts.isPropertyAssignment(member)
            ? contains(member.initializer)
            : ts.isShorthandPropertyAssignment(member) && contains(member.name),
      )
    if (ts.isArrayLiteralExpression(node)) return node.elements.some(contains)
    if (ts.isSpreadElement(node)) return contains(node.expression)
    return initializers(node).some(contains)
  }

  return { forEachReference, createReferenceVisitor, someContainedValue }
}
