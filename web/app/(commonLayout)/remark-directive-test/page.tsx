'use client'
import { MarkdownWithDirective } from '@/app/components/base/markdown-with-directive'

const markdown = `
We’re speaking with technical teams to better understand:

- How you discovered Dify
- What resonated — and what didn’t
- How we can improve the experience

::::withIconCardList

:::withIconCardItem {icon="https://assets.dify.ai/images/gift-card.png"}
$100 Amazon gift card
:::

:::withIconCardItem {icon="https://assets.dify.ai/images/dify-swag.png"}
Dify swag
:::

::::
`

export default function RemarkDirectiveTestPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>
        remark-directive test page
      </h1>
      <div className="markdown-body">
        <MarkdownWithDirective markdown={markdown} />
      </div>
    </main>
  )
}
