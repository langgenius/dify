import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { installFakeApi, route } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import FormContent from '../form'

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

it('replaces an edited form and verification proof when the route token changes', async () => {
  const { wrapper: Wrapper } = createConsoleQueryWrapper()
  const navigation = createTestNavigation({
    url: '/form-v2/v2-token',
    params: { token: 'v2-token' },
  })
  const { NavigationProvider } = navigation
  await render(
    <NavigationProvider>
      <Wrapper>
        <FormContent />
      </Wrapper>
    </NavigationProvider>,
  )
  await page.getByRole('textbox', { name: 'Review v2-token' }).fill('Previous draft')
  const otp = page.getByRole('textbox', { name: 'share.humanInputV2.otpLabel' })
  await otp.fill('123456')

  navigation.navigate('/form-v2/next-token', { params: { token: 'next-token' } })

  await expect
    .element(page.getByRole('textbox', { name: 'Review next-token' }))
    .toHaveValue('Default for next-token')
  await expect
    .element(page.getByRole('textbox', { name: 'Review v2-token' }))
    .not.toBeInTheDocument()
  await expect.element(otp).toHaveValue('')
})
