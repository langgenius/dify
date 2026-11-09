import { act, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import { changeLanguage } from '@/i18n/client'
import ExecutedAction from '../executed-action'

vi.unmock('react-i18next')
const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/i18n/load-resource', () => ({ loadI18nResource: mocks.load }))

describe('ExecutedAction translations', () => {
  it('loads its namespace when a completed card opens without workflow translations', async () => {
    const { loadI18nResource } =
      await vi.importActual<typeof import('@/i18n/load-resource')>('@/i18n/load-resource')
    mocks.load.mockImplementation(loadI18nResource)

    render(
      <I18nClientProvider locale="en-US" resource={{}}>
        <Suspense fallback={<span>Loading action</span>}>
          <ExecutedAction executedAction={{ id: 'Approve', title: 'Approve' }} />
        </Suspense>
      </I18nClientProvider>,
    )

    expect(await screen.findByText(/has been triggered/)).toHaveTextContent(
      'Approve has been triggered',
    )
    expect(mocks.load).toHaveBeenCalledWith('en-US', 'workflowHumanInput')
    expect(screen.queryByText('nodes.humanInput.userActions.triggered')).not.toBeInTheDocument()

    await act(() => changeLanguage('zh-Hans'))

    expect(await screen.findByText('已触发')).toHaveTextContent('已触发Approve')
    expect(mocks.load).toHaveBeenCalledWith('zh-Hans', 'workflowHumanInput')
  })
})
