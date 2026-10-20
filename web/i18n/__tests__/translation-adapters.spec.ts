import { getRouteMetadata } from '@/app/route-metadata'
import common from '../locales/en-US/common.json'

vi.mock('server-only', () => ({}))
vi.mock('@/i18n/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/server')>()),
  getLocaleOnServer: async () => 'en-US',
}))

it('resolves route metadata from the requested namespace and selector', async () => {
  await expect(getRouteMetadata('common', ($) => $['operation.save'])).resolves.toEqual({
    title: common['operation.save'],
  })
})
