import type { AgentOrchestrateAddAction } from '../../add-actions-context'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { AgentPromptSlashMenu } from '../slash'

describe('AgentPromptSlashMenu', () => {
  it('offers library and skill.zip as separate add-skill actions', async () => {
    const user = userEvent.setup()
    const onAddSkill = vi.fn<AgentOrchestrateAddAction>()
    const onInsertToken = vi.fn()

    render(
      <AgentPromptSlashMenu
        view="skills"
        categories={[
          {
            key: 'skills',
            label: 'Skills',
            icon: 'i-custom-vender-agent-v2-building-blocks',
          },
        ]}
        skills={[]}
        files={[]}
        configuredTools={[]}
        knowledgeRetrievals={[]}
        onAddProviderTools={vi.fn()}
        onAddSkill={onAddSkill}
        onBack={vi.fn()}
        onOpenCategory={vi.fn()}
        onInsertToken={onInsertToken}
      />,
    )

    await user.click(
      screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.skills.addMenu.workspace.label',
      }),
    )
    expect(onAddSkill).toHaveBeenLastCalledWith(expect.objectContaining({ skillSource: 'library' }))
    expect(onInsertToken).not.toHaveBeenCalled()
    onAddSkill.mock.calls
      .at(-1)![0]!
      .onAdded?.({ id: 'library-skill', name: 'Library Skill', fileId: 'library-file' })
    expect(onInsertToken).toHaveBeenLastCalledWith('[§skill:library-skill:Library Skill§]')

    await user.click(
      screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.skills.addMenu.upload.label',
      }),
    )
    expect(onAddSkill).toHaveBeenLastCalledWith(expect.objectContaining({ skillSource: 'upload' }))
    onAddSkill.mock.calls
      .at(-1)![0]!
      .onAdded?.({ id: 'uploaded-skill', name: 'Uploaded Skill', fileId: 'uploaded-file' })
    expect(onInsertToken).toHaveBeenLastCalledWith('[§skill:uploaded-skill:Uploaded Skill§]')
  })
})
