import type { Rule } from '@tsslint/config'
import type * as ts from 'typescript'

/**
 * Reports `value as T` and `value as unknown as T` assertions that can be removed or
 * shortened without changing any type.
 *
 * Removing an assertion has three effects that must all be neutral:
 *
 * - Inward: `as T` is the contextual type of `value`, so it can shape literals, object
 *   literals, functions and generic calls. Those values are skipped; only values whose
 *   type does not depend on their context are inspected.
 * - Outward: the expression type changes from `T` to the value type. That is safe when both
 *   are the same non-literal type. For a literal type or an upcast it is only safe where the
 *   receiver type is fixed and does not narrow: a non-generic, non-overloaded call argument,
 *   an annotated return, an annotated declaration whose type is not a union, or an assignment
 *   statement whose target type is not a union.
 * - Narrowing: `x as T` is not a reference, so control flow never narrows `x` through it.
 *   References in narrowing positions (type predicates, `typeof`, comparisons, conditions,
 *   `switch`) keep their assertion.
 *
 * For `value as unknown as T`, the `unknown` step is dropped when `value` and `T` are
 * assignable in one direction, which assignment guarantees to type-check as a single `as T`.
 * Values typed by their context keep both steps, since `as T` would become their context.
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
    if (!declaration || declaration.typeParameters?.length) return true
    // A constructor's type parameters belong to its class, not to the constructor itself.
    if (tsApi.isConstructorDeclaration(declaration) && declaration.parent.typeParameters?.length)
      return true
    if (tsApi.isCallExpression(node) || tsApi.isNewExpression(node)) {
      const calleeType = checker.getTypeAtLocation(node.expression)
      const signatures = tsApi.isNewExpression(node)
        ? calleeType.getConstructSignatures()
        : calleeType.getCallSignatures()
      return signatures.some((signature) => signature.getTypeParameters()?.length)
    }
    return false
  }

  // Literal types widen to their base type in mutable or inferred positions (`let`, array
  // elements, unannotated returns); an assertion to the literal type is what prevents that.
  const hasLiteralType = (type: ts.Type): boolean => checker.getBaseTypeOfLiteralType(type) !== type

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
    // Assigning to a union-typed binding narrows it to the assigned type, so an upcast there
    // keeps later checks of the other union members valid.
    if (tsApi.isVariableDeclaration(parent) && parent.initializer === current && parent.type) {
      const declaredType = checker.getTypeFromTypeNode(parent.type)
      return declaredType.isUnion() ? undefined : declaredType
    }
    if (tsApi.isReturnStatement(parent)) {
      const fn = tsApi.findAncestor(parent, tsApi.isFunctionLike)
      if (!fn?.type || fn.typeParameters?.length) return undefined
      return checker.getContextualType(current)
    }
    // The assignment expression itself has the assigned type, so its result must be unused.
    if (
      tsApi.isBinaryExpression(parent) &&
      parent.operatorToken.kind === tsApi.SyntaxKind.EqualsToken &&
      parent.right === current &&
      tsApi.isExpressionStatement(parent.parent) &&
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

  // Whether control flow narrows a reference at this position. An assertion turns the
  // reference into an expression, so removing it would start narrowing the variable.
  const isNarrowingPosition = (node: ts.Expression): boolean => {
    let current = node
    while (tsApi.isParenthesizedExpression(current.parent)) current = current.parent
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
    if (tsApi.isCallExpression(parent) && parent.arguments.includes(current)) {
      const signature = checker.getResolvedSignature(parent)
      return !signature || !!checker.getTypePredicateOfSignature(signature)
    }
    return false
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

    // Even a one-way assignable `as T` would give the value a new contextual type.
    if (isContextSensitive(value)) return

    const targetText = node.type.getText(file)
    if (
      sourceType === targetType &&
      !hasLiteralType(sourceType) &&
      !(isNarrowableReference(value) && isNarrowingPosition(node))
    ) {
      reportFix(
        node,
        `The value is already \`${targetText}\`; remove the \`as unknown as\` assertion.`,
        'Remove the type assertion',
        value.getText(file),
      )
      return
    }
    if (
      sourceType.flags & tsApi.TypeFlags.Unknown ||
      checker.isTypeAssignableTo(sourceType, targetType) ||
      checker.isTypeAssignableTo(targetType, sourceType)
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
    if (isNarrowableReference(value) && isNarrowingPosition(node)) return

    const sourceType = checker.getTypeAtLocation(value)
    const targetType = checker.getTypeFromTypeNode(node.type)
    if (sourceType.flags & tsApi.TypeFlags.Any) return

    if (sourceType === targetType && !hasLiteralType(sourceType)) {
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
