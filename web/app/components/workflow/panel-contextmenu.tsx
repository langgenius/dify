import {
  memo,
  useRef,
} from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useClickAway } from 'ahooks'
import ShortcutsName from './shortcuts-name'
import {
  useStore,
  useWorkflowStore,
} from './store'
import { useNodesInteractions } from './hooks'

const PanelContextmenu = () => {
  const { t } = useTranslation()
  const ref = useRef(null)
  const workflowStore = useWorkflowStore()
  const panelMenu = useStore(s => s.panelMenu)
  const clipboardElements = useStore(s => s.clipboardElements)
  const { handleNodesPaste } = useNodesInteractions()

  useClickAway(() => {
    workflowStore.setState({
      panelMenu: undefined,
    })
  }, ref)

  if (!panelMenu)
    return null

  return (
    <div
      className='absolute w-[200px] rounded-lg border-[0.5px] border-gray-200 bg-white shadow-xl z-[9]'
      style={{
        left: panelMenu.left,
        top: panelMenu.top,
      }}
      ref={ref}
    >
      <div className='p-1'>
        <div
          className='flex items-center justify-between px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'
          onClick={() => {}}
        >
          {t('workflow.common.addBlock')}
        </div>
        <div
          className='flex items-center justify-between px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'
          onClick={() => {}}
        >
          {t('workflow.common.run')}
          <ShortcutsName keys={['alt', 'r']} />
        </div>
      </div>
      <div className='h-[1px] bg-gray-100'></div>
      <div className='p-1'>
        <div
          className={cn(
            'flex items-center justify-between px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer',
            !clipboardElements.length ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50',
          )}
          onClick={() => {
            if (clipboardElements.length)
              handleNodesPaste()
          }}
        >
          {t('workflow.common.pasteHere')}
          <ShortcutsName keys={['ctrl', 'v']} />
        </div>
      </div>
      <div className='h-[1px] bg-gray-100'></div>
      <div className='p-1'>
        <div
          className='flex items-center justify-between px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'
          onClick={() => {}}
        >
          {t('app.export')}
        </div>
      </div>
    </div>
  )
}

export default memo(PanelContextmenu)
