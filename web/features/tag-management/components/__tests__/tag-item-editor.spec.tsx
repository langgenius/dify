import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { TagItemEditor } from '../tag-item-editor'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: async (
      _path: string[],
      input: { body: unknown },
      options: { context: { silent?: boolean } },
    ) => {
      // Keep the production request layer so a missing silent option produces a second toast.
      // oxlint-disable-next-line no-restricted-imports, typescript/no-deprecated -- Verify business feedback against the real request transport.
      const { request } = await import('@/service/base')
      return request(
        '/tags/tag-1',
        { method: 'PATCH', body: input.body },
        { silent: options.context.silent },
      )
    },
  },
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('shows only the business error for each failed rename, including a retry', async () => {
  const network = vi.fn(
    async () =>
      new Response(JSON.stringify({ message: 'Tag name already exists' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', network)
  const user = userEvent.setup()
  const { wrapper } = createConsoleQueryWrapper()
  render(
    <TagItemEditor tag={{ id: 'tag-1', name: 'Original', type: 'app', binding_count: '0' }} />,
    {
      wrapper,
    },
  )

  for (let attempt = 1; attempt <= 2; attempt++) {
    await user.click(screen.getByRole('button', { name: 'common.operation.edit Original' }))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Renamed')
    fireEvent.blur(input)
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(attempt))
    expect(toast.error).toHaveBeenLastCalledWith('Tag name already exists')
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
  }
  expect(network).toHaveBeenCalledTimes(2)
})
