'use client'

import { Infotip } from '@/app/components/base/infotip'

export default function TitleInfotip({ content }: { content: string }) {
  return (
    <Infotip
      aria-label={content}
      popupClassName="max-w-64 text-left wrap-break-word text-text-secondary"
    >
      {content}
    </Infotip>
  )
}
