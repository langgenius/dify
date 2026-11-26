import type { CustomCollectionBackend, CustomParamSchema } from '@/app/components/tools/types'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AuthType } from '@/app/components/tools/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import TestApi from '../test-api'

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

const fake = setupFakeApi({
  console: {
    workspaces: {
      current: {
        toolProvider: { api: { test: { pre: { post: () => ({ result: 'Test completed' }) } } } },
      },
    },
  },
})
const preview = () => fake.console.workspaces.current.toolProvider.api.test.pre.post

it('releases loading after a rejected preview and retries with the preserved form', async () => {
  const pending = hold(preview())
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
  await pending.arrived
  expect(preview()).toHaveBeenCalledTimes(1)
  pending.reject(apiError({ status: 500, message: 'Preview request failed' }))
  await expect.element(button).not.toHaveAttribute('aria-disabled', 'true')
  await expect.element(button).toHaveFocus()
  await expect.element(parameter).toHaveValue('5')
  await parameter.fill('7')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('status')).toHaveTextContent('Test completed')
  expect(preview()).toHaveBeenCalledTimes(2)
  expect(preview()).toHaveBeenLastCalledWith({
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
