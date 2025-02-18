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
                'nodrag nopan border-components-actionbar-border bg-components-actionbar-bg z-10 inline-flex w-max items-center rounded-md border-[0.5px]',
                !linkOperatorShow && 'p-1 shadow-md',
                linkOperatorShow && 'system-xs-medium text-text-tertiary p-0.5 shadow-sm',
              )}
              style={floatingStyles}
              ref={refs.setFloating}
            >
              {
                !linkOperatorShow && (
                  <>
                    <input
                      className='text-components-input-text-filled mr-0.5 h-6 w-[196px] appearance-none rounded-sm bg-transparent p-1 text-[13px] outline-none'
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
                      className='hover:bg-state-base-hover flex h-6 items-center rounded-md px-2'
                      href={escape(url)}
                      target='_blank'
                      rel='noreferrer'
                    >
                      <RiExternalLinkLine className='mr-1 h-3 w-3' />
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
                    <div className='bg-divider-regular mx-1 h-3.5 w-[1px]'></div>
                    <div
                      className='hover:bg-state-base-hover mr-0.5 flex h-6 cursor-pointer items-center rounded-md px-2'
                      onClick={(e) => {
                        e.stopPropagation()
                        setLinkOperatorShow(false)
                      }}
                    >
                      <RiEditLine className='mr-1 h-3 w-3' />
                      {t('common.operation.edit')}
                    </div>
                    <div
                      className='hover:bg-state-base-hover flex h-6 cursor-pointer items-center rounded-md px-2'
                      onClick={handleUnlink}
                    >
                      <RiLinkUnlinkM className='mr-1 h-3 w-3' />
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
