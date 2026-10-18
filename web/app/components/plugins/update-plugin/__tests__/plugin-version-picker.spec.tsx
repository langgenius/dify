import type { VersionListResponse } from '../../types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import PluginVersionPicker from '../plugin-version-picker'

const { getVersions } = vi.hoisted(() => ({ getVersions: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  getMarketplace: getVersions,
}))
vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatDate: (value: string) => value }),
}))

const response: { data: VersionListResponse } = {
  data: {
    versions: ['2.0.0', '1.0.0'].map((version) => ({
      plugin_org: 'test',
      plugin_name: 'plugin',
      version,
      file_name: 'plugin.difypkg',
      checksum: `checksum-${version}`,
      created_at: '2024-01-02T00:00:00Z',
      unique_identifier: `test/plugin:${version}`,
    })),
  },
}

const Picker = ({
  disabled = false,
  currentVersion = '2.0.0',
  onSelect = vi.fn(),
}: {
  disabled?: boolean
  currentVersion?: string
  onSelect?: (selection: {
    version: string
    unique_identifier: string
    isDowngrade: boolean
  }) => void
}) => {
  const [open, setOpen] = useState(false)
  return (
    <PluginVersionPicker
      disabled={disabled}
      isShow={open}
      onShowChange={setOpen}
      pluginID="test/plugin"
      currentVersion={currentVersion}
      trigger={(isOpen) => <span>{isOpen ? 'Close versions' : 'Select version'}</span>}
      onSelect={onSelect}
    />
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  getVersions.mockResolvedValue(response)
})

it('fetches versions only after opening and replaces loading with the current-version marker', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<typeof response>()
  getVersions.mockReturnValueOnce(pending.promise)
  render(<Picker />)
  expect(getVersions).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Select version' }))

  expect(await screen.findByRole('status', { name: 'common.loading' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Close versions' })).toBeInTheDocument()
  expect(getVersions).toHaveBeenCalledExactlyOnceWith('/plugins/test/plugin/versions', {
    params: { page: 1, page_size: 100 },
  })
  await act(async () => pending.resolve(response))
  expect(await screen.findByRole('button', { name: /2\.0\.0.*CURRENT/ })).toBeDisabled()
  expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
})

it.each([
  { currentVersion: '2.0.0', selectedVersion: '1.0.0', isDowngrade: true },
  { currentVersion: '1.0.0', selectedVersion: '2.0.0', isDowngrade: false },
])(
  'selects $selectedVersion from $currentVersion and closes the picker',
  async ({ currentVersion, selectedVersion, isDowngrade }) => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Picker currentVersion={currentVersion} onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: 'Select version' }))
    await user.click(
      await screen.findByRole('button', {
        name: new RegExp(selectedVersion.replaceAll('.', '\\.')),
      }),
    )

    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      version: selectedVersion,
      unique_identifier: `test/plugin:${selectedVersion}`,
      isDowngrade,
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /CURRENT/ })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Select version' })).toBeInTheDocument()
  },
)

it('does not open or request versions while disabled', async () => {
  const user = userEvent.setup()
  render(<Picker disabled />)
  const trigger = screen.getByRole('button', { name: 'Select version' })
  expect(trigger).toBeDisabled()
  await user.click(trigger)
  expect(getVersions).not.toHaveBeenCalled()
  expect(screen.queryByText('plugin.detailPanel.switchVersion')).not.toBeInTheDocument()
})
