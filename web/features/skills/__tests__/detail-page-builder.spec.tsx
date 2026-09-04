import type { SkillDetailResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  createDefaultSkillDraftDetail,
  createSkillDetail,
  getBuilderAttachmentInput,
  getMocks,
  getSourceEditor,
  openRootCreateMenu,
  renderSkillDetailPage,
  resetDetailPageFixture,
} from './detail-page.fixture'

const mocks = getMocks()

describe('SkillDetailPage builder', () => {
  beforeEach(resetDetailPageFixture)

  it('shows Skill manifest placeholders for an empty draft', async () => {
    mocks.skillDetail = createDefaultSkillDraftDetail()

    renderSkillDetailPage()

    expect(
      await screen.findByPlaceholderText('skill.skillManagement.detail.skillNamePlaceholder'),
    ).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('skill.skillManagement.detail.skillDescriptionPlaceholder'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(
        'Describe what this Skill does, when an Agent should use it, and any step-by-step instructions it must follow.',
      ),
    ).not.toBeInTheDocument()
  })

  it('hides the empty draft marker after Builder fills only the Skill description', async () => {
    mocks.skillDetail = createDefaultSkillDraftDetail({
      description: 'Generate consistent character illustrations from a short prompt.',
      files: [
        {
          id: 'file-1',
          path: 'SKILL.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content:
            '---\nname: character-illustration\ndescription: Generate consistent character illustrations from a short prompt.\nmetadata:\n  display-name: Character illustration\n---\n\n<!-- dify-skill-empty-draft -->\n',
          tool_file_id: null,
          size: 190,
          hash: 'hash-1',
        },
      ],
    })

    renderSkillDetailPage()

    expect(
      await screen.findByDisplayValue(
        'Generate consistent character illustrations from a short prompt.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('<!-- dify-skill-empty-draft -->')).not.toBeInTheDocument()
  })

  it('treats a newly created empty Skill draft as Builder creation mode', async () => {
    mocks.skillDetail = createDefaultSkillDraftDetail({
      description: '',
      files: [
        {
          id: 'file-1',
          path: 'SKILL.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: '<!-- dify-skill-empty-draft -->\n',
          tool_file_id: null,
          size: 32,
          hash: 'hash-1',
        },
      ],
    })

    renderSkillDetailPage()

    expect(
      await screen.findByText('skill.skillManagement.detail.builder.promptTitle'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('skill.skillManagement.detail.builder.editIntro'),
    ).not.toBeInTheDocument()
  })

  it('moves the collapsed Skill Builder entry into the file tab header', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.close',
      }),
    )

    const openBuilderButton = screen.getByRole('button', {
      name: 'skill.skillManagement.detail.builder.open',
    })
    expect(openBuilderButton.closest('main')).toBeInTheDocument()

    await user.click(openBuilderButton)
    expect(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.close',
      }),
    ).toBeInTheDocument()
  })

  it('sends uploaded Skill Builder attachments without requiring typed text', async () => {
    const user = userEvent.setup()
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    expect(
      await screen.findByText('skill.skillManagement.detail.builder.editIntro'),
    ).toBeInTheDocument()
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()

    await user.upload(
      attachmentInput!,
      new File(['# Guide'], 'guide.md', {
        type: 'text/markdown',
      }),
    )
    expect(await screen.findByText('guide.md')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.send',
      }),
    )
    expect(await screen.findByText('guide.md')).toBeInTheDocument()
    expect(
      screen.queryByText('skill.skillManagement.detail.builder.editIntro'),
    ).not.toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.sendSkillAssistMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          skillId: 'skill-1',
          message: 'skill.skillManagement.detail.builder.attachmentOnlyMessage',
          attachments: [
            {
              mime_type: 'text/markdown',
              name: 'guide.md',
              size: 10,
              tool_file_id: 'tool-file-1',
            },
          ],
        }),
      )
    })
  })

  it('retries a Skill Builder attachment request with the original attachment', async () => {
    const user = userEvent.setup()
    mocks.sendSkillAssistMessage.mockImplementation(({ onCompleted, onData }) => {
      onData?.('Used the guide.', true, {})
      onCompleted?.()
      return Promise.resolve()
    })
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()
    await user.upload(
      attachmentInput!,
      new File(['# Guide'], 'guide.md', {
        type: 'text/markdown',
      }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.send',
      }),
    )
    await screen.findByText('Used the guide.')
    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.retryResponse',
      }),
    )

    await waitFor(() => expect(mocks.sendSkillAssistMessage).toHaveBeenCalledTimes(2))
    expect(mocks.sendSkillAssistMessage.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        attachments: [
          {
            mime_type: 'text/markdown',
            name: 'guide.md',
            size: 10,
            tool_file_id: 'tool-file-1',
          },
        ],
      }),
    )
  })

  it('removes uploaded Skill Builder attachments before sending', async () => {
    const user = userEvent.setup()
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()

    await user.upload(
      attachmentInput!,
      new File(['# Guide'], 'guide.md', {
        type: 'text/markdown',
      }),
    )
    expect(await screen.findByText('guide.md')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.removeAttachment:{"name":"guide.md"}',
      }),
    )

    expect(screen.queryByText('guide.md')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.send',
      }),
    ).toBeDisabled()
  })

  it('opens the Skill Builder attachment picker from the toolbar button', async () => {
    const user = userEvent.setup()
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()
    const clickSpy = vi.spyOn(attachmentInput!, 'click')

    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.attach',
      }),
    )

    expect(clickSpy).toHaveBeenCalledOnce()
  })

  it('does not send the Skill Builder prompt while an attachment is uploading', async () => {
    const user = userEvent.setup()
    mocks.uploadSkillFile.mockImplementation(() => new Promise(() => undefined))
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()

    await user.upload(
      attachmentInput!,
      new File(['# Guide'], 'guide.md', {
        type: 'text/markdown',
      }),
    )
    await waitFor(() => {
      expect(mocks.uploadSkillFile).toHaveBeenCalledOnce()
    })

    const promptInput = screen.getByPlaceholderText(
      'skill.skillManagement.detail.builder.modifyPlaceholder',
    )
    await user.type(promptInput, 'Use the attached guide{Enter}')

    expect(mocks.sendSkillAssistMessage).not.toHaveBeenCalled()
    expect(promptInput).toHaveValue('Use the attached guide')
  }, 10000)

  it('ignores an in-flight attachment after restarting Skill Builder', async () => {
    const user = userEvent.setup()
    let resolveUpload!: (file: {
      id: string
      mime_type: string
      name: string
      size: number
    }) => void
    mocks.uploadSkillFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve
        }),
    )
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()
    await user.upload(
      attachmentInput!,
      new File(['# Guide'], 'guide.md', {
        type: 'text/markdown',
      }),
    )
    await waitFor(() => expect(mocks.uploadSkillFile).toHaveBeenCalledOnce())
    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.restart',
      }),
    )
    expect(attachmentInput).toHaveValue('')

    await act(async () => {
      resolveUpload({
        id: 'tool-file-1',
        mime_type: 'text/markdown',
        name: 'guide.md',
        size: 10,
      })
    })
    expect(screen.queryByText('guide.md')).not.toBeInTheDocument()
  })

  it('disables Skill Builder suggestions while an attachment is uploading', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    mocks.uploadSkillFile.mockImplementation(() => new Promise(() => undefined))
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()

    await user.upload(
      attachmentInput!,
      new File(['# Guide'], 'guide.md', {
        type: 'text/markdown',
      }),
    )
    await waitFor(() => {
      expect(mocks.uploadSkillFile).toHaveBeenCalledOnce()
    })

    const suggestion = screen.getByRole('button', {
      name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
    })
    expect(suggestion).toBeDisabled()

    await user.click(suggestion)
    expect(mocks.sendSkillAssistMessage).not.toHaveBeenCalled()
  })

  it('does not send the Skill Builder prompt when Enter confirms IME composition', async () => {
    renderSkillDetailPage()

    const promptInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.builder.modifyPlaceholder',
    )
    fireEvent.change(promptInput, { target: { value: 'ni' } })
    fireEvent.compositionStart(promptInput)
    fireEvent.keyDown(promptInput, { isComposing: true, key: 'Enter' })

    expect(mocks.sendSkillAssistMessage).not.toHaveBeenCalled()
    expect(promptInput).toHaveValue('ni')
  })

  it('keeps blocking Skill Builder Enter briefly after IME composition ends', async () => {
    renderSkillDetailPage()

    const promptInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.builder.modifyPlaceholder',
    )
    vi.useFakeTimers()
    try {
      fireEvent.change(promptInput, { target: { value: '你好' } })
      fireEvent.compositionStart(promptInput)
      fireEvent.compositionEnd(promptInput)
      fireEvent.keyDown(promptInput, { isComposing: false, key: 'Enter' })

      expect(mocks.sendSkillAssistMessage).not.toHaveBeenCalled()
      expect(promptInput).toHaveValue('你好')

      act(() => {
        vi.advanceTimersByTime(50)
      })
      fireEvent.keyDown(promptInput, { isComposing: false, key: 'Enter' })

      expect(mocks.sendSkillAssistMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '你好',
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends the Skill Builder prompt with Enter when IME composition is inactive', async () => {
    renderSkillDetailPage()

    const promptInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.builder.modifyPlaceholder',
    )
    fireEvent.change(promptInput, { target: { value: 'Create a support triage skill' } })
    fireEvent.keyDown(promptInput, { isComposing: false, key: 'Enter' })

    expect(mocks.sendSkillAssistMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Create a support triage skill',
      }),
    )
  })

  it('blocks Skill Builder sends when no model is selected or available', async () => {
    const user = userEvent.setup()
    mocks.defaultTextGenerationModel = undefined
    mocks.textGenerationModelList = []
    mocks.skillDetail = createDefaultSkillDraftDetail()

    renderSkillDetailPage()

    const promptInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.builder.placeholder',
    )
    const sendButton = screen.getByRole('button', {
      name: 'skill.skillManagement.detail.builder.send',
    })
    const suggestion = screen.getByRole('button', {
      name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
    })

    expect(sendButton).toBeDisabled()
    expect(suggestion).toBeDisabled()

    await user.type(promptInput, 'Create a support triage skill{Enter}')

    expect(mocks.sendSkillAssistMessage).not.toHaveBeenCalled()
    expect(sendButton).toBeDisabled()
  }, 15000)

  it('uploads image attachments in Skill Builder', async () => {
    const user = userEvent.setup({ applyAccept: false })
    mocks.uploadSkillFile.mockResolvedValue({
      id: 'tool-image-1',
      name: 'image.png',
      mime_type: 'image/png',
      size: 5,
    })
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()

    await user.upload(
      attachmentInput!,
      new File(['image'], 'image.png', {
        type: 'image/png',
      }),
    )

    expect(mocks.uploadSkillFile).toHaveBeenCalledWith(expect.any(File))
    expect(mocks.toastError).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.send',
      }),
    )
    expect(await screen.findByRole('img', { name: 'image.png' })).toBeInTheDocument()
  })

  it('shows an error and re-enables Skill Builder input when sending fails', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    mocks.sendSkillAssistMessage.mockRejectedValue(new Error('builder unavailable'))

    renderSkillDetailPage()

    const promptInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.builder.placeholder',
    )
    await user.type(promptInput, 'Create a support triage skill{Enter}')

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('builder unavailable')
    })
    expect(
      screen.getByPlaceholderText('skill.skillManagement.detail.builder.modifyPlaceholder'),
    ).toBeEnabled()
  }, 15000)

  it('shows Skill Builder completion errors returned by the assistant stream', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    mocks.sendSkillAssistMessage.mockImplementation(({ onCompleted }) => {
      onCompleted?.(true, 'builder stream failed')
      return Promise.resolve()
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('builder stream failed')
    })
    expect(
      screen.getByPlaceholderText('skill.skillManagement.detail.builder.modifyPlaceholder'),
    ).toBeEnabled()
  })

  it('replaces optimistic Skill Builder replies when the assistant stream returns an error', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    mocks.sendSkillAssistMessage.mockImplementation(({ onData, onError }) => {
      onData?.('已创建用于客户问题分级处理的 skill 草案', true, {
        messageId: 'assistant-message',
      })
      onError?.(
        'the Skill Authoring assistant could not apply its response',
        'skill_assistant_failed',
      )
      return Promise.resolve()
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        'the Skill Authoring assistant could not apply its response',
      )
    })
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(
      screen.getByText('the Skill Authoring assistant could not apply its response'),
    ).toBeInTheDocument()
    expect(screen.queryByText('已创建用于客户问题分级处理的 skill 草案')).not.toBeInTheDocument()
  })

  it('sends suggestion chips as Builder messages and blocks concurrent sends', async () => {
    const user = userEvent.setup()
    mocks.sendSkillAssistMessage.mockImplementation(() => new Promise<void>(() => undefined))
    mocks.skillDetail = createDefaultSkillDraftDetail()

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )

    await waitFor(() => {
      expect(mocks.sendSkillAssistMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'skill.skillManagement.detail.builder.exampleIssueTriage',
        }),
      )
    })
    expect(
      await screen.findByText('skill.skillManagement.detail.builder.thinking'),
    ).toBeInTheDocument()
    expect(screen.getByText('0s')).toBeInTheDocument()
    expect(
      await screen.findByPlaceholderText('skill.skillManagement.detail.builder.modifyPlaceholder'),
    ).toBeDisabled()

    expect(mocks.sendSkillAssistMessage).toHaveBeenCalledTimes(1)
  })

  it('updates the selected editor from the Skill Builder detail event', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    const nextSkillMd =
      '---\nname: builder-updated-skill\ndescription: Updated by Skill Builder.\nmetadata:\n  display-name: Builder Updated Skill\n---\n# Builder Updated Skill\n'
    const nextDetail = createDefaultSkillDraftDetail({
      name: 'builder-updated-skill',
      display_name: 'Builder Updated Skill',
      description: 'Updated by Skill Builder.',
      updated_at: 1784638490,
      files: [
        {
          id: 'file-1',
          path: 'SKILL.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: nextSkillMd,
          tool_file_id: null,
          size: nextSkillMd.length,
          hash: 'updated-hash-1',
        },
      ],
    })
    mocks.sendSkillAssistMessage.mockImplementation(({ onCompleted, onData, onUnhandledEvent }) => {
      onData?.('Updated SKILL.md.', true, {})
      onUnhandledEvent?.({
        event: 'skill_detail_updated',
        detail: nextDetail,
        operations: [{ operation: 'upsert_text', path: 'SKILL.md' }],
      })
      onCompleted?.()
      return Promise.resolve()
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )

    await waitFor(() => {
      expect(mocks.sendSkillAssistMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          targetPath: 'SKILL.md',
        }),
      )
    })
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
    await waitFor(() => {
      const currentSourceEditor = screen
        .getAllByRole('textbox')
        .find(
          (editor): editor is HTMLTextAreaElement =>
            editor instanceof HTMLTextAreaElement && editor.value.includes('Builder Updated Skill'),
        )
      expect(currentSourceEditor?.value).toContain('# Builder Updated Skill')
    })
  })

  it('keeps assistant prose in the chat without using it as file content', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    mocks.sendSkillAssistMessage.mockImplementation(({ onCompleted, onData }) => {
      onData?.('I can create that reference file.', true, {})
      onCompleted?.()
      return Promise.resolve()
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )

    expect(await screen.findByText('I can create that reference file.')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: /skill\.skillManagement\.detail\.builder\.thinking/,
      }),
    )
    expect(
      screen.getByText('skill.skillManagement.detail.builder.thinkingUnavailable'),
    ).toBeInTheDocument()
    expect(screen.getByText('0s')).toBeInTheDocument()
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('sends Skill Builder follow-up suggestions after an assistant reply', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    mocks.sendSkillAssistMessage.mockImplementation(({ onCompleted, onData, onUnhandledEvent }) => {
      onUnhandledEvent?.({
        event: 'skill_assistant_progress',
        stage: 'reading_draft',
      })
      onUnhandledEvent?.({
        event: 'skill_assistant_reasoning_chunk',
        reasoning: 'Inspecting the current skill draft.',
      })
      onData?.('Drafted the skill.', true, {})
      onUnhandledEvent?.({
        event: 'skill_assistant_suggestions',
        suggestions: ['Ask me about required inputs first'],
      })
      onCompleted?.()
      return Promise.resolve()
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )
    await screen.findByText('Drafted the skill.')
    expect(screen.queryByText('Inspecting the current skill draft.')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: /skill\.skillManagement\.detail\.builder\.thinking/,
      }),
    )
    expect(screen.getByText('Inspecting the current skill draft.')).toBeInTheDocument()
    expect(
      screen.queryByText('skill.skillManagement.detail.builder.progress.readingDraft'),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'Ask me about required inputs first',
      }),
    )

    await waitFor(() => {
      expect(mocks.sendSkillAssistMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Ask me about required inputs first',
        }),
      )
    })
  })

  it('shows Skill Builder progress steps when thinking content is unavailable', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    mocks.sendSkillAssistMessage.mockImplementation(({ onCompleted, onData, onUnhandledEvent }) => {
      onUnhandledEvent?.({
        event: 'skill_assistant_progress',
        stage: 'reading_draft',
      })
      onUnhandledEvent?.({
        event: 'skill_assistant_progress',
        stage: 'generating_plan',
      })
      onData?.('Drafted the skill.', true, {})
      onCompleted?.()
      return Promise.resolve()
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )
    await screen.findByText('Drafted the skill.')
    await user.click(
      screen.getByRole('button', {
        name: /skill\.skillManagement\.detail\.builder\.thinking/,
      }),
    )

    expect(
      screen.getByText('skill.skillManagement.detail.builder.progress.readingDraft'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('skill.skillManagement.detail.builder.progress.generatingPlan'),
    ).toBeInTheDocument()
  })

  it('serializes editor autosave and file creation with the latest timestamp', async () => {
    const user = userEvent.setup()
    let resolveAutosave!: (detail: SkillDetailResponse) => void
    const autosavePromise = new Promise<SkillDetailResponse>((resolve) => {
      resolveAutosave = resolve
    })
    const autosavedDetail = createSkillDetail({
      updated_at: 1784638490,
    })
    const createdDetail = createSkillDetail({
      updated_at: 1784638491,
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'notes.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: '',
          tool_file_id: null,
          size: 0,
          hash: 'hash-2',
        },
      ],
    })
    mocks.saveDraftFileMutationFn
      .mockImplementationOnce(() => autosavePromise)
      .mockResolvedValueOnce(createdDetail)
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    await user.type(getSourceEditor(), '\nAutosave in progress')
    await waitFor(
      () => {
        expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(1)
      },
      { timeout: 2500 },
    )

    await openRootCreateMenu(user)
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    await user.type(
      await screen.findByPlaceholderText('skill.skillManagement.detail.createFile'),
      'notes.md{Enter}',
    )

    expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveAutosave(autosavedDetail)
      await autosavePromise
    })

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(2)
    })
    expect(mocks.saveDraftFileMutationFn.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({
          expected_updated_at: 1784638490,
          operation: 'upsert_text',
          path: 'notes.md',
        }),
      }),
    )
  })

  it('updates non-SKILL files from the Skill Builder detail event', async () => {
    const user = userEvent.setup()
    const referenceFile = {
      id: 'file-2',
      path: 'references/refund-policy.md',
      kind: 'file' as const,
      storage: 'text' as const,
      mime_type: 'text/markdown',
      content: '# Refund Policy\n',
      tool_file_id: null,
      size: 16,
      hash: 'reference-hash-1',
    }
    mocks.skillDetail = createDefaultSkillDraftDetail()
    const nextDetail = createDefaultSkillDraftDetail({
      updated_at: 1784638490,
      files: [...createDefaultSkillDraftDetail().files!, referenceFile],
    })
    mocks.sendSkillAssistMessage.mockImplementation(({ onCompleted, onData, onUnhandledEvent }) => {
      onData?.('Created references/refund-policy.md.', true, {})
      onUnhandledEvent?.({
        event: 'skill_detail_updated',
        detail: nextDetail,
        operations: [{ operation: 'upsert_text', path: 'references/refund-policy.md' }],
      })
      onCompleted?.()
      return Promise.resolve()
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )

    expect(await screen.findByText('references')).toBeInTheDocument()
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })
})
