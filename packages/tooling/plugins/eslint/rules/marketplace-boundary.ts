import type { Rule } from 'eslint'

const restrictedImports: Record<string, string[] | 'all'> = {
  '@/service/marketplace': 'all',
  '@/features/marketplace/links': ['marketplaceLinks'],
  '@/features/marketplace/api': ['MARKETPLACE_API_PREFIX'],
}

const restrictedProperties = new Set([
  'enable_marketplace',
  'NEXT_PUBLIC_MARKETPLACE_URL_PREFIX',
  'NEXT_PUBLIC_MARKETPLACE_API_PREFIX',
])

const marketplaceHost = /\b(?:marketplace|creators)(?:-[\w-]+)?\.dify\.(?:ai|dev)\b/

type TypeOnly = { importKind?: 'type' | 'value' }

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep Marketplace links, data and availability behind @/features/marketplace/client.',
    },
    schema: [],
    messages: {
      import:
        'Do not import {{name}} here. Get Marketplace links and data from @/features/marketplace/client, which is off when Marketplace is disabled.',
      property:
        'Do not read {{name}} here. Use useMarketplace() from @/features/marketplace/client.',
      url: 'Do not hand-write Marketplace URLs. Build them from useMarketplace() in @/features/marketplace/client.',
    },
  },
  create(context) {
    const reportProperty = (node: Rule.Node, name: string) => {
      if (restrictedProperties.has(name))
        context.report({ node, messageId: 'property', data: { name } })
    }

    return {
      ImportDeclaration(node) {
        if ((node as TypeOnly).importKind === 'type') return
        const restricted = restrictedImports[String(node.source.value)]
        if (!restricted) return
        if (restricted === 'all') {
          context.report({
            node,
            messageId: 'import',
            data: { name: String(node.source.value) },
          })
          return
        }
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            (specifier as TypeOnly).importKind !== 'type' &&
            specifier.imported.type === 'Identifier' &&
            restricted.includes(specifier.imported.name)
          )
            context.report({
              node: specifier,
              messageId: 'import',
              data: { name: specifier.imported.name },
            })
        }
      },
      MemberExpression(node) {
        if (!node.computed && node.property.type === 'Identifier')
          reportProperty(node.property as Rule.Node, node.property.name)
      },
      Property(node) {
        if (
          node.parent.type === 'ObjectPattern' &&
          !node.computed &&
          node.key.type === 'Identifier'
        )
          reportProperty(node.key as Rule.Node, node.key.name)
      },
      Literal(node) {
        if (typeof node.value === 'string' && marketplaceHost.test(node.value))
          context.report({ node, messageId: 'url' })
      },
      TemplateElement(node) {
        if (marketplaceHost.test(node.value.raw)) context.report({ node, messageId: 'url' })
      },
    }
  },
}

export default rule
