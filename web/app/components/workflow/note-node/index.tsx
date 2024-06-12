import { memo } from 'react'
import cn from 'classnames'
import type { NodeProps } from 'reactflow'
import {
  NoteEditor,
  NoteEditorContextProvider,
  NoteEditorToolbar,
} from './note-editor'
import { THEME_MAP } from './constants'
import { useNote } from './hooks'
import type { NoteNodeType } from './types'

const NoteNode = ({
  id,
  data,
}: NodeProps<NoteNodeType>) => {
  const theme = data.theme
  const {
    handleThemeChange,
    handleEditorChange,
  } = useNote(id)

  return (
    <div
      className={cn(
        'relative rounded-md shadow-xs border hover:shadow-md',
      )}
      style={{
        background: THEME_MAP[theme].bg,
        borderColor: data.selected ? THEME_MAP[theme].border : 'rgba(0, 0, 0, 0.05)',
      }}
    >
      <NoteEditorContextProvider value={data.text}>
        <>
          <div className='h-2 opacity-50 rounded-t-md' style={{ background: THEME_MAP[theme].title }}></div>
          {
            data.selected && (
              <div className='absolute -top-10 left-1/2 -translate-x-1/2'>
                <NoteEditorToolbar
                  theme={theme}
                  onThemeChange={handleThemeChange}
                />
              </div>
            )
          }
          <div className='px-3 py-2.5 min-w-[240px] max-w-[640px] min-h-[52px]'>
            <div className={cn(
              'w-full h-full',
              data.selected && 'nodrag',
            )}>
              <NoteEditor onChange={handleEditorChange} />
            </div>
          </div>
        </>
      </NoteEditorContextProvider>
    </div>
  )
}

export default memo(NoteNode)
