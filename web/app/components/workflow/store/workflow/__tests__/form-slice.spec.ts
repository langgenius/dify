import type { RunFile } from '@/app/components/workflow/types'
import { createStore } from 'zustand/vanilla'
import { TransferMethod } from '@/types/app'
import { createFormSlice } from '../form-slice'

describe('createFormSlice', () => {
  it('stores runtime inputs and uploaded files', () => {
    const store = createStore(createFormSlice)
    const files: RunFile[] = [
      {
        type: 'image',
        transfer_method: [TransferMethod.local_file],
        upload_file_id: 'file-1',
      },
    ]

    store.getState().setInputs({
      prompt: 'hello',
      retries: 2,
      enabled: true,
    })
    store.getState().setFiles(files)

    expect(store.getState().inputs).toEqual({
      prompt: 'hello',
      retries: 2,
      enabled: true,
    })
    expect(store.getState().files).toEqual(files)
  })
})
