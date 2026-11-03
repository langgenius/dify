import { screen } from '@testing-library/react'
import { notFound } from '@/next/navigation'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import AppConnectionAuthPage from '../page'

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  notFound: vi.fn(() => {
    throw new Error('not-found')
  }),
}))

describe('app connection authorization route', () => {
  it.each([
    { source: 'cli', requester: 'Dify CLI', identity: 'al••••@northstar.io' },
    { source: 'api', requester: 'Acme Assistant', identity: 'Feishu user •••1234' },
  ])(
    'forwards the $source path identity to public connection setup',
    async ({ source, requester, identity }) => {
      const page = await AppConnectionAuthPage({
        params: Promise.resolve({ source, appId: 'sales-assistant' }),
      })
      renderWithConsoleQuery(page, { accountProfile: null, currentWorkspace: null })

      expect(screen.getByText(/share\.connections\.headless\.requestedFrom/)).toHaveTextContent(
        requester,
      )
      expect(screen.getByText(/share\.connections\.headless\.signedInAs/)).toHaveTextContent(
        identity,
      )
      expect(
        screen.getByRole('button', { name: 'share.connections.headless.finishSetup' }),
      ).toBeDisabled()
      expect(notFound).not.toHaveBeenCalled()
    },
  )

  it('returns 404 instead of accepting an unsupported source path', async () => {
    await expect(
      AppConnectionAuthPage({
        params: Promise.resolve({ source: 'service-api', appId: 'sales-assistant' }),
      }),
    ).rejects.toThrow('not-found')

    expect(notFound).toHaveBeenCalledOnce()
  })
})
