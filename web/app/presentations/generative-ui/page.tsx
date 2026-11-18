import type { Metadata } from '@/next'
import { presentationLanguages } from '@/features/generative-ui-presentation/locales'
import { GenerativeUIPresentation } from '@/features/generative-ui-presentation/presentation'

export function generateMetadata(): Metadata {
  return {
    title: { absolute: 'Dify Generative UI' },
    robots: { index: false, follow: false },
  }
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>
}) {
  const { lang } = await searchParams
  const locale =
    presentationLanguages.find((language) => language.value === lang)?.value ?? 'zh-Hans'

  return <GenerativeUIPresentation key={locale} locale={locale} />
}
