import type { AgentBuildDraftChangedKey } from '../../build-draft-changes-context'
import { render, screen } from '@testing-library/react'
import { AgentBuildDraftChangedKeysProvider } from '../../build-draft-changes-context'
import { ConfigureSection } from '../section'

function renderSection({
  section = 'skills',
  changedKeys,
}: {
  section?: 'skills' | 'files'
  changedKeys: AgentBuildDraftChangedKey[]
}) {
  return render(
    <AgentBuildDraftChangedKeysProvider changedKeys={changedKeys}>
      <ConfigureSection
        label={section === 'skills' ? 'Skills' : 'Files'}
        labelId={`${section}-label`}
        buildDraftChangeSection={section}
      >
        <div>{`${section} content`}</div>
      </ConfigureSection>
    </AgentBuildDraftChangedKeysProvider>,
  )
}

describe('ConfigureSection', () => {
  it('should show a build draft change dot when Skills changed', () => {
    renderSection({ section: 'skills', changedKeys: ['skills'] })

    expect(screen.getByRole('heading', { name: 'Skills' }).querySelector('.bg-text-warning-secondary')).toBeInTheDocument()
  })

  it('should show a build draft change dot when Files changed', () => {
    renderSection({ section: 'files', changedKeys: ['files'] })

    expect(screen.getByRole('heading', { name: 'Files' }).querySelector('.bg-text-warning-secondary')).toBeInTheDocument()
  })

  it('should not show a build draft change dot when only another key changed', () => {
    renderSection({ section: 'skills', changedKeys: ['prompt'] })

    expect(screen.getByRole('heading', { name: 'Skills' }).querySelector('.bg-text-warning-secondary')).not.toBeInTheDocument()
  })
})
