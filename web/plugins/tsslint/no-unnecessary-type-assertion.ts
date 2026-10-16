import type { Rule } from '@tsslint/config'
import type * as ts from 'typescript'

/**
 * Reports `value as T` and `value as unknown as T` assertions that can be removed or
 * shortened without changing any type.
 *
 * Removing an assertion has two effects that must both be neutral:
 *
 * - Inward: `as T` is the contextual type of `value`, so it can shape literals, object
 *   literals, functions and generic calls. Those values are skipped; only values whose
 *   type does not depend on their context are inspected.
 * - Outward: the expression type changes from `T` to the value type. That is always safe
 *   when both are the same type. For an upcast it is only safe where the receiver type is
 *   fixed: a non-generic, non-overloaded call argument, an annotated declaration or return,
 *   or an assignment target.
 *
 * For `value as unknown as T`, the `unknown` step is dropped when `value` and `T` are
 * assignable in one direction, which assignment guarantees to type-check as a single `as T`.
 */
const noUnnecessaryTypeAssertion: Rule = ({ typescript: tsApi, program, file, report }) => {
  const checker = program.getTypeChecker()

  const skipParentheses = (node: ts.Expression): ts.Expression => {
    let current = node
    while (tsApi.isParenthesizedExpression(current)) current = current.expression
    return current
  }

  const isGenericCall = (node: ts.CallLikeExpression): boolean => {
    const declaration = checker.getResolvedSignature(node)?.getDeclaration()
    return !declaration || !!declaration.typeParameters?.length
  }

  // Whether the type of `node` can depend on the contextual type provided by the assertion.
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

  // Whether the position of `node` has a receiver type that does not depend on `node` itself.
  const getFixedReceiverType = (node: ts.Expression): ts.Type | undefined => {
    let current = node
    while (tsApi.isParenthesizedExpression(current.parent)) current = current.parent
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
    if (tsApi.isVariableDeclaration(parent) && parent.initializer === current && parent.type)
      return checker.getTypeFromTypeNode(parent.type)
    if (tsApi.isReturnStatement(parent)) {
      const fn = tsApi.findAncestor(parent, tsApi.isFunctionLike)
      if (!fn?.type || fn.typeParameters?.length) return undefined
      return checker.getContextualType(current)
    }
    if (
      tsApi.isBinaryExpression(parent) &&
      parent.operatorToken.kind === tsApi.SyntaxKind.EqualsToken &&
      parent.right === current &&
      !tsApi.isObjectLiteralExpression(parent.left) &&
      !tsApi.isArrayLiteralExpression(parent.left)
    )
      return checker.getTypeAtLocation(parent.left)
    return undefined
  }

  const replaceNode = (node: ts.Node, newText: string) => {
    const start = node.getStart(file)
    return [
      {
        fileName: file.fileName,
        textChanges: [{ span: { start, length: node.end - start }, newText }],
      },
    ]
  }

  const reportFix = (node: ts.Node, message: string, title: string, newText: string) => {
    report(message, node.getStart(file), node.end)
      .asError()
      .withFix(title, () => replaceNode(node, newText))
  }

  const checkDoubleAssertion = (node: ts.AsExpression, inner: ts.AsExpression) => {
    const value = inner.expression
    const sourceType = checker.getTypeAtLocation(value)
    const targetType = checker.getTypeFromTypeNode(node.type)
    if (sourceType.flags & tsApi.TypeFlags.Any) return

    const targetText = node.type.getText(file)
    const contextSensitive = isContextSensitive(value)
    if (sourceType === targetType && !contextSensitive) {
      reportFix(
        node,
        `The value is already \`${targetText}\`; remove the \`as unknown as\` assertion.`,
        'Remove the type assertion',
        value.getText(file),
      )
      return
    }
    // A single `as T` makes `T` the contextual type of the value, which keeps literal types
    // from widening, so only the widening-safe direction is reliable for those values.
    if (
      sourceType.flags & tsApi.TypeFlags.Unknown ||
      checker.isTypeAssignableTo(sourceType, targetType) ||
      (!contextSensitive && checker.isTypeAssignableTo(targetType, sourceType))
    ) {
      reportFix(
        node,
        'A single `as` assertion is enough; remove the `as unknown` step.',
        'Use a single type assertion',
        `${value.getText(file)} as ${targetText}`,
      )
    }
  }

  const checkAssertion = (node: ts.AsExpression) => {
    const value = node.expression
    if (isContextSensitive(value)) return

    const sourceType = checker.getTypeAtLocation(value)
    const targetType = checker.getTypeFromTypeNode(node.type)
    if (sourceType.flags & tsApi.TypeFlags.Any) return

    if (sourceType === targetType) {
      reportFix(
        node,
        `The value is already \`${node.type.getText(file)}\`; remove the type assertion.`,
        'Remove the type assertion',
        value.getText(file),
      )
      return
    }
    if (!checker.isTypeAssignableTo(sourceType, targetType)) return
    const receiverType = getFixedReceiverType(node)
    if (
      receiverType &&
      !(receiverType.flags & tsApi.TypeFlags.Any) &&
      checker.isTypeAssignableTo(sourceType, receiverType)
    ) {
      reportFix(
        node,
        'The receiver already accepts the value; remove the type assertion.',
        'Remove the type assertion',
        value.getText(file),
      )
    }
  }

  const visit = (node: ts.Node): void => {
    tsApi.forEachChild(node, visit)

    if (!tsApi.isAsExpression(node) || tsApi.isConstTypeReference(node.type)) return
    // The inner `as unknown` of a double assertion is handled together with its outer `as T`.
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
