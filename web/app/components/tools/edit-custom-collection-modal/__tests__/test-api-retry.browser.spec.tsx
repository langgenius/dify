import type { CustomCollectionBackend, CustomParamSchema } from '@/app/components/tools/types'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AuthType } from '@/app/components/tools/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import TestApi from '../test-api'

const api = vi.hoisted(() => ({
  preview:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.api.test.pre.post
    >(),
}))

// boundary: only the generated preview response is replaced; the Drawer and form stay real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.toolProvider.api.test.pre.post': api.preview,
    }),
  }
})

const collection: CustomCollectionBackend = {
  provider: 'custom',
  credentials: { auth_type: AuthType.none },
  schema_type: 'openapi',
  schema: '{}',
  icon: { background: '', content: '' },
  privacy_policy: '',
  custom_disclaimer: '',
  labels: [],
}
const tool: CustomParamSchema = {
  operation_id: 'testOp',
  summary: 'Test operation',
  method: 'GET',
  server_url: 'https://api.example.com',
  parameters: [
    {
      name: 'limit',
      label: { en_US: 'Limit', zh_Hans: 'Limit' },
      human_description: { en_US: 'Result limit', zh_Hans: 'Result limit' },
      llm_description: 'Result limit',
      type: 'string',
      form: 'form',
      required: false,
    },
  ],
}

beforeEach(() => {
  api.preview.mockReset().mockResolvedValue({ result: 'Test completed' })
  onTestFinished(guardUnexpectedFetch())
})

it('releases loading after a rejected preview and retries with the preserved form', async () => {
  const pending = createDeferred<Awaited<ReturnType<typeof api.preview>>>()
  api.preview.mockReturnValueOnce(pending.promise)
  const { wrapper: Wrapper } = createConsoleQueryWrapper()
  await render(
    <Wrapper>
      <TestApi customCollection={collection} tool={tool} onHide={vi.fn()} />
    </Wrapper>,
  )
  const parameter = page.getByRole('textbox', { name: 'Limit' })
  await parameter.fill('5')
  const button = page.getByRole('button', { name: 'tools.test.title' })
  await button.click()
  await expect.element(button).toHaveAttribute('aria-disabled', 'true')
  await userEvent.keyboard('{Enter}')
  expect(api.preview).toHaveBeenCalledTimes(1)
  pending.reject(new Error('Preview request failed'))
  await expect.element(button).not.toHaveAttribute('aria-disabled', 'true')
  await expect.element(button).toHaveFocus()
  await expect.element(parameter).toHaveValue('5')
  await parameter.fill('7')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('status')).toHaveTextContent('Test completed')
  expect(api.preview).toHaveBeenCalledTimes(2)
  expect(api.preview).toHaveBeenLastCalledWith({
    body: {
      provider_name: 'custom',
      tool_name: 'testOp',
      credentials: { auth_type: 'none' },
      schema_type: 'openapi',
      schema: '{}',
      parameters: { limit: '7' },
    },
  })
})
