import { createContext } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { installFakeApi, route } from '@/test/fake-api'
import FormContent from '../form'

const RouteTokenContext = createContext('v2-token')

vi.mock('@/next/navigation', async () => {
  const { use } = await import('react')
  return { useParams: () => ({ token: use(RouteTokenContext) }) }
})

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(
    installFakeApi({
      routes: [
        route('GET', 'public', '/form/human-input/v2/public/:token', ({ params }) => ({
          form_content: `Review ${params.token}\n\n{{#$output.response#}}`,
          inputs: [
            {
              type: 'paragraph',
              output_variable_name: 'response',
              default: { type: 'constant', value: `Default for ${params.token}`, selector: [] },
            },
          ],
          resolved_default_values: { response: `Default for ${params.token}` },
          user_actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
          expiration_time: 1_900_000_000,
        })),
        route(
          'POST',
          'public',
          '/form/human-input/v2/public/:token/access-request',
          ({ params }) => ({
            challenge_token: `challenge-${params.token}`,
            expires_in_seconds: 300,
            resend_after_seconds: 30,
          }),
        ),
      ],
    }),
  )
})

it('loads the v2 form for the route token', async () => {
  const { wrapper: Wrapper } = createConsoleQueryWrapper()
  await render(
    <Wrapper>
      <RouteTokenContext value="v2-token">
        <FormContent />
      </RouteTokenContext>
    </Wrapper>,
  )

  await expect
    .element(page.getByRole('textbox', { name: 'Review v2-token' }))
    .toHaveValue('Default for v2-token')
  await expect
    .element(page.getByRole('textbox', { name: 'share.humanInputV2.otpLabel' }))
    .toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Approve' })).toBeEnabled()
})

it('replaces an edited form and verification proof when the route token changes', async () => {
  const { wrapper: Wrapper } = createConsoleQueryWrapper()
  const view = await render(
    <Wrapper>
      <RouteTokenContext value="v2-token">
        <FormContent />
      </RouteTokenContext>
    </Wrapper>,
  )
  await page.getByRole('textbox', { name: 'Review v2-token' }).fill('Previous draft')
  const otp = page.getByRole('textbox', { name: 'share.humanInputV2.otpLabel' })
  await otp.fill('123456')

  await view.rerender(
    <Wrapper>
      <RouteTokenContext value="next-token">
        <FormContent />
      </RouteTokenContext>
    </Wrapper>,
  )

  await expect
    .element(page.getByRole('textbox', { name: 'Review next-token' }))
    .toHaveValue('Default for next-token')
  await expect
    .element(page.getByRole('textbox', { name: 'Review v2-token' }))
    .not.toBeInTheDocument()
  await expect.element(otp).toHaveValue('')
})
