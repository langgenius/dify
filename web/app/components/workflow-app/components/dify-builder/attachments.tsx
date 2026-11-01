import type { ReactNode } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { createContext, use, useEffect, useRef } from 'react'
import { FileContextProvider, useFileStore } from '@/app/components/base/file-uploader/store'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderMaterialControlAtom,
  difyBuilderSessionViewAtom,
} from './session/state'
import { difyBuilderDraftAtom } from './store'

const BuilderFileScopeContext = createContext(false)

const AttachmentDraftLifetime = () => {
  const files = useFileStore()
  const sessionId = useAtomValue(difyBuilderActiveSessionIdAtom)
  const cleared = useAtomValue(difyBuilderSessionViewAtom)?.conversation_cleared
  const material = useAtomValue(difyBuilderMaterialControlAtom)
  const draft = useAtomValue(difyBuilderDraftAtom)
  const setDraft = useSetAtom(difyBuilderDraftAtom)
  const setMaterial = useSetAtom(difyBuilderMaterialControlAtom)
  const previousSessionRef = useRef(sessionId)
  useEffect(() => {
    if (cleared || (!sessionId && previousSessionRef.current)) {
      files.getState().setFiles([])
      setMaterial(null)
    } else if (material?.phase === 'accepted') {
      const admitted = new Set(material.attachments.map((file) => file.upload_file_id))
      files
        .getState()
        .setFiles(files.getState().files.filter((file) => !admitted.has(file.uploadedId ?? '')))
      if (draft.trim() === material.text.trim()) setDraft('')
      setMaterial(null)
    }
    previousSessionRef.current = sessionId
  }, [cleared, draft, files, material, sessionId, setDraft, setMaterial])
  return null
}

export const DifyBuilderAttachmentScope = ({ children }: { children: ReactNode }) => {
  const owned = use(BuilderFileScopeContext)
  if (owned) return children
  return (
    <BuilderFileScopeContext value>
      <FileContextProvider>
        <AttachmentDraftLifetime />
        {children}
      </FileContextProvider>
    </BuilderFileScopeContext>
  )
}
