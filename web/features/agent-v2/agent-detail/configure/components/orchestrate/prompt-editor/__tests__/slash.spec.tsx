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

it.each([
  {
    view: 'files' as const,
    label: /configure.files.add/,
    item: { id: 'file-1', name: 'Guide.md', icon: 'markdown' as const, configName: 'Guide.md' },
    token: '[§file:Guide.md:Guide.md§]',
  },
  {
    view: 'knowledge' as const,
    label: /configure.knowledgeRetrieval.add/,
    item: { id: 'retrieval-1', name: 'Retrieval One', queryMode: 'agent' as const },
    token: '[§knowledge:retrieval-1:Retrieval One§]',
  },
])(
  'inserts a reference when the $view add action returns a new item',
  async ({ view, label, item, token }) => {
    const user = userEvent.setup()
    const onInsertToken = vi.fn()
    const onAdd: AgentOrchestrateAddAction = (options) => options?.onAdded?.(item)
    render(
      <AgentPromptSlashMenu
        view={view}
        categories={[{ key: view, label: view, icon: 'i-ri-file-line' }]}
        skills={[]}
        files={[]}
        configuredTools={[]}
        knowledgeRetrievals={[]}
        onAddProviderTools={vi.fn()}
        onAddFile={onAdd}
        onAddKnowledge={onAdd}
        onBack={vi.fn()}
        onOpenCategory={vi.fn()}
        onInsertToken={onInsertToken}
      />,
    )
    await user.click(screen.getByRole('button', { name: label }))
    expect(onInsertToken).toHaveBeenCalledExactlyOnceWith(token)
  },
)
