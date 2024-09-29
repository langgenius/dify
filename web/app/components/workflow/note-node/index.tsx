import {
  memo,
  useCallback,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useClickAway } from 'ahooks'
import type { NodeProps } from 'reactflow'
import NodeResizer from '../nodes/_base/components/node-resizer'
import {
  useNodeDataUpdate,
  useNodesInteractions,
} from '../hooks'
import { useStore } from '../store'
import {
  NoteEditor,
  NoteEditorContextProvider,
  NoteEditorToolbar,
} from './note-editor'
import { THEME_MAP } from './constants'
import { useNote } from './hooks'
import type { NoteNodeType } from './types'
import cn from '@/utils/classnames'

const Icon = () => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 9.75V6H13.5V9.75C13.5 11.8211 11.8211 13.5 9.75 13.5H6V12H9.75C10.9926 12 12 10.9926 12 9.75Z" fill="black" fillOpacity="0.16" />
    </svg>
  )
}

const NoteNode = ({
  id,
  data,
}: NodeProps<NoteNodeType>) => {
  const { t } = useTranslation()
  const controlPromptEditorRerenderKey = useStore(s => s.controlPromptEditorRerenderKey)
  const ref = useRef<HTMLDivElement | null>(null)
  const theme = data.theme
  const {
    handleThemeChange,
    handleEditorChange,
    handleShowAuthorChange,
  } = useNote(id)
  const {
    handleNodesCopy,
    handleNodesDuplicate,
    handleNodeDelete,
  } = useNodesInteractions()
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()

  const handleDeleteNode = useCallback(() => {
    handleNodeDelete(id)
  }, [id, handleNodeDelete])

  useClickAway(() => {
    handleNodeDataUpdateWithSyncDraft({ id, data: { selected: false } })
  }, ref)

  return (
    <div
      className={cn(
        'flex flex-col relative rounded-md shadow-xs border hover:shadow-md',
      )}
      style={{
        background: THEME_MAP[theme].bg,
        borderColor: data.selected ? THEME_MAP[theme].border : 'rgba(0, 0, 0, 0.05)',
        width: data.width,
        height: data.height,
      }}
      ref={ref}
    >
      <NoteEditorContextProvider
        key={controlPromptEditorRerenderKey}
        value={data.text}
      >
        <>
          <NodeResizer
            nodeId={id}
            nodeData={data}
            icon={<Icon />}
            minWidth={240}
            minHeight={88}
          />
          <div className='shrink-0 h-2 opacity-50 rounded-t-md' style={{ background: THEME_MAP[theme].title }}></div>
          {
            data.selected && (
              <div className='absolute -top-[41px] left-1/2 -translate-x-1/2'>
                <NoteEditorToolbar
                  theme={theme}
                  onThemeChange={handleThemeChange}
                  onCopy={handleNodesCopy}
                  onDuplicate={handleNodesDuplicate}
                  onDelete={handleDeleteNode}
                  showAuthor={data.showAuthor}
                  onShowAuthorChange={handleShowAuthorChange}
                />
              </div>
            )
          }
          <div className='grow px-3 py-2.5 overflow-y-auto'>
            <div className={cn(
              data.selected && 'nodrag nopan nowheel cursor-text',
            )}>
              <NoteEditor
                containerElement={ref.current}
                placeholder={t('workflow.nodes.note.editor.placeholder') || ''}
                onChange={handleEditorChange}
              />
            </div>
          </div>
          {
            data.showAuthor && (
              <div className='p-3 pt-0 text-xs text-black/[0.32]'>
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
