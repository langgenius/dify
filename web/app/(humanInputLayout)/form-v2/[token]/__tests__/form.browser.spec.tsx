import { createContext } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { humanInputV2FormClient } from '@/service/human-input-v2'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import FormContent from '../form'

const RouteTokenContext = createContext('v2-token')

vi.mock('@/next/navigation', async () => {
  const { use } = await import('react')
  return { useParams: () => ({ token: use(RouteTokenContext) }) }
})

vi.mock('@/service/human-input-v2', () => ({
  humanInputV2FormClient: { getForm: vi.fn(), requestAccess: vi.fn() },
}))

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
  vi.mocked(humanInputV2FormClient.getForm).mockImplementation(async ({ params }) => ({
    form_content: `Review ${params.form_token}\n\n{{#$output.response#}}`,
    inputs: [
      {
        type: 'paragraph',
        output_variable_name: 'response',
        default: { type: 'constant', value: `Default for ${params.form_token}`, selector: [] },
      },
    ],
    resolved_default_values: { response: `Default for ${params.form_token}` },
    user_actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
    expiration_time: 1_900_000_000,
  }))
  vi.mocked(humanInputV2FormClient.requestAccess).mockImplementation(async ({ params }) => ({
    challenge_token: `challenge-${params.form_token}`,
    expires_in_seconds: 300,
    resend_after_seconds: 30,
  }))
  onTestFinished(() => {
    vi.restoreAllMocks()
  })
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
