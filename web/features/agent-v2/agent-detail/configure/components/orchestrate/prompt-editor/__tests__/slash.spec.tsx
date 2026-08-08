import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AgentPromptSlashMenu } from '../slash'

describe('AgentPromptSlashMenu', () => {
  it('offers library and skill.zip as separate add-skill actions', async () => {
    const user = userEvent.setup()
    const onAddSkill = vi.fn()

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
        onInsertToken={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.skills.addMenu.workspace.label',
      }),
    )
    expect(onAddSkill).toHaveBeenLastCalledWith(expect.objectContaining({ skillSource: 'library' }))

    await user.click(
      screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.skills.addMenu.upload.label',
      }),
    )
    expect(onAddSkill).toHaveBeenLastCalledWith(expect.objectContaining({ skillSource: 'upload' }))
  })
})
