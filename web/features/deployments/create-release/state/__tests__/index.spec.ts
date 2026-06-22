import type { CreateReleaseFormValues } from '../index'
import { createStore } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import {
  closeCreateReleaseDialogAtom,
  createReleaseDescriptionFieldAtom,
  createReleaseDialogOpenAtom,
  createReleaseDslFileFieldAtom,
  createReleaseDslStateAtom,
  createReleaseFormValuesAtom,
  createReleaseNameFieldAtom,
  createReleaseSourceAppFieldAtom,
  createReleaseSourceModeFieldAtom,
  createReleaseSubmitUnsupportedDslNodesAtom,
  openCreateReleaseDialogAtom,
  RELEASE_NAME_REQUIRED_ERROR,
  selectCreateReleaseSourceModeAtom,
  submitCreateReleaseFormAtom,
  updateCreateReleaseDslFileAtom,
  updateCreateReleaseSourceAppAtom,
} from '../index'

function mountedStore() {
  const store = createStore()
  const unsubscribe = store.sub(createReleaseFormValuesAtom, () => undefined)

  return {
    store,
    unsubscribe,
  }
}

function sourceApp(overrides: Partial<NonNullable<CreateReleaseFormValues['sourceApp']>> = {}): NonNullable<CreateReleaseFormValues['sourceApp']> {
  return {
    id: 'source-app-1',
    name: 'Source App',
    ...overrides,
  }
}

function validationIssueMessage(error: unknown) {
  if (!error || typeof error !== 'object' || !('message' in error))
    return undefined

  return typeof error.message === 'string' ? error.message : undefined
}

function hasValidationIssue(errors: unknown[], message: string) {
  return errors.some(error => validationIssueMessage(error) === message)
}

function workflowDsl() {
  return [
    'app:',
    '  mode: workflow',
    '  name: Release source',
  ].join('\n')
}

describe('create release state', () => {
  it('should keep default form values before editing', () => {
    const { store, unsubscribe } = mountedStore()

    expect(store.get(createReleaseFormValuesAtom)).toEqual({
      dslFile: undefined,
      releaseDescription: '',
      releaseName: '',
      releaseSourceMode: 'sourceApp',
      sourceApp: undefined,
    })

    unsubscribe()
  })

  it('should validate release name only when submitting', async () => {
    const { store, unsubscribe } = mountedStore()
    const createRelease = vi.fn((_: CreateReleaseFormValues) => undefined)

    await store.set(submitCreateReleaseFormAtom, createRelease)

    expect(createRelease).not.toHaveBeenCalled()
    expect(hasValidationIssue(
      store.get(createReleaseNameFieldAtom).meta?.errors ?? [],
      RELEASE_NAME_REQUIRED_ERROR,
    )).toBe(true)

    unsubscribe()
  })

  it('should submit current form values when the release name is valid', async () => {
    const { store, unsubscribe } = mountedStore()
    const createRelease = vi.fn((_: CreateReleaseFormValues) => undefined)

    store.set(createReleaseNameFieldAtom, 'Release 1')
    store.set(createReleaseDescriptionFieldAtom, 'Initial rollout')

    await store.set(submitCreateReleaseFormAtom, createRelease)

    expect(createRelease).toHaveBeenCalledTimes(1)
    expect(createRelease).toHaveBeenCalledWith({
      dslFile: undefined,
      releaseDescription: 'Initial rollout',
      releaseName: 'Release 1',
      releaseSourceMode: 'sourceApp',
      sourceApp: undefined,
    })

    unsubscribe()
  })

  it('should clear source app and derive workflow DSL state when selecting a DSL file', async () => {
    const { store, unsubscribe } = mountedStore()
    const file = new File([workflowDsl()], 'workflow.yml', { type: 'text/yaml' })

    store.set(updateCreateReleaseSourceAppAtom, sourceApp())
    store.set(selectCreateReleaseSourceModeAtom, 'dsl')
    await store.set(updateCreateReleaseDslFileAtom, file)

    const dslState = store.get(createReleaseDslStateAtom)
    expect(store.get(createReleaseSourceModeFieldAtom).value).toBe('dsl')
    expect(store.get(createReleaseSourceAppFieldAtom).value).toBeUndefined()
    expect(store.get(createReleaseDslFileFieldAtom).value).toBe(file)
    expect(dslState.dslContent).toBe(workflowDsl())
    expect(dslState.hasDslContent).toBe(true)
    expect(dslState.isReadingDsl).toBe(false)
    expect(dslState.isWorkflowDslContent).toBe(true)
    expect(dslState.encodedDslContent).not.toBe('')

    unsubscribe()
  })

  it('should reset DSL state when switching back to source app mode', async () => {
    const { store, unsubscribe } = mountedStore()
    const file = new File([workflowDsl()], 'workflow.yml', { type: 'text/yaml' })

    store.set(selectCreateReleaseSourceModeAtom, 'dsl')
    await store.set(updateCreateReleaseDslFileAtom, file)
    store.set(selectCreateReleaseSourceModeAtom, 'sourceApp')

    expect(store.get(createReleaseSourceModeFieldAtom).value).toBe('sourceApp')
    expect(store.get(createReleaseDslFileFieldAtom).value).toBeUndefined()
    expect(store.get(createReleaseDslStateAtom)).toEqual({
      dslContent: '',
      dslReadError: false,
      encodedDslContent: '',
      hasDslContent: false,
      isReadingDsl: false,
      isWorkflowDslContent: false,
    })

    unsubscribe()
  })

  it('should capture DSL file read failures and clear them when opening or closing the dialog', async () => {
    const { store, unsubscribe } = mountedStore()
    const file = new File(['broken'], 'broken.yml', { type: 'text/yaml' })
    const readError = new Error('read failed')
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: vi.fn().mockRejectedValue(readError),
    })

    await store.set(updateCreateReleaseDslFileAtom, file)

    expect(store.get(createReleaseDslStateAtom).dslReadError).toBe(true)
    expect(store.get(createReleaseSubmitUnsupportedDslNodesAtom)).toEqual([])

    store.set(createReleaseSubmitUnsupportedDslNodesAtom, [{ id: 'node-1' }])
    store.set(openCreateReleaseDialogAtom)
    expect(store.get(createReleaseDialogOpenAtom)).toBe(true)
    expect(store.get(createReleaseDslStateAtom).dslReadError).toBe(false)
    expect(store.get(createReleaseSubmitUnsupportedDslNodesAtom)).toEqual([])

    store.set(createReleaseSubmitUnsupportedDslNodesAtom, [{ type: 'unsupported' }])
    store.set(closeCreateReleaseDialogAtom)
    expect(store.get(createReleaseDialogOpenAtom)).toBe(false)
    expect(store.get(createReleaseSubmitUnsupportedDslNodesAtom)).toEqual([])

    unsubscribe()
  })
})
