'use client'

import {
  NoteEditor,
  NoteEditorContextProvider,
  NoteEditorToolbar,
} from '@/app/components/workflow/note-node/note-editor'

const Page = () => {
  return (
    <div className='w-full h-full p-10 overflow-x-auto'>
      <div>
        <NoteEditorContextProvider>
          <NoteEditorToolbar />
          <NoteEditor />
        </NoteEditorContextProvider>
      </div>
    </div>
  )
}
export default Page
