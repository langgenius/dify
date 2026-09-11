import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithNuqs } from '@/test/nuqs-testing'
import CatalogLanguagesFilter from '../catalog-languages-filter'

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string, options?: { ns?: string }) =>
        options?.ns ? `${options.ns}.${key}` : key,
      ),
    }),
  }
})

describe('CatalogLanguagesFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes selected languages into the URL', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderWithNuqs(<CatalogLanguagesFilter />)
    await user.click(screen.getByRole('button', { name: 'plugin.marketplace.languages' }))
    await user.click(screen.getByRole('checkbox', { name: '中文' }))
    await waitFor(() => {
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('languages')).toBe('zh-Hans')
    })
  })
})
