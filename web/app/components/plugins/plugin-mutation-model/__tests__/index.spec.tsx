import type { ComponentProps } from 'react'
import type { Plugin } from '../../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { expectLoadingButton } from '@/test/button'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { PluginCategoryEnum } from '../../types'
import PluginMutationModal from '../index'

const createMockPlugin = (overrides?: Partial<Plugin>): Plugin => ({
  type: 'plugin',
  org: 'test-org',
  name: 'test-plugin',
  plugin_id: 'plugin-123',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'test-org/test-plugin:1.0.0',
  icon: '/test-icon.png',
  verified: false,
  label: { en_US: 'Test Plugin' },
  brief: { en_US: 'Test plugin description' },
  description: { en_US: 'Full test plugin description' },
  introduction: 'Test plugin introduction',
  repository: 'https://github.com/test/plugin',
  category: PluginCategoryEnum.tool,
  install_count: 1000,
  endpoint: { settings: [] },
  tags: [{ name: 'search' }],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

const props = (): ComponentProps<typeof PluginMutationModal> => ({
  plugin: createMockPlugin(),
  onCancel: vi.fn(),
  mutation: { isSuccess: false, isPending: false },
  mutate: vi.fn(),
  confirmButtonText: 'Update',
  cancelButtonText: 'Cancel',
  modelTitle: <span>Update plugin</span>,
  description: 'Install the selected version?',
  cardTitleLeft: <span>v2.0.0</span>,
  modalBottomLeft: <a href="https://example.com/release">Release notes</a>,
})

describe('PluginMutationModal', () => {
  it('identifies the plugin and selected version before confirming the action', async () => {
    const user = userEvent.setup()
    const input = props()
    render(<PluginMutationModal {...input} />)
    expect(screen.getByRole('dialog', { name: 'Update plugin' })).toBeInTheDocument()
    expect(screen.getByText('Install the selected version?')).toBeInTheDocument()
    expect(screen.getByText('Test Plugin')).toBeInTheDocument()
    expect(screen.getByText('Test plugin description')).toBeInTheDocument()
    expect(screen.getByText('test-org')).toBeInTheDocument()
    expect(screen.getByText('v2.0.0')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Release notes' })).toHaveAttribute(
      'href',
      'https://example.com/release',
    )
    await user.click(screen.getByRole('button', { name: 'Update' }))
    expect(input.mutate).toHaveBeenCalledOnce()
    expect(input.onCancel).not.toHaveBeenCalled()
  })

  it.each(['Cancel', 'common.operation.close', 'Escape'])(
    'dismisses with %s without mutating the plugin',
    async (action) => {
      const user = userEvent.setup()
      const input = props()
      render(<PluginMutationModal {...input} />)
      if (action === 'Escape') await user.keyboard('{Escape}')
      else await user.click(screen.getByRole('button', { name: action }))
      expect(input.onCancel).toHaveBeenCalledOnce()
      expect(input.mutate).not.toHaveBeenCalled()
    },
  )

  it('blocks repeated confirmation while pending and restores actions after it settles', async () => {
    const user = userEvent.setup()
    const input = props()
    const { rerender } = render(
      <PluginMutationModal {...input} mutation={{ isSuccess: false, isPending: true }} />,
    )
    const confirm = screen.getByRole('button', { name: 'Update' })
    expectLoadingButton(confirm)
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    await user.click(confirm)
    expect(input.mutate).not.toHaveBeenCalled()
    rerender(<PluginMutationModal {...input} />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Update' }))
    expect(input.mutate).toHaveBeenCalledOnce()
  })
})
