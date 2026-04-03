import { fireEvent, render, screen } from '@testing-library/react'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { PublisherAccessSection, PublisherSummarySection } from '../sections'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('app-publisher sections', () => {
  it('should render restore controls for published chat apps', () => {
    const handleRestore = vi.fn()

    render(
      <PublisherSummarySection
        debugWithMultipleModel={false}
        draftUpdatedAt={Date.now()}
        formatTimeFromNow={() => '3 minutes ago'}
        handlePublish={vi.fn()}
        handleRestore={handleRestore}
        isChatApp
        multipleModelConfigs={[]}
        publishDisabled={false}
        published={false}
        publishedAt={Date.now()}
        publishShortcut={['ctrl', '⇧', 'P']}
        startNodeLimitExceeded={false}
        upgradeHighlightStyle={{}}
      />,
    )

    fireEvent.click(screen.getByText('common.restore'))
    expect(handleRestore).toHaveBeenCalled()
  })

  it('should expose the access control warning when subjects are missing', () => {
    render(
      <PublisherAccessSection
        enabled
        isAppAccessSet={false}
        isLoading={false}
        accessMode={AccessMode.SPECIFIC_GROUPS_MEMBERS}
        onClick={vi.fn()}
      />,
    )

    expect(screen.getByText('publishApp.notSet')).toBeInTheDocument()
    expect(screen.getByText('publishApp.notSetDesc')).toBeInTheDocument()
  })

  it('should render the publish update action when the draft has not been published yet', () => {
    render(
      <PublisherSummarySection
        debugWithMultipleModel={false}
        draftUpdatedAt={Date.now()}
        formatTimeFromNow={() => '1 minute ago'}
        handlePublish={vi.fn()}
        handleRestore={vi.fn()}
        isChatApp={false}
        multipleModelConfigs={[]}
        publishDisabled={false}
        published={false}
        publishedAt={undefined}
        publishShortcut={['ctrl', '⇧', 'P']}
        startNodeLimitExceeded={false}
        upgradeHighlightStyle={{}}
      />,
    )

    expect(screen.getByText('common.publishUpdate')).toBeInTheDocument()
  })
})
