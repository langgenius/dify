import type { NodeProps } from 'reactflow'
import type { NoteNodeType } from '@/app/components/workflow/note-node/types'
import {
  memo,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { THEME_MAP } from '@/app/components/workflow/note-node/constants'
import {
  NoteEditor,
  NoteEditorContextProvider,
} from '@/app/components/workflow/note-node/note-editor'
import { cn } from '@/utils/classnames'

const NoteNode = ({
  data,
}: NodeProps<NoteNodeType>) => {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement | null>(null)
  const theme = data.theme

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-md border shadow-xs hover:shadow-md',
        THEME_MAP[theme].bg,
        data.selected ? THEME_MAP[theme].border : 'border-black/5',
      )}
      style={{
        width: data.width,
        height: data.height,
      }}
      ref={ref}
    >
      <NoteEditorContextProvider
        value={data.text}
        editable={false}
      >
        <>
          <div
            className={cn(
              'h-2 shrink-0 rounded-t-md opacity-50',
              THEME_MAP[theme].title,
            )}
          >
          </div>
          <div className="grow overflow-y-auto px-3 py-2.5">
            <div className={cn(
              data.selected && 'nodrag nopan nowheel cursor-text',
            )}
            >
              <NoteEditor
                containerElement={ref.current}
                placeholder={t('nodes.note.editor.placeholder', { ns: 'workflow' }) || ''}
              />
            </div>
          </div>
          {
            data.showAuthor && (
              <div className="p-3 pt-0 text-xs text-text-tertiary">
                {data.author}
              </div>
            )
          }
        </>
      </NoteEditorContextProvider>
    </div>
  )
}

export default memo(NoteNode)
