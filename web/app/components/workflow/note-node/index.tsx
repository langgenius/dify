import { memo } from 'react'
import type { NodeProps } from 'reactflow'
import {
  NoteEditor,
  NoteEditorContextProvider,
  NoteEditorToolbar,
} from './note-editor'

const NoteNode = ({
  id,
  type,
  data,
}: NodeProps) => {
  return (
    <NoteEditorContextProvider>
      <div className='relative rounded-md shadow-xs'>
        <div className='h-2'></div>
        <div className='absolute -top-1 left-1/2 -translate-x-1/2'>
          <NoteEditorToolbar />
        </div>
        <div className='px-3 py-2.5 min-w-[240px] min-h-[42px]'>
          <NoteEditor />
        </div>
      </div>
    </NoteEditorContextProvider>
  )
}

export default memo(NoteNode)
