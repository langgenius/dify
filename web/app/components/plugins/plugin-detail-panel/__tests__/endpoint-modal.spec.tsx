import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import EndpointModal from '../endpoint-modal'
import { createPluginDetail } from './endpoint-fixture'

const { showError } = vi.hoisted(() => ({ showError: vi.fn() }))
vi.mock('@/app/notifications', () => ({ toast: { error: showError } }))
vi.mock('../../readme-panel/entrance', () => ({ ReadmeEntrance: () => null }))
vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (label: { en_US: string }) => label.en_US,
}))

const mockPluginDetail = createPluginDetail()

describe('Endpoint settings form', () => {
  beforeEach(() => vi.clearAllMocks())

  it('preserves typed defaults and validates required false as a present value', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(
      <EndpointModal
        pluginDetail={mockPluginDetail}
        onCancel={vi.fn()}
        onSaved={onSaved}
        settings={[
          { name: 'enabled', type: 'boolean', required: true, default: false },
          { name: 'limit', type: 'text-input', required: true, default: '0', label: null },
        ]}
      />,
    )
    await user.type(screen.getByPlaceholderText('Endpoint Name'), 'New endpoint')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onSaved).toHaveBeenCalledWith({
      name: 'New endpoint',
      settings: { enabled: false, limit: '0' },
    })
    expect(showError).not.toHaveBeenCalled()
  })

  it.each([
    ['true', true],
    ['True', true],
    ['1', true],
    ['false', false],
    [true, true],
    [false, false],
    [1, true],
    [0, false],
  ])('renders and submits boolean default %j as %j', async (value, expected) => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(
      <EndpointModal
        pluginDetail={mockPluginDetail}
        onCancel={vi.fn()}
        onSaved={onSaved}
        defaultValues={{ name: 'Typed endpoint' }}
        settings={[{ name: 'enabled', type: 'boolean', required: true, default: value }]}
      />,
    )
    expect(screen.getByRole('radio', { name: expected ? 'True' : 'False' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onSaved).toHaveBeenCalledWith({
      name: 'Typed endpoint',
      settings: { enabled: expected },
    })
  })

  it('interprets an empty optional boolean default as false', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(
      <EndpointModal
        pluginDetail={mockPluginDetail}
        onCancel={vi.fn()}
        onSaved={onSaved}
        defaultValues={{ name: 'Optional endpoint' }}
        settings={[{ name: 'enabled', type: 'boolean', default: '' }]}
      />,
    )
    expect(screen.getByRole('radio', { name: 'False' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onSaved).toHaveBeenCalledWith({
      name: 'Optional endpoint',
      settings: { enabled: false },
    })
  })

  it('preserves a nullable optional boolean and rejects an empty required boolean', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const { rerender } = render(
      <EndpointModal
        pluginDetail={mockPluginDetail}
        onCancel={vi.fn()}
        onSaved={onSaved}
        defaultValues={{ name: 'Nullable endpoint' }}
        settings={[{ name: 'enabled', type: 'boolean', default: null }]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onSaved).toHaveBeenCalledWith({ name: 'Nullable endpoint', settings: { enabled: null } })
    onSaved.mockClear()
    rerender(
      <EndpointModal
        key="required"
        pluginDetail={mockPluginDetail}
        onCancel={vi.fn()}
        onSaved={onSaved}
        defaultValues={{ name: 'Required endpoint', enabled: '' }}
        settings={[{ name: 'enabled', type: 'boolean', required: true, default: true }]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onSaved).not.toHaveBeenCalled()
    expect(showError).toHaveBeenCalled()
  })

  it('preserves explicit clearing and does not mutate edit values', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const defaults = {
      name: 'Existing',
      token: '',
      enabled: false,
      retry_count: 0,
      nested: { limit: 3 },
    }
    render(
      <EndpointModal
        pluginDetail={mockPluginDetail}
        onCancel={vi.fn()}
        onSaved={onSaved}
        defaultValues={defaults}
        settings={[
          {
            name: 'token',
            type: 'secret-input',
            default: 'fallback',
            label: { en_US: 'Token', zh_Hans: null },
            placeholder: { en_US: 'Token' },
          },
        ]}
      />,
    )
    expect(screen.getByPlaceholderText('Token')).toHaveValue('')
    await user.clear(screen.getByPlaceholderText('Endpoint Name'))
    await user.type(screen.getByPlaceholderText('Endpoint Name'), 'Updated')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onSaved).toHaveBeenCalledWith({
      name: 'Updated',
      settings: { token: '', enabled: false, retry_count: 0, nested: { limit: 3 } },
    })
    expect(defaults).toEqual({
      name: 'Existing',
      token: '',
      enabled: false,
      retry_count: 0,
      nested: { limit: 3 },
    })
  })

  it('keeps the form open and identifies a missing required field', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(
      <EndpointModal
        pluginDetail={mockPluginDetail}
        onCancel={vi.fn()}
        onSaved={onSaved}
        settings={[]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onSaved).not.toHaveBeenCalled()
    expect(showError).toHaveBeenCalled()
    expect(screen.getByPlaceholderText('Endpoint Name')).toBeInTheDocument()
  })

  it('keeps pending save focusable and blocks click and implicit submissions', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(
      <EndpointModal
        pluginDetail={mockPluginDetail}
        onCancel={vi.fn()}
        onSaved={onSaved}
        settings={[]}
        defaultValues={{ name: 'Pending endpoint' }}
        isPending
      />,
    )
    const save = screen.getByRole('button', { name: 'common.operation.save' })
    expect(save).toHaveAttribute('aria-disabled', 'true')
    expect(save).not.toBeDisabled()
    await user.click(save)
    await user.click(screen.getByPlaceholderText('Endpoint Name'))
    await user.keyboard('{Enter}')
    expect(onSaved).not.toHaveBeenCalled()
  })
})
