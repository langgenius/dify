import type { AgentSkillDetail } from '../detail-dialog'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { codeToTokens, isSupportedLanguage } from '@pierre/highlights'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestQueryClient } from '@/test/query-client'
import { AgentSkillDetailDialog } from '../detail-dialog'

// Spy on the real highlighter so tests can assert which files reach the lexers.
vi.mock('@pierre/highlights', { spy: true })

const mockCodeToTokens = vi.mocked(codeToTokens)
const mockIsSupportedLanguage = vi.mocked(isSupportedLanguage)

const highlighterQueryKey = ['agent-v2', 'file-highlighter']

const renderPreview = (
  filePreview: AgentSkillDetail['filePreview'],
  queryClient = createTestQueryClient(),
) =>
  render(
    <QueryClientTestProvider queryClient={queryClient}>
      <Dialog open>
        <AgentSkillDetailDialog
          skillName="demo"
          detail={{ description: 'Demo files', files: [], filePreview, sections: [] }}
        />
      </Dialog>
    </QueryClientTestProvider>,
  )

const getLineCode = (text: string) =>
  screen.getByText((_, element) => element?.tagName === 'CODE' && element.textContent === text)

const waitForHighlighted = (text: string) =>
  waitFor(() => expect(getLineCode(text).children.length).toBeGreaterThan(0), { timeout: 5000 })

describe('AgentSkillDetailDialog file preview', () => {
  beforeEach(() => {
    mockCodeToTokens.mockClear()
    mockIsSupportedLanguage.mockClear()
  })

  it('should color tokens for both themes', async () => {
    renderPreview({ content: 'const a = 1\n\nexport { a }', fileName: 'run.ts' })

    await waitForHighlighted('const a = 1')
    const token = getLineCode('const a = 1').querySelector('span')
    expect(token?.style.getPropertyValue('--hls-light')).not.toBe('')
    expect(token?.style.getPropertyValue('--hls-dark')).not.toBe('')
    expect(getLineCode('export { a }').children.length).toBeGreaterThan(0)
  })

  it.each([
    ['SKILL.md', 'md', '# Skill\n\nUse the tool.', '# Skill'],
    ['Dockerfile', 'dockerfile', 'FROM node:22\nRUN pnpm install', 'FROM node:22'],
    ['run.ts', 'ts', 'const a = 1\r\nconst b = 2', 'const b = 2'],
  ])('should highlight %s without changing line text', async (fileName, lang, content, line) => {
    renderPreview({ content, fileName })

    await waitForHighlighted(line)
    expect(mockCodeToTokens.mock.calls[0]![1]).toMatchObject({ lang })
  })

  it('should keep the full text of lines past the token limit', async () => {
    const longLine = `const a = '${'x'.repeat(1200)}'`
    renderPreview({ content: `const b = 1\n${longLine}`, fileName: 'run.ts' })

    await waitForHighlighted('const b = 1')
    expect(getLineCode(longLine)).toBeInTheDocument()
  })

  it('should render plain text files without loading the highlighter', () => {
    const queryClient = createTestQueryClient()
    renderPreview({ content: 'first line\nsecond line', fileName: 'notes.txt' }, queryClient)

    expect(getLineCode('first line').children).toHaveLength(0)
    expect(getLineCode('second line').children).toHaveLength(0)
    expect(queryClient.getQueryState(highlighterQueryKey)).toMatchObject({ fetchStatus: 'idle' })
    expect(mockIsSupportedLanguage).not.toHaveBeenCalled()
  })

  it('should render unsupported languages as plain text', async () => {
    renderPreview({ content: 'first line', fileName: 'notes.unknown-language' })

    await waitFor(() => expect(mockIsSupportedLanguage).toHaveBeenCalledWith('unknown-language'), {
      timeout: 5000,
    })
    expect(getLineCode('first line').children).toHaveLength(0)
    expect(mockCodeToTokens).not.toHaveBeenCalled()
  })

  it('should fall back to plain text when tokenizing fails', async () => {
    mockCodeToTokens.mockImplementationOnce(() => {
      throw new RangeError('lexer failed')
    })
    renderPreview({ content: 'const a = 1', fileName: 'run.ts' })

    await waitFor(() => expect(mockCodeToTokens).toHaveBeenCalled(), { timeout: 5000 })
    expect(getLineCode('const a = 1').children).toHaveLength(0)
  })
})
