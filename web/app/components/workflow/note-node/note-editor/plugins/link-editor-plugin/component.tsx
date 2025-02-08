import {
  memo,
  useEffect,
  useState,
} from 'react'
import { escape } from 'lodash-es'
import {
  FloatingPortal,
  flip,
  offset,
  shift,
  useFloating,
} from '@floating-ui/react'
import { useTranslation } from 'react-i18next'
import { useClickAway } from 'ahooks'
import {
  RiEditLine,
  RiExternalLinkLine,
  RiLinkUnlinkM,
} from '@remixicon/react'
import { useStore } from '../../store'
import { useLink } from './hooks'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'

type LinkEditorComponentProps = {
  containerElement: HTMLDivElement | null
}
const LinkEditorComponent = ({
  containerElement,
}: LinkEditorComponentProps) => {
  const { t } = useTranslation()
  const {
    handleSaveLink,
    handleUnlink,
  } = useLink()
  const selectedLinkUrl = useStore(s => s.selectedLinkUrl)
  const linkAnchorElement = useStore(s => s.linkAnchorElement)
  const linkOperatorShow = useStore(s => s.linkOperatorShow)
  const setLinkAnchorElement = useStore(s => s.setLinkAnchorElement)
  const setLinkOperatorShow = useStore(s => s.setLinkOperatorShow)
  const [url, setUrl] = useState(selectedLinkUrl)
  const { refs, floatingStyles, elements } = useFloating({
    placement: 'top',
    middleware: [
      offset(4),
      shift(),
      flip(),
    ],
  })

  useClickAway(() => {
    setLinkAnchorElement()
  }, linkAnchorElement)

  useEffect(() => {
    setUrl(selectedLinkUrl)
  }, [selectedLinkUrl])

  useEffect(() => {
    if (linkAnchorElement)
      refs.setReference(linkAnchorElement)
  }, [linkAnchorElement, refs])

  return (
    <>
      {
        elements.reference && (
          <FloatingPortal root={containerElement}>
            <div
              className={cn(
                'nodrag nopan inline-flex items-center w-max rounded-md border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg z-10',
                !linkOperatorShow && 'p-1 shadow-md',
                linkOperatorShow && 'p-0.5 shadow-sm system-xs-medium text-text-tertiary',
              )}
              style={floatingStyles}
              ref={refs.setFloating}
            >
              {
                !linkOperatorShow && (
                  <>
                    <input
                      className='mr-0.5 p-1 w-[196px] h-6 rounded-sm text-[13px] appearance-none outline-none bg-transparent text-components-input-text-filled'
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      placeholder={t('workflow.nodes.note.editor.enterUrl') || ''}
                      autoFocus
                    />
                    <Button
                      variant='primary'
                      size='small'
                      disabled={!url}
                      onClick={() => handleSaveLink(url)}
                    >
                      {t('common.operation.ok')}
                    </Button>
                  </>
                )
              }
              {
                linkOperatorShow && (
                  <>
                    <a
                      className='flex items-center px-2 h-6 rounded-md hover:bg-state-base-hover'
                      href={escape(url)}
                      target='_blank'
                      rel='noreferrer'
                    >
                      <RiExternalLinkLine className='mr-1 w-3 h-3' />
                      <div className='mr-1'>
                        {t('workflow.nodes.note.editor.openLink')}
                      </div>
                      <div
                        title={escape(url)}
                        className='text-text-accent max-w-[140px] truncate'
                      >
                        {escape(url)}
                      </div>
                    </a>
                    <div className='mx-1 w-[1px] h-3.5 bg-divider-regular'></div>
                    <div
                      className='flex items-center mr-0.5 px-2 h-6 rounded-md cursor-pointer hover:bg-state-base-hover'
                      onClick={(e) => {
                        e.stopPropagation()
                        setLinkOperatorShow(false)
                      }}
                    >
                      <RiEditLine className='mr-1 w-3 h-3' />
                      {t('common.operation.edit')}
                    </div>
                    <div
                      className='flex items-center px-2 h-6 rounded-md cursor-pointer hover:bg-state-base-hover'
                      onClick={handleUnlink}
                    >
                      <RiLinkUnlinkM className='mr-1 w-3 h-3' />
                      {t('workflow.nodes.note.editor.unlink')}
                    </div>
                  </>
                )
              }
            </div>
          </FloatingPortal>
        )
      }
    </>
  )
}

export default memo(LinkEditorComponent)
