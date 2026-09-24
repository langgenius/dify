import type { Source } from '@/features/new-rag/sources/source-models'
import { Tabs } from '@langgenius/dify-ui/tabs'
import { act, render, screen } from '@testing-library/react'
import { ScopeProvider } from 'jotai-scope'
import { Suspense } from 'react'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import { RetrievalModeSegmentedControl } from '@/features/new-rag/components/retrieval-mode-segmented-control'
import { QualityTabList } from '@/features/new-rag/quality/quality-tab-list'
import { SourceRow } from '@/features/new-rag/sources/source-list-item'
import { sourcesKnowledgeSpaceIdAtom } from '@/features/new-rag/sources/state'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { changeLanguage } from '../client'
import errors from '../locales/en-US/knowledge-errors.json'
import quality from '../locales/en-US/knowledge-quality.json'
import shared from '../locales/en-US/knowledge-space.json'
import chineseErrors from '../locales/zh-Hans/knowledge-errors.json'

vi.unmock('react-i18next')
const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../load-resource', () => ({ loadI18nResource: mocks.load }))
vi.mock('@/features/new-rag/space/context', () => ({ useKnowledgeSpacePermission: () => false }))

beforeEach(async () => {
  const { loadI18nResource } =
    await vi.importActual<typeof import('../load-resource')>('../load-resource')
  mocks.load.mockReset().mockImplementation(loadI18nResource)
})

it('loads shared retrieval controls without settings, then loads quality copy when its tab mounts', async () => {
  const content = (showQuality: boolean) => (
    <I18nClientProvider locale="en-US" resource={{}}>
      <Suspense fallback={<span>Loading</span>}>
        <RetrievalModeSegmentedControl
          aria-label="Retrieval mode"
          value="fast"
          onChange={() => {}}
        />
        {showQuality && (
          <Tabs defaultValue="golden">
            <QualityTabList />
          </Tabs>
        )}
      </Suspense>
    </I18nClientProvider>
  )
  const view = render(content(false))
  expect(
    await screen.findByRole('radio', { name: shared['settings.retrievalMode.fast'] }),
  ).toBeVisible()
  expect(mocks.load.mock.calls.map(([, ns]) => ns)).toEqual(['knowledgeSpace'])
  mocks.load.mockClear()
  view.rerender(content(true))
  expect(await screen.findByRole('tab', { name: quality['qualityPage.goldenTab'] })).toBeVisible()
  expect(mocks.load.mock.calls.map(([, ns]) => ns)).toEqual(['knowledgeQuality'])
})

it('loads source failure explanations only for a failing row and translates them after a locale change', async () => {
  const source: Source = {
    createdAt: '2026-07-20T10:00:00Z',
    id: 'source-1',
    knowledgeSpaceId: 'space-1',
    metadata: {},
    name: 'Product documentation',
    status: 'active',
    type: 'web',
    updatedAt: '2026-07-20T10:00:00Z',
    uri: 'https://docs.example.com',
  }
  const content = (value: Source) => (
    <I18nClientProvider locale="en-US" resource={{}}>
      <Suspense fallback={<span>Loading</span>}>
        <ScopeProvider atoms={[[sourcesKnowledgeSpaceIdAtom, value.knowledgeSpaceId]]}>
          <table>
            <tbody>
              <SourceRow
                source={value}
                checked={false}
                onCheckedChange={() => {}}
                ensureModelSetupReady={async () => true}
              />
            </tbody>
          </table>
        </ScopeProvider>
      </Suspense>
    </I18nClientProvider>
  )
  const view = renderWithConsoleQuery(content(source))
  expect(await screen.findByRole('checkbox', { name: source.name })).toBeVisible()
  expect(new Set(mocks.load.mock.calls.map(([, ns]) => ns))).toEqual(
    new Set(['knowledgeSpace', 'knowledgeSources', 'dataset', 'common']),
  )
  mocks.load.mockClear()
  view.rerender(
    content({
      ...source,
      status: 'error',
      syncWorkflow: {
        checkpoint: 'sync',
        createdAt: source.createdAt,
        executionAttempts: 1,
        id: 'task-1',
        kind: 'sync',
        knowledgeSpaceId: source.knowledgeSpaceId,
        lastErrorCode: 'SOURCE_CREDENTIAL_UNAVAILABLE',
        maxExecutionAttempts: 3,
        progressCompleted: 0,
        progressFailed: 1,
        progressSkipped: 0,
        state: 'failed',
        updatedAt: source.updatedAt,
      },
    }),
  )
  expect(
    await screen.findByRole('button', { name: errors['taskFailure.sourceCredential'] }),
  ).toBeVisible()
  expect(mocks.load.mock.calls.map(([, ns]) => ns)).toEqual(['knowledgeErrors'])
  mocks.load.mockClear()
  await act(() => changeLanguage('zh-Hans'))
  expect(
    await screen.findByRole('button', { name: chineseErrors['taskFailure.sourceCredential'] }),
  ).toBeVisible()
  expect(mocks.load.mock.calls.every(([locale]) => locale === 'zh-Hans')).toBe(true)
  expect(mocks.load.mock.calls.map(([, ns]) => ns)).not.toContain('knowledgeQuality')
})
