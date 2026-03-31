import { render, screen } from '@testing-library/react'

import OverviewPage from '../page'

vi.mock('@/app/components/app/overview/apikey-info-panel', () => ({
  default: () => <div>apikey-info-panel</div>,
}))

vi.mock('../chart-view', () => ({
  default: ({ appId, headerRight }: { appId: string, headerRight: React.ReactNode }) => (
    <div>
      <div>{`chart-view:${appId}`}</div>
      <div>{headerRight}</div>
    </div>
  ),
}))

vi.mock('../tracing/panel', () => ({
  default: () => <div>tracing-panel</div>,
}))

describe('OverviewRoutePage', () => {
  it('should resolve params and compose the overview page layout', async () => {
    render(await OverviewPage({ params: Promise.resolve({ appId: 'app-123' }) }))

    expect(screen.getByText('apikey-info-panel')).toBeInTheDocument()
    expect(screen.getByText('chart-view:app-123')).toBeInTheDocument()
    expect(screen.getByText('tracing-panel')).toBeInTheDocument()
  })
})
