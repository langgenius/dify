import { describe, expect, it, vi } from 'vite-plus/test'
import { generateMetadata } from '../page'

vi.mock('server-only', () => ({}))

vi.mock('@/i18n-config/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n-config/server')>()),
  getLocaleOnServer: async () => 'en-US',
}))

describe('Skills route metadata', () => {
  it('provides the localized document title for the Skills route', async () => {
    await expect(generateMetadata()).resolves.toMatchObject({ title: 'Skills' })
  })
})
