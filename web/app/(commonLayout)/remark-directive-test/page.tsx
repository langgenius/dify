'use client'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkDirective from 'remark-directive'
import { visit } from 'unist-util-visit'

const markdown = `
We’re speaking with technical teams to better understand:

- How you discovered Dify
- What resonated — and what didn’t
- How we can improve the experience

:::::withiconlist{.mt-4}

::::withiconitem{icon="amazon"}
$100 Amazon gift card
:::withiconitem{icon="abc"}
inner 
:::
::::

::::withiconitem{icon="dify"}
Exclusive **Dify** swag
::::

:::::
`

type WithIconListProps = {
  children?: ReactNode
  mt?: string | number
  className?: string
  class?: string
}

type WithIconItemProps = {
  icon?: string
  children?: ReactNode
}

type DirectiveNode = {
  name?: string
  attributes?: Record<string, string>
  data?: {
    hName?: string
    hProperties?: Record<string, string>
  }
}

function WithIconList({ children, mt, className }: WithIconListProps) {
  const classValue = className || ''
  const classMarginTop = classValue.includes('mt-4') ? 16 : 0

  return (
    <div style={{ marginTop: Number(mt || classMarginTop) }}>
      <div style={{ padding: 16 }}>
        {children}
      </div>
    </div>
  )
}

function WithIconItem({ icon, children }: WithIconItemProps) {
  return (
    <div style={{ display: 'flex', border: '1px solid #ddd', gap: 8 }}>
      <span>🔹</span>
      <span>{children}</span>
      <small style={{ color: '#999' }}>
        {`(${icon})`}
      </small>
    </div>
  )
}

function directivePlugin() {
  return (tree: Parameters<typeof visit>[0]) => {
    visit(
      tree,
      ['textDirective', 'leafDirective', 'containerDirective'],
      (node) => {
        const directiveNode = node as DirectiveNode
        const attributes = directiveNode.attributes || {}
        const hProperties: Record<string, string> = { ...attributes }

        if (hProperties.class) {
          hProperties.className = hProperties.class
          delete hProperties.class
        }

        const data = directiveNode.data || (directiveNode.data = {})
        data.hName = directiveNode.name?.toLowerCase()
        data.hProperties = hProperties
      },
    )
  }
}

const directiveComponents = {
  withiconlist: WithIconList,
  withiconitem: WithIconItem,
} as unknown as import('react-markdown').Components

export default function RemarkDirectiveTestPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>
        remark-directive test page
      </h1>
      <div className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkDirective, directivePlugin]}
          components={directiveComponents}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </main>
  )
}
