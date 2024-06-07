'use client'

import {
  NoteEditor,
  NoteEditorContextProvider,
  NoteEditorToolbar,
} from '@/app/components/workflow/note-node/note-editor'

const Page = () => {
  return (
    <div className='w-full h-full p-10 pt-20 overflow-x-auto'>
      <div>
        <NoteEditorContextProvider>
          <NoteEditorToolbar />
          <div className='h-[300px] overflow-y-auto'>
            <NoteEditor />
          </div>

        </NoteEditorContextProvider>
      </div>
    </div>
  )
}
export default Page
