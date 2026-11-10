import { atom } from 'jotai'
import { documentCanWriteAtom } from './runtime'

export const documentUploadingAtom = atom(false)

export function documentUploadAvailability(canWrite: boolean, uploadAvailable: boolean) {
  return {
    canUpload: canWrite && uploadAvailable,
    restrictionReasonId: uploadAvailable
      ? canWrite
        ? undefined
        : 'documents-readonly-reason'
      : 'documents-upload-unavailable',
  }
}

export const documentReadOnlyReasonIdAtom = atom((get) =>
  get(documentCanWriteAtom) ? undefined : 'documents-readonly-reason',
)
