import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQueryState } from 'nuqs'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { render } from '@/test/console/render'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { SettingsModal } from '../settings-modal'

vi.mock('@/app/components/header/account-setting', () => ({
  default: ({ activeTab, onCancelAction }: { activeTab: string; onCancelAction: () => void }) => (
    <>
      <div role="status" aria-label="active account setting tab">
        {activeTab}
      </div>
      <button type="button" onClick={onCancelAction}>
        cancel account setting
      </button>
    </>
  ),
}))

vi.mock('@/app/components/integrations/modal', () => ({
  default: ({
    section,
    onCancel,
    onSectionChange,
  }: {
    section: string
    onCancel: () => void
    onSectionChange: (section: 'data-source') => void
  }) => (
    <>
      <div role="status" aria-label="active integration setting section">
        {section}
      </div>
      <button type="button" onClick={() => onSectionChange('data-source')}>
        switch integration section
      </button>
      <button type="button" onClick={onCancel}>
        cancel integration setting
      </button>
    </>
  ),
}))

function PreferencesOpener() {
  const [settingsDestination, setSettingsDestination] = useQueryState(
    settingsQueryParamName,
    settingsQueryParser,
  )

  return (
    <button
      type="button"
      aria-pressed={settingsDestination === ACCOUNT_SETTING_TAB.PREFERENCES}
      onClick={() => setSettingsDestination(ACCOUNT_SETTING_TAB.PREFERENCES)}
    >
      open preferences
    </button>
  )
}

const renderSettingsModal = (searchParams = '', children?: React.ReactNode) => {
  const { wrapper, onUrlUpdate } = createNuqsTestWrapper({ searchParams })

  return {
    ...render(
      <>
        {children}
        <SettingsModal />
      </>,
      { wrapper },
    ),
    onUrlUpdate,
  }
}

describe('SettingsModal', () => {
  it('opens and closes account settings with shallow replace updates', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderSettingsModal('', <PreferencesOpener />)

    await user.click(screen.getByRole('button', { name: 'open preferences' }))

    expect(
      await screen.findByRole('status', { name: 'active account setting tab' }),
    ).toHaveTextContent(ACCOUNT_SETTING_TAB.PREFERENCES)
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('settings')).toBe('preferences')
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].options).toMatchObject({
      history: 'replace',
      shallow: true,
    })

    await user.click(screen.getByRole('button', { name: 'cancel account setting' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('status', { name: 'active account setting tab' }),
      ).not.toBeInTheDocument()
    })
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has('settings')).toBe(false)
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].options).toMatchObject({
      history: 'replace',
      shallow: true,
    })
  })

  it('renders an integration destination and replaces it when switching sections', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderSettingsModal('?settings=provider')

    expect(
      await screen.findByRole('status', { name: 'active integration setting section' }),
    ).toHaveTextContent('provider')

    await user.click(screen.getByRole('button', { name: 'switch integration section' }))

    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('settings')).toBe('data-source')
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].options).toMatchObject({
      history: 'replace',
      shallow: true,
    })
  })

  it('ignores invalid settings destinations', () => {
    renderSettingsModal('?settings=unknown')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
