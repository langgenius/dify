import type { Rule } from '@tsslint/config'
import type * as ts from 'typescript'

/**
 * Migration rule: removes `value as T` assertions and shortens `value as unknown as T` where
 * that does not change any type in this codebase. It is not part of the regular `lint:tss`
 * run; enable it with `pnpm migrate:type-assertions` and verify the result with `tsc`.
 *
 * The checks are limited to what the migration needed:
 *
 * - Values typed by their context (literals, object/array literals, functions, generic calls)
 *   are skipped, since `as T` shapes their type.
 * - An assertion to the type the value already has is removed, unless it is a literal type
 *   (which would widen), a reference in a narrowing position, or a destructured const.
 * - An upcast is removed only where the receiver type is fixed: a non-generic,
 *   non-overloaded call argument, an annotated non-generic return, or an assignment whose
 *   target type is not a union.
 * - For `value as unknown as T`, the `unknown` step is dropped when `value` and `T` are
 *   assignable in one direction.
 */
const noUnnecessaryTypeAssertion: Rule = ({ typescript: tsApi, program, file, report }) => {
  const checker = program.getTypeChecker()

  const skipParentheses = (node: ts.Expression): ts.Expression => {
    let current = node
    while (tsApi.isParenthesizedExpression(current)) current = current.expression
    return current
  }

  const getPositionNode = (node: ts.Expression): ts.Expression => {
    let current = node
    while (tsApi.isParenthesizedExpression(current.parent)) current = current.parent
    return current
  }

  const isGenericCall = (node: ts.CallLikeExpression): boolean => {
    const declaration = checker.getResolvedSignature(node)?.getDeclaration()
    if (!declaration || declaration.typeParameters?.length) return true
    if (tsApi.isCallExpression(node) || tsApi.isNewExpression(node)) {
      const calleeType = checker.getTypeAtLocation(node.expression)
      const signatures = tsApi.isNewExpression(node)
        ? calleeType.getConstructSignatures()
        : calleeType.getCallSignatures()
      return signatures.some((signature) => signature.getTypeParameters()?.length)
    }
    return false
  }

  const isContextSensitive = (node: ts.Expression): boolean => {
    const value = skipParentheses(node)
    if (
      tsApi.isLiteralExpression(value) ||
      tsApi.isNoSubstitutionTemplateLiteral(value) ||
      tsApi.isTemplateExpression(value) ||
      tsApi.isObjectLiteralExpression(value) ||
      tsApi.isArrayLiteralExpression(value) ||
      tsApi.isFunctionExpression(value) ||
      tsApi.isArrowFunction(value) ||
      tsApi.isClassExpression(value) ||
      tsApi.isJsxElement(value) ||
      tsApi.isJsxSelfClosingElement(value) ||
      tsApi.isJsxFragment(value) ||
      tsApi.isPrefixUnaryExpression(value) ||
      value.kind === tsApi.SyntaxKind.TrueKeyword ||
      value.kind === tsApi.SyntaxKind.FalseKeyword
    )
      return true
    if (
      tsApi.isCallExpression(value) ||
      tsApi.isNewExpression(value) ||
      tsApi.isTaggedTemplateExpression(value)
    )
      return isGenericCall(value)
    if (tsApi.isConditionalExpression(value))
      return isContextSensitive(value.whenTrue) || isContextSensitive(value.whenFalse)
    if (tsApi.isBinaryExpression(value)) {
      const operator = value.operatorToken.kind
      if (
        operator === tsApi.SyntaxKind.BarBarToken ||
        operator === tsApi.SyntaxKind.QuestionQuestionToken ||
        operator === tsApi.SyntaxKind.AmpersandAmpersandToken ||
        operator === tsApi.SyntaxKind.CommaToken ||
        operator === tsApi.SyntaxKind.EqualsToken
      )
        return isContextSensitive(value.left) || isContextSensitive(value.right)
      return false
    }
    if (
      tsApi.isAwaitExpression(value) ||
      tsApi.isNonNullExpression(value) ||
      tsApi.isSatisfiesExpression(value)
    )
      return isContextSensitive(value.expression)
    return false
  }

  const getFixedReceiverType = (node: ts.Expression): ts.Type | undefined => {
    const current = getPositionNode(node)
    const parent = current.parent

    if (
      (tsApi.isCallExpression(parent) || tsApi.isNewExpression(parent)) &&
      parent.arguments?.includes(current)
    ) {
      if (isGenericCall(parent)) return undefined
      const calleeType = checker.getTypeAtLocation(parent.expression)
      const signatures = tsApi.isNewExpression(parent)
        ? calleeType.getConstructSignatures()
        : calleeType.getCallSignatures()
      if (signatures.length !== 1) return undefined
      return checker.getContextualType(current)
    }
    if (tsApi.isReturnStatement(parent)) {
      const fn = tsApi.findAncestor(parent, tsApi.isFunctionLike)
      if (!fn?.type || fn.typeParameters?.length) return undefined
      return checker.getContextualType(current)
    }
    // Assigning to a union-typed binding narrows it to the assigned type.
    if (
      tsApi.isBinaryExpression(parent) &&
      parent.operatorToken.kind === tsApi.SyntaxKind.EqualsToken &&
      parent.right === current &&
      !tsApi.isObjectLiteralExpression(parent.left) &&
      !tsApi.isArrayLiteralExpression(parent.left)
    ) {
      const targetType = checker.getTypeAtLocation(parent.left)
      return targetType.isUnion() ? undefined : targetType
    }
    return undefined
  }

  const isNarrowableReference = (node: ts.Expression): boolean => {
    const value = skipParentheses(node)
    if (tsApi.isNonNullExpression(value)) return isNarrowableReference(value.expression)
    return (
      tsApi.isIdentifier(value) ||
      value.kind === tsApi.SyntaxKind.ThisKeyword ||
      tsApi.isPropertyAccessExpression(value) ||
      tsApi.isElementAccessExpression(value)
    )
  }

  const narrowingOperators = new Set([
    tsApi.SyntaxKind.EqualsEqualsEqualsToken,
    tsApi.SyntaxKind.ExclamationEqualsEqualsToken,
    tsApi.SyntaxKind.EqualsEqualsToken,
    tsApi.SyntaxKind.ExclamationEqualsToken,
    tsApi.SyntaxKind.InstanceOfKeyword,
    tsApi.SyntaxKind.InKeyword,
    tsApi.SyntaxKind.AmpersandAmpersandToken,
    tsApi.SyntaxKind.BarBarToken,
    tsApi.SyntaxKind.QuestionQuestionToken,
  ])

  // An assertion turns a reference into an expression, so control flow does not narrow it.
  const isNarrowingPosition = (node: ts.Expression): boolean => {
    let current: ts.Expression = node
    for (;;) {
      const parent = current.parent
      if (tsApi.isParenthesizedExpression(parent) || tsApi.isNonNullExpression(parent))
        current = parent
      else if (
        (tsApi.isPropertyAccessExpression(parent) || tsApi.isElementAccessExpression(parent)) &&
        parent.expression === current
      )
        current = parent
      else break
    }
    const parent = current.parent
    if (tsApi.isTypeOfExpression(parent)) return true
    if (tsApi.isPrefixUnaryExpression(parent))
      return parent.operator === tsApi.SyntaxKind.ExclamationToken
    if (tsApi.isBinaryExpression(parent)) return narrowingOperators.has(parent.operatorToken.kind)
    if (
      tsApi.isIfStatement(parent) ||
      tsApi.isWhileStatement(parent) ||
      tsApi.isDoStatement(parent) ||
      tsApi.isSwitchStatement(parent)
    )
      return parent.expression === current
    if (tsApi.isForStatement(parent)) return parent.condition === current
    if (tsApi.isConditionalExpression(parent)) return parent.condition === current
    if (
      tsApi.isCallExpression(parent) &&
      (parent.arguments.includes(current) || parent.expression === current)
    ) {
      const signature = checker.getResolvedSignature(parent)
      return !signature || !!checker.getTypePredicateOfSignature(signature)
    }
    return false
  }

  // Destructured discriminants narrow each other, which the assertion prevents.
  const isDestructuredConstInitializer = (node: ts.Expression): boolean => {
    const current = getPositionNode(node)
    const parent = current.parent
    return (
      tsApi.isVariableDeclaration(parent) &&
      !tsApi.isIdentifier(parent.name) &&
      parent.initializer === current &&
      !!(tsApi.getCombinedNodeFlags(parent) & tsApi.NodeFlags.Const)
    )
  }

  const reportFix = (node: ts.Node, message: string, newText: string) => {
    const start = node.getStart(file)
    report(message, start, node.end)
      .asError()
      .withFix(message, () => [
        {
          fileName: file.fileName,
          textChanges: [{ span: { start, length: node.end - start }, newText }],
        },
      ])
  }

  const checkDoubleAssertion = (node: ts.AsExpression, inner: ts.AsExpression) => {
    const value = inner.expression
    if (isContextSensitive(value)) return
    const sourceType = checker.getTypeAtLocation(value)
    const targetType = checker.getTypeFromTypeNode(node.type)
    if (sourceType.flags & tsApi.TypeFlags.Any) return
    if (
      sourceType.flags & tsApi.TypeFlags.Unknown ||
      checker.isTypeAssignableTo(sourceType, targetType) ||
      checker.isTypeAssignableTo(targetType, sourceType)
    )
      reportFix(
        node,
        'Use a single type assertion',
        `${value.getText(file)} as ${node.type.getText(file)}`,
      )
  }

  const checkAssertion = (node: ts.AsExpression) => {
    const value = node.expression
    if (isContextSensitive(value)) return
    if (isNarrowableReference(value) && isNarrowingPosition(node)) return
    if (isDestructuredConstInitializer(node)) return

    const sourceType = checker.getTypeAtLocation(value)
    const targetType = checker.getTypeFromTypeNode(node.type)
    if (sourceType.flags & tsApi.TypeFlags.Any) return

    const isSameType =
      sourceType === targetType && checker.getBaseTypeOfLiteralType(sourceType) === sourceType
    if (!isSameType) {
      if (!checker.isTypeAssignableTo(sourceType, targetType)) return
      const receiverType = getFixedReceiverType(node)
      if (
        !receiverType ||
        receiverType.flags & tsApi.TypeFlags.Any ||
        !checker.isTypeAssignableTo(sourceType, receiverType)
      )
        return
    }
    reportFix(node, 'Remove the type assertion', value.getText(file))
  }

  const visit = (node: ts.Node): void => {
    tsApi.forEachChild(node, visit)

    if (!tsApi.isAsExpression(node) || tsApi.isConstTypeReference(node.type)) return
    let outer: ts.Node = node.parent
    while (tsApi.isParenthesizedExpression(outer)) outer = outer.parent
    if (node.type.kind === tsApi.SyntaxKind.UnknownKeyword && tsApi.isAsExpression(outer)) return

    const inner = skipParentheses(node.expression)
    if (tsApi.isAsExpression(inner)) {
      if (inner.type.kind === tsApi.SyntaxKind.UnknownKeyword) checkDoubleAssertion(node, inner)
      return
    }
    checkAssertion(node)
  }

  visit(file)
}

export default noUnnecessaryTypeAssertion
