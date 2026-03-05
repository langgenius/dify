'use client'
import { DirectiveMarkdownRenderer } from './directive-markdown-renderer'

const markdown = `
We’re speaking with technical teams to better understand:

- How you discovered Dify
- What resonated — and what didn’t
- How we can improve the experience

::::withiconlist{.mt-4}

:::withiconitem {icon="amazon"} {b="3"}
$100 Amazon gift card
:::

:::withiconitem {icon="amazon2"}
$100 Amazon gift card2
:::

::withiconitem[Exclusive Dify swag]{icon="dify"}

::::
`

export default function RemarkDirectiveTestPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>
        remark-directive test page
      </h1>
      <div>
        <DirectiveMarkdownRenderer markdown={markdown} />
      </div>
    </main>
  )
}
