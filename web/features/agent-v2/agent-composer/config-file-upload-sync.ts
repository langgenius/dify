import { atom } from 'jotai'

type AutosaveOwner = {
  pause: () => void
  saveLatest: () => Promise<unknown>
  resume: () => void
}

function createConfigFileUploadSync() {
  const pendingSaves = new Set<Promise<unknown>>()
  let autosaveOwner: AutosaveOwner | undefined
  let uploadFinished: Promise<void> | undefined

  return {
    get isUploading() {
      return uploadFinished !== undefined
    },
    register(owner: AutosaveOwner) {
      autosaveOwner = owner
      return () => {
        if (autosaveOwner === owner) autosaveOwner = undefined
      }
    },
    trackSave<T>(save: Promise<T>): Promise<T> {
      pendingSaves.add(save)
      void save.then(
        () => pendingSaves.delete(save),
        () => pendingSaves.delete(save),
      )
      return save
    },
    waitForUpload() {
      return uploadFinished ?? Promise.resolve()
    },
    async beginUpload() {
      let pendingUpload = uploadFinished
      while (pendingUpload) {
        await pendingUpload
        pendingUpload = uploadFinished
      }

      let finishUpload!: () => void
      uploadFinished = new Promise<void>((resolve) => {
        finishUpload = resolve
      })
      const owner = autosaveOwner
      owner?.pause()
      // Include saves already waiting in the composer's serial queue, plus page-close saves.
      await Promise.allSettled([...pendingSaves])

      let released = false
      return async () => {
        if (released) return
        released = true
        try {
          // Retain the owner through unmount so successful files and Prompt refs are still saved.
          await owner?.saveLatest()
        } catch {
          // Like autosave, leave a failed final save dirty for the resumed retry.
        } finally {
          uploadFinished = undefined
          finishUpload()
          owner?.resume()
        }
      }
    },
  }
}

// A fresh controller is evaluated for each store and each explicitly scoped composer session.
export const agentConfigFileUploadSyncAtom = atom(() => createConfigFileUploadSync())
