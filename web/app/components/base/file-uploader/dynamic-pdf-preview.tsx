'use client'

import dynamic from 'next/dynamic'

type DynamicPdfPreviewProps = {
  url: string
  onCancel: () => void
}
const DynamicPdfPreview = dynamic<DynamicPdfPreviewProps>(
  (() => {
    if (typeof window !== 'undefined')
      return import('./pdf-preview')
  }) as any,
  { ssr: false }, // This will prevent the module from being loaded on the server-side
)

export default DynamicPdfPreview
