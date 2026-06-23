import { createStore } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import {
  atomWithForm,
  createFormAtoms,
} from './index'

type TestFormValues = {
  name: string
  count: number
}

function createTestFormAtom(onSubmit = vi.fn()) {
  const defaultValues: TestFormValues = {
    name: '',
    count: 0,
  }

  return atomWithForm({
    defaultValues,
    onSubmit: ({ value }) => {
      onSubmit(value)
    },
  })
}

function createSubmitValidatedFormAtom(onSubmit = vi.fn()) {
  const defaultValues: TestFormValues = {
    name: '',
    count: 0,
  }

  return atomWithForm({
    defaultValues,
    validators: {
      onSubmit: ({ value }) => {
        if (value.name.trim())
          return undefined

        return {
          fields: {
            name: 'required',
          },
        }
      },
    },
    onSubmit: ({ value }) => {
      onSubmit(value)
    },
  })
}

function createChangeAndSubmitValidatedFormAtom(onSubmit = vi.fn()) {
  const defaultValues: TestFormValues = {
    name: '',
    count: 0,
  }

  return atomWithForm({
    defaultValues,
    validators: {
      onChange: ({ value }) => {
        if (value.name !== 'blocked')
          return undefined

        return {
          fields: {
            name: 'blocked',
          },
        }
      },
      onSubmit: ({ value }) => {
        if (value.name.trim())
          return undefined

        return {
          fields: {
            name: 'required',
          },
        }
      },
    },
    onSubmit: ({ value }) => {
      onSubmit(value)
    },
  })
}

describe('jotai-tanstack-form', () => {
  it('syncs a TanStack form store into Jotai atoms', () => {
    const formAtom = createTestFormAtom()
    const formAtoms = createFormAtoms(formAtom)
    const store = createStore()
    const unsubscribe = store.sub(formAtoms.stateAtom, () => undefined)

    store.get(formAtom).api.setFieldValue('name', 'Ada')

    expect(store.get(formAtoms.stateAtom).values.name).toBe('Ada')

    unsubscribe()
  })

  it('creates scoped atoms for values, field updates, and submit', async () => {
    const onSubmit = vi.fn()
    const formAtoms = createFormAtoms(createTestFormAtom(onSubmit))
    const countFieldAtom = formAtoms.fieldAtom('count')
    const store = createStore()

    const unsubscribe = store.sub(formAtoms.valuesAtom, () => undefined)

    store.set(countFieldAtom, 3)
    await store.set(formAtoms.validateAtom, 'change')
    await store.set(formAtoms.submitAtom)

    expect(store.get(countFieldAtom)).toMatchObject({
      value: 3,
    })
    expect(store.get(formAtoms.valuesAtom)).toEqual({
      name: '',
      count: 3,
    })
    expect(onSubmit).toHaveBeenCalledWith({
      name: '',
      count: 3,
    })

    unsubscribe()
  })

  it('accepts FormApi options directly', async () => {
    const onSubmit = vi.fn()
    const formAtom = createTestFormAtom(onSubmit)
    const formAtoms = createFormAtoms(formAtom)
    const countFieldAtom = formAtoms.fieldAtom('count')
    const store = createStore()
    const unsubscribe = store.sub(formAtoms.valuesAtom, () => undefined)

    store.set(countFieldAtom, 5)
    await store.set(formAtoms.submitAtom)

    expect(store.get(formAtoms.valuesAtom)).toEqual({
      name: '',
      count: 5,
    })
    expect(onSubmit).toHaveBeenCalledWith({
      name: '',
      count: 5,
    })

    unsubscribe()
  })

  it('clears stale submit errors when a field atom updates the field value', async () => {
    const onSubmit = vi.fn()
    const formAtoms = createFormAtoms(createSubmitValidatedFormAtom(onSubmit))
    const nameFieldAtom = formAtoms.fieldAtom('name')
    const store = createStore()
    const unsubscribe = store.sub(formAtoms.stateAtom, () => undefined)

    await store.set(formAtoms.submitAtom)

    expect(store.get(nameFieldAtom).meta?.errors).toEqual(['required'])
    expect(onSubmit).not.toHaveBeenCalled()

    store.set(nameFieldAtom, 'Ada')
    await store.set(formAtoms.submitAtom)

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Ada',
      count: 0,
    })

    unsubscribe()
  })

  it('keeps stale submit errors when a field atom update has change errors', async () => {
    const onSubmit = vi.fn()
    const formAtoms = createFormAtoms(createChangeAndSubmitValidatedFormAtom(onSubmit))
    const nameFieldAtom = formAtoms.fieldAtom('name')
    const store = createStore()
    const unsubscribe = store.sub(formAtoms.stateAtom, () => undefined)

    await store.set(formAtoms.submitAtom)
    store.set(nameFieldAtom, 'blocked')

    expect(store.get(nameFieldAtom).meta?.errorMap).toMatchObject({
      onChange: 'blocked',
      onSubmit: 'required',
    })
    expect(onSubmit).not.toHaveBeenCalled()

    unsubscribe()
  })

  it('clears stale submit errors when a field atom update only has existing blur errors', async () => {
    const onSubmit = vi.fn()
    const formAtoms = createFormAtoms(createSubmitValidatedFormAtom(onSubmit))
    const nameFieldAtom = formAtoms.fieldAtom('name')
    const store = createStore()
    const unsubscribe = store.sub(formAtoms.stateAtom, () => undefined)

    await store.set(formAtoms.submitAtom)
    store.get(formAtoms.formAtom).api.setFieldMeta('name', prev => ({
      ...prev,
      errorMap: {
        ...prev.errorMap,
        onBlur: 'blurred',
      },
      errorSourceMap: {
        ...prev.errorSourceMap,
        onBlur: 'field',
      },
    }))

    expect(store.get(nameFieldAtom).meta?.errorMap).toMatchObject({
      onBlur: 'blurred',
      onSubmit: 'required',
    })

    store.set(nameFieldAtom, 'ready')

    expect(store.get(nameFieldAtom).meta?.errorMap).toMatchObject({
      onBlur: 'blurred',
      onSubmit: undefined,
    })
    expect(onSubmit).not.toHaveBeenCalled()

    unsubscribe()
  })

  it('keeps stale submit errors when dontUpdateMeta keeps a field untouched', async () => {
    const onSubmit = vi.fn()
    const formAtoms = createFormAtoms(createSubmitValidatedFormAtom(onSubmit))
    const nameFieldAtom = formAtoms.fieldAtom('name')
    const store = createStore()
    const unsubscribe = store.sub(formAtoms.stateAtom, () => undefined)

    await store.set(formAtoms.submitAtom)
    store.set(nameFieldAtom, 'Ada', { dontUpdateMeta: true })

    expect(store.get(nameFieldAtom).meta).toMatchObject({
      isTouched: false,
      errorMap: {
        onSubmit: 'required',
      },
    })
    expect(onSubmit).not.toHaveBeenCalled()

    unsubscribe()
  })

  it('clears stale submit errors with dontUpdateMeta when the field is already touched', async () => {
    const onSubmit = vi.fn()
    const formAtoms = createFormAtoms(createSubmitValidatedFormAtom(onSubmit))
    const nameFieldAtom = formAtoms.fieldAtom('name')
    const store = createStore()
    const unsubscribe = store.sub(formAtoms.stateAtom, () => undefined)

    store.set(nameFieldAtom, '')
    await store.set(formAtoms.submitAtom)
    store.set(nameFieldAtom, 'Ada', { dontUpdateMeta: true })

    expect(store.get(nameFieldAtom).meta).toMatchObject({
      isTouched: true,
      errorMap: {
        onSubmit: undefined,
      },
    })

    unsubscribe()
  })

  it('creates and mounts form instances from atom lifecycle', () => {
    const cleanup = vi.fn()
    const formAtom = createTestFormAtom()
    const formAtoms = createFormAtoms(formAtom)
    const firstStore = createStore()
    const secondStore = createStore()
    const firstApi = firstStore.get(formAtom).api
    const secondApi = secondStore.get(formAtom).api
    const mount = vi.spyOn(firstApi, 'mount').mockReturnValue(cleanup)

    expect(firstStore.get(formAtoms.valuesAtom)).toEqual({
      name: '',
      count: 0,
    })
    expect(firstStore.get(formAtoms.valuesAtom)).toEqual({
      name: '',
      count: 0,
    })
    expect(secondStore.get(formAtoms.valuesAtom)).toEqual({
      name: '',
      count: 0,
    })
    expect(firstApi).not.toBe(secondApi)

    const unsubscribe = firstStore.sub(formAtoms.valuesAtom, () => undefined)

    expect(mount).toHaveBeenCalledTimes(1)

    unsubscribe()

    expect(cleanup).toHaveBeenCalledTimes(1)
    mount.mockRestore()
  })
})
