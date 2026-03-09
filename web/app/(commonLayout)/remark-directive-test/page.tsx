'use client'
import InSiteMessage from '@/app/components/app/in-site-message'
import { MarkdownWithDirective } from '@/app/components/base/markdown-with-directive'

const markdown1 = `
We’re refining our messaging for technical teams, like how did you find us and did our positioning truly resonate?

Share your perspective in a 30-minute chat and receive:

::::withIconCardList

:::withIconCardItem {icon="https://assets.dify.ai/images/gift-card.png"}
$100 Amazon gift card
:::

:::withIconCardItem {icon="https://assets.dify.ai/images/dify-swag.png"}
Dify swag
:::

::::
`

const markdown2 = `
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

const inSiteMessageMain = `
We’re speaking with technical teams to better understand:

- How you discovered Dify
- What resonated — and what didn’t
- How we can improve the experience

As a thank-you for your time:

::::withIconCardList

:::withIconCardItem {icon="https://assets.dify.ai/images/gift-card.png"}
$100 Amazon gift card
:::

:::withIconCardItem {icon="https://assets.dify.ai/images/dify-swag.png"}
Exclusive Dify swag
:::

::::
`

export default function RemarkDirectiveTestPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>
        remark-directive test page
      </h1>
      <div>
        <MarkdownWithDirective markdown={markdown1} />
      </div>

      <div className="mt-5">
        <MarkdownWithDirective markdown={markdown2} />
      </div>

      <InSiteMessage
        title="Help Shape Dify"
        subtitle="We’d love to hear how you evaluate and use Dify"
        main={inSiteMessageMain}
        actions={[
          { type: 'default', text: 'Not now', action: 'close' },
          {
            type: 'primary',
            text: 'Schedule 30-min Chat',
            action: 'link',
            data: {
              href: 'https://dify.ai',
              target: '_blank',
            },
          },
        ]}
      />
    </main>
  )
}
