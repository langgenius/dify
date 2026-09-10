'use client'

import dynamic from '@/next/dynamic'

type DynamicPdfPreviewProps = {
  url: string
  onCancel: () => void
}
const DynamicPdfPreview = dynamic<DynamicPdfPreviewProps>(() => import('./pdf-preview'), {
  ssr: false,
})

export default DynamicPdfPreview
