import type { Locale } from '@/i18n-config/language'
import { render, screen } from '@testing-library/react'
import { PricingFooter } from '../footer'

let locale: Locale = 'en-US'
vi.mock('@/context/i18n', () => ({ useLocale: () => locale }))

it.each<[Locale, string]>([
  ['en-US', ''],
  ['zh-Hans', '/zh'],
  ['ja-JP', '/ja'],
  ['ko-KR', '/ko'],
  ['de-DE', ''],
])('links to the current website comparison pages for %s', (language, prefix) => {
  locale = language
  const { rerender } = render(<PricingFooter category="cloud" />)
  const link = screen.getByRole('link', { name: 'billing.plansCommon.comparePlanAndFeatures' })
  expect(link).toHaveAttribute('href', `https://dify.ai${prefix}/pricing/dify-cloud#compare`)
  rerender(<PricingFooter category="self-hosted" />)
  expect(link).toHaveAttribute('href', `https://dify.ai${prefix}/pricing/dify-enterprise#compare`)
})
