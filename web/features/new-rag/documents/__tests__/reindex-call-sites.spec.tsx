import type { DocumentDisplayStatus } from '../model'
import type { LogicalDocument } from '../models'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { DocumentActionsMenu } from '../actions-menu'
import { DocumentBulkActionsToolbar } from '../bulk/toolbar'

// The documents page derives all of this from its queries; here each fact is set directly.
const state = await vi.hoisted(async () => {
  const { atom } = await import('jotai')
  return {
    statuses: new Map<string, DocumentDisplayStatus>(),
    selectedIds: atom(new Set(['a', 'b'])),
    resultsUnavailable: atom(false),
    reindexDisabled: atom(false),
    on: atom(true),
    off: atom(false),
    none: atom(undefined),
    noIds: atom<string[]>([]),
    write: atom(null, () => {}),
  }
})
const actions = vi.hoisted(() => ({
  reindexDocument: vi.fn(async () => true),
  useReindexDocumentAction: vi.fn(),
  reindexSelection: vi.fn(async () => {}),
}))
vi.mock('../state/results', async () => {
  const { atom } = await import('jotai')
  return {
    createDocumentRowActionFactsAtom: (documentId: string) =>
      atom({
        documentSnapshotPending: false,
        status: state.statuses.get(documentId) ?? 'ready',
        task: undefined,
      }),
    createDocumentRowCanEditAtom: () => state.on,
    reindexUnavailabilityAtom: state.none,
  }
})
vi.mock('../state/runtime', () => ({
  documentCanDownloadAtom: state.on,
  documentCanWriteAtom: state.on,
}))
vi.mock('../state/selection', () => ({
  MAX_SELECTED_DOCUMENTS: 100,
  clearDocumentSelectionAtom: state.write,
  documentSelectionLimitExceededAtom: state.off,
  downloadableDocumentIdsAtom: state.noIds,
  selectedDocumentResultsUnavailableAtom: state.resultsUnavailable,
  selectionAvailabilityActionVisibleAtom: state.off,
  selectionAvailabilityDisabledAtom: state.off,
  selectionAvailabilityTargetEnabledAtom: state.off,
  selectionReindexDisabledAtom: state.reindexDisabled,
  validSelectedDocumentIdsAtom: state.selectedIds,
}))
vi.mock('../row-actions/use-document-row-actions', () => {
  const idle = () => ({ busy: false, pending: false, run: vi.fn() })
  return {
    useDocumentRowPendingAction: () => undefined,
    useDownloadDocumentAction: idle,
    useReindexDocumentAction: actions.useReindexDocumentAction,
    useRenameDocumentAction: idle,
    useRetryDocumentTaskAction: idle,
    useToggleDocumentAvailabilityAction: idle,
  }
})
vi.mock('../bulk/use-bulk-actions', () => {
  const idle = () => ({ busy: false, pending: false, run: vi.fn() })
  return {
    useBulkAvailabilityAction: idle,
    useBulkDownloadAction: idle,
    useBulkReindexAction: () => ({ busy: false, pending: false, run: actions.reindexSelection }),
    useBulkRemoveAction: idle,
  }
})

const row = (id: string, title: string): LogicalDocument => ({
  active: null,
  createdAt: '2026-07-20T10:00:00Z',
  enabled: true,
  id,
  knowledgeSpaceId: 'space-1',
  rowVersion: 1,
  status: 'ready',
  title,
  updatedAt: '2026-07-20T10:01:00Z',
  userMetadata: {},
})
const confirmButton = { name: 'knowledgeDocuments.reindexDocument' }

beforeEach(() => {
  state.statuses.clear()
  actions.reindexDocument.mockClear()
  actions.reindexSelection.mockClear()
  actions.useReindexDocumentAction.mockReset()
  actions.useReindexDocumentAction.mockReturnValue({
    busy: false,
    pending: false,
    run: actions.reindexDocument,
  })
})

describe('reindex from a document row', () => {
  const openMenu = (user: ReturnType<typeof userEvent.setup>, title: string) =>
    user.click(screen.getByRole('button', { name: new RegExp(`documentActions.*${title}`) }))

  it('gives a row its confirmation, and the action behind it, only once a reindex is asked for', async () => {
    state.statuses.set('c', 'failed')
    const user = userEvent.setup()
    render(
      <Provider store={createStore()}>
        <DocumentActionsMenu document={row('a', 'Alpha')} onRemove={vi.fn()} />
        <DocumentActionsMenu document={row('b', 'Beta')} onRemove={vi.fn()} />
        <DocumentActionsMenu document={row('c', 'Gamma')} onRemove={vi.fn()} />
      </Provider>,
    )
    expect(actions.useReindexDocumentAction).not.toHaveBeenCalled()

    // A failed row offers a retry instead, and opening its menu creates nothing either.
    await openMenu(user, 'Gamma')
    expect(await screen.findByRole('menuitem', { name: 'knowledgeSpace.retryTask' })).toBeVisible()
    expect(screen.queryByRole('menuitem', confirmButton)).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await openMenu(user, 'Alpha')
    const reindex = await screen.findByRole('menuitem', confirmButton)
    expect(actions.useReindexDocumentAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(reindex)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('knowledgeDocuments.reindexConfirmTitle')
    expect(actions.useReindexDocumentAction).toHaveBeenCalled()
    expect(
      new Set(actions.useReindexDocumentAction.mock.calls.map(([document]) => document.id)),
    ).toEqual(new Set(['a']))
    // The menu is closed by now; the confirmation runs the reindex without it.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', confirmButton))
    expect(actions.reindexDocument).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('asks again for every further reindex of the same row', async () => {
    const user = userEvent.setup()
    render(
      <Provider store={createStore()}>
        <DocumentActionsMenu document={row('a', 'Alpha')} onRemove={vi.fn()} />
      </Provider>,
    )
    for (const expectedRuns of [1, 2]) {
      await openMenu(user, 'Alpha')
      await user.click(await screen.findByRole('menuitem', confirmButton))
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', confirmButton))
      expect(actions.reindexDocument).toHaveBeenCalledTimes(expectedRuns)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  })

  it('withdraws the question when the row can no longer be reindexed', async () => {
    const user = userEvent.setup()
    const store = createStore()
    const view = render(
      <Provider store={store}>
        <DocumentActionsMenu document={row('a', 'Alpha')} onRemove={vi.fn()} />
      </Provider>,
    )
    await openMenu(user, 'Alpha')
    await user.click(await screen.findByRole('menuitem', confirmButton))
    expect(await screen.findByRole('dialog')).toBeVisible()

    // Another action took the row while the dialog was open.
    actions.useReindexDocumentAction.mockReturnValue({
      busy: true,
      pending: false,
      run: actions.reindexDocument,
    })
    view.rerender(
      <Provider store={store}>
        <DocumentActionsMenu document={row('a', 'Alpha')} onRemove={vi.fn()} />
      </Provider>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(actions.reindexDocument).not.toHaveBeenCalled()
  })
})

describe('reindex of the selected documents', () => {
  const toolbarButton = { name: 'knowledgeSpace.reindexDocuments' }
  const renderToolbar = () => {
    const store = createStore()
    render(
      <Provider store={store}>
        <DocumentBulkActionsToolbar />
      </Provider>,
    )
    return store
  }

  it('names the selection and words the confirm button for several documents', async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole('button', toolbarButton))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('knowledgeSpace.documentsSelected:{"count":2}')
    expect(within(dialog).queryByRole('button', confirmButton)).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', toolbarButton))
    expect(actions.reindexSelection).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('withdraws the question when the selection can no longer be reindexed, for good', async () => {
    const user = userEvent.setup()
    const store = renderToolbar()
    await user.click(screen.getByRole('button', toolbarButton))
    expect(await screen.findByRole('dialog')).toBeVisible()

    // A selected document started processing behind the dialog.
    act(() => store.set(state.reindexDisabled, true))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', toolbarButton)).toBeDisabled()
    // What was asked about is gone: the dialog does not return with the action.
    act(() => store.set(state.reindexDisabled, false))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(actions.reindexSelection).not.toHaveBeenCalled()
  })
})
