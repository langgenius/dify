import {
  memo,
  useEffect,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useClickAway } from 'ahooks'
import ShortcutsName from './shortcuts-name'
import { useStore } from './store'
import {
  useNodesInteractions,
  useSelectionGraphMenu,
  useWorkflowStartRun,
} from './hooks'
import { useStore as useAppStore } from '@/app/components/app/store'

const PanelContextmenu = () => {
  const { t } = useTranslation()
  const ref = useRef(null)
  const selectPanelMenu = useStore(s => s.selectPanelMenu)
  const selectGraph = useStore(s => s.selectGraph)
  const clipboardElements = useStore(s => s.clipboardElements)
  const { handleNodesPaste } = useNodesInteractions()
  const { handleSelectPanelContextmenuCancel, handleOtherContextmenuCancel } = useSelectionGraphMenu()
  const { handleStartWorkflowRun } = useWorkflowStartRun()

  const appDetail = useAppStore(state => state.appDetail)

  console.log(appDetail?.mode, selectGraph)

  useEffect(() => {
    if (selectPanelMenu)
      handleOtherContextmenuCancel()
  }, [selectPanelMenu, handleOtherContextmenuCancel])

  useClickAway(() => {
    handleSelectPanelContextmenuCancel()
  }, ref)

  if (!selectPanelMenu)
    return null

  return (
    <div
      className='absolute z-[9] w-[200px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg'
      style={{
        left: selectPanelMenu.left,
        top: selectPanelMenu.top,
      }}
      ref={ref}
    >
      <div className='p-1'>
        <div
          className='flex h-8 cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover'
          onClick={() => {
            handleStartWorkflowRun()
            handleSelectPanelContextmenuCancel()
          }}
        >
          {t('workflow.common.run')}
          <ShortcutsName keys={['alt', 'r']} />
        </div>
      </div>
    </div>
  )
}

export default memo(PanelContextmenu)
