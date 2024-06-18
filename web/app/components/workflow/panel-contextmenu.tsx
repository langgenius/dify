import {
  memo,
  useRef,
} from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useClickAway } from 'ahooks'
import ShortcutsName from './shortcuts-name'
import { useStore } from './store'
import {
  useNodesInteractions,
  usePanelInteractions,
  useWorkflowStartRun,
} from './hooks'
import AddBlock from './operator/add-block'
import { useOperator } from './operator/hooks'
import { exportAppConfig } from '@/service/apps'
import { useToastContext } from '@/app/components/base/toast'
import { useStore as useAppStore } from '@/app/components/app/store'

const PanelContextmenu = () => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const ref = useRef(null)
  const panelMenu = useStore(s => s.panelMenu)
  const clipboardElements = useStore(s => s.clipboardElements)
  const appDetail = useAppStore(s => s.appDetail)
  const { handleNodesPaste } = useNodesInteractions()
  const { handlePaneContextmenuCancel } = usePanelInteractions()
  const { handleStartWorkflowRun } = useWorkflowStartRun()
  const { handleAddNote } = useOperator()

  useClickAway(() => {
    handlePaneContextmenuCancel()
  }, ref)

  const onExport = async () => {
    if (!appDetail)
      return
    try {
      const { data } = await exportAppConfig(appDetail.id)
      const a = document.createElement('a')
      const file = new Blob([data], { type: 'application/yaml' })
      a.href = URL.createObjectURL(file)
      a.download = `${appDetail.name}.yml`
      a.click()
    }
    catch (e) {
      notify({ type: 'error', message: t('app.exportFailed') })
    }
  }

  const renderTrigger = () => {
    return (
      <div
        className='flex items-center justify-between px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'
      >
        {t('workflow.common.addBlock')}
      </div>
    )
  }

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
        <AddBlock
          renderTrigger={renderTrigger}
          offset={{
            mainAxis: -36,
            crossAxis: -4,
          }}
        />
        <div
          className='flex items-center justify-between px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'
          onClick={(e) => {
            e.stopPropagation()
            handleAddNote()
            handlePaneContextmenuCancel()
          }}
        >
          {t('workflow.nodes.note.addNote')}
        </div>
        <div
          className='flex items-center justify-between px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'
          onClick={() => {
            handleStartWorkflowRun()
            handlePaneContextmenuCancel()
          }}
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
            if (clipboardElements.length) {
              handleNodesPaste()
              handlePaneContextmenuCancel()
            }
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
          onClick={() => onExport()}
        >
          {t('app.export')}
        </div>
      </div>
    </div>
  )
}

export default memo(PanelContextmenu)
