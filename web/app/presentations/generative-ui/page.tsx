import type { Metadata } from '@/next'
import { GenerativeUIPresentation } from '@/features/generative-ui-presentation/presentation'

export function generateMetadata(): Metadata {
  return {
    title: { absolute: 'Dify Generative UI' },
    robots: { index: false, follow: false },
  }
}

export default function Page() {
  return <GenerativeUIPresentation />
}
