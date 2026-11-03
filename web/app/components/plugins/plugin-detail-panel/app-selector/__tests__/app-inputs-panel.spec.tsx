import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createAppDetailFixture, createAppModelConfigFixture } from '@/test/fixtures/app'
import AppInputsPanel from '../app-inputs-panel'

const { getApp } = vi.hoisted(() => ({ getApp: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const { createFileUploadConfigFixture } = await import('@/test/fixtures/file-upload-config')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'files.upload.get': async () => createFileUploadConfigFixture(),
      'apps.byAppId.get': getApp,
    }),
  }
})
const appDetail = { id: 'app-1', mode: 'completion' } as const
const appWithInputs = () =>
  createAppDetailFixture({
    id: 'app-1',
    mode: 'completion',
    model_config: createAppModelConfigFixture({
      user_input_form: [
        { 'text-input': { variable: 'topic', label: 'Topic', required: true } },
        { select: { variable: 'tone', label: 'Tone', options: ['Formal', 'Casual'] } },
      ],
    }),
  })

it('loads real input schemas and preserves the other field when inputs change', async () => {
  const request = createDeferred<AppDetailWithSite>()
  getApp.mockReturnValue(request.promise)
  const user = userEvent.setup()
  const onChange = vi.fn()
  const Harness = () => {
    const [inputs, setInputs] = useState<Record<string, unknown>>({
      topic: 'Initial',
      tone: 'Formal',
    })
    return (
      <AppInputsPanel
        appDetail={appDetail}
        inputs={inputs}
        onFormChange={(next) => {
          setInputs(next)
          onChange(next)
        }}
      />
    )
  }
  renderWithConsoleQuery(<Harness />)
  expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
  request.resolve(appWithInputs())
  const topic = await screen.findByRole('textbox', { name: 'Topic' })
  expect(topic).toHaveValue('Initial')
  await user.clear(topic)
  await user.type(topic, 'Updated')
  await user.click(screen.getByRole('combobox', { name: 'Tone' }))
  await user.click(await screen.findByRole('option', { name: 'Casual' }))
  expect(onChange).toHaveBeenLastCalledWith({ topic: 'Updated', tone: 'Casual' })
  expect(topic).toHaveValue('Updated')
  expect(getApp).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
})

it('retries a failed app query and replaces the error with its actual fields', async () => {
  getApp.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(appWithInputs())
  const user = userEvent.setup()
  renderWithConsoleQuery(
    <AppInputsPanel inputs={{}} appDetail={appDetail} onFormChange={vi.fn()} />,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('common.errorBoundary.title')
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  expect(await screen.findByRole('textbox', { name: 'Topic' })).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(getApp).toHaveBeenCalledTimes(2)
})

it('shows no parameters when the app has no user input fields', async () => {
  getApp.mockResolvedValue(createAppDetailFixture({ id: 'app-1', mode: 'completion' }))
  renderWithConsoleQuery(
    <AppInputsPanel inputs={{}} appDetail={appDetail} onFormChange={vi.fn()} />,
  )
  expect(await screen.findByText('app.appSelector.noParams')).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})
