import { render } from 'vitest-browser-react'
import useDocumentTitle from '@/hooks/use-document-title'

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({
    data: {
      branding: {
        application_title: 'Acme',
        enabled: true,
        favicon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      },
    },
  }),
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({}),
}))

type Route = 'apps' | 'detail'

const NavigationSurface = ({ route }: { route: Route }) => {
  const isAppDetail = route === 'detail'
  const heading = isAppDetail ? 'Orchestrate' : 'Studio'
  useDocumentTitle(heading)

  return (
    <>
      <link key={route} rel="icon" href={`/${route}.ico`} />
      <main>
        <h1>{heading}</h1>
      </main>
    </>
  )
}

describe('document head navigation', () => {
  it('commits the target DOM when React replaces hoisted metadata during navigation', async () => {
    // Chromium and React DOM own head hoisting and commit order; happy-dom cannot prove this regression.
    const screen = await render(<NavigationSurface route="apps" />)
    await expect.element(screen.getByRole('heading', { name: 'Studio' })).toBeVisible()

    await screen.rerender(<NavigationSurface route="detail" />)

    await expect.element(screen.getByRole('heading', { name: 'Orchestrate' })).toBeVisible()
  })
})
