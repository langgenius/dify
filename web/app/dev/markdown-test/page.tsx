'use client'

import { ReactMarkdownWrapper } from '@/app/components/base/markdown/react-markdown-wrapper'

export default function Page() {
  const md = 'Text before ![image](https://example.com/a.png) text after'
  return <ReactMarkdownWrapper latexContent={md} />
}
