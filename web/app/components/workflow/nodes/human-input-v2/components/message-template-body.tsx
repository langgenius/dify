import type { RangeSelection } from 'lexical'
import type { ComponentProps } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  HISTORY_PUSH_TAG,
} from 'lexical'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { INSERT_REQUEST_URL_BLOCK_COMMAND } from '@/app/components/base/prompt-editor/plugins/request-url-block'
import MailBodyInput from '../../human-input/components/delivery-method/mail-body-input'
import { getRequestURLCount } from '../message-template-utils'

const InsertRequestURL = ({
  container,
  hasRequestURL,
  readOnly,
}: {
  container: HTMLElement | null
  hasRequestURL: boolean
  readOnly: boolean
}) => {
  const [editor] = useLexicalComposerContext()
  const { t } = useTranslation(['workflow'])
  const lastSelectionRef = useRef<RangeSelection | null>(null)

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) => {
          editorState.read(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) lastSelectionRef.current = selection.clone()
          })
        }),
        editor.registerCommand(
          INSERT_REQUEST_URL_BLOCK_COMMAND,
          () => !editor.isEditable() || getRequestURLCount($getRoot().getTextContent()) > 0,
          COMMAND_PRIORITY_HIGH,
        ),
      ),
    [editor],
  )

  const insert = () => {
    if (readOnly) return
    editor.update(
      () => {
        if (!editor.isEditable() || getRequestURLCount($getRoot().getTextContent())) return
        if (!$isRangeSelection($getSelection())) {
          const previous = lastSelectionRef.current
          if (
            previous &&
            $getNodeByKey(previous.anchor.key)?.isAttached() &&
            $getNodeByKey(previous.focus.key)?.isAttached()
          )
            $setSelection(previous.clone())
          else $getRoot().selectEnd()
        }
        editor.dispatchCommand(INSERT_REQUEST_URL_BLOCK_COMMAND, undefined)
      },
      { tag: HISTORY_PUSH_TAG },
    )
    editor.focus(undefined, { defaultSelection: 'rootEnd' })
  }

  if (!container) return null
  return createPortal(
    <Button
      variant="ghost-accent"
      size="small"
      disabled={readOnly || hasRequestURL}
      onMouseDown={(event) => event.preventDefault()}
      onClick={insert}
    >
      <span
        className={hasRequestURL ? 'i-ri-check-line size-3.5' : 'i-ri-add-line size-3.5'}
        aria-hidden
      />
      {t(
        ($) =>
          $[
            hasRequestURL
              ? 'nodes.humanInputV2.template.requestURLInserted'
              : 'nodes.humanInputV2.template.insertRequestURL'
          ],
        { ns: 'workflow' },
      )}
    </Button>,
    container,
  )
}

type MessageTemplateBodyProps = Pick<
  ComponentProps<typeof MailBodyInput>,
  'value' | 'onChange' | 'readOnly' | 'nodesOutputVars' | 'availableNodes'
> & {
  nodeId: string
  error?: string
}

const MessageTemplateBody = ({ nodeId, error, ...props }: MessageTemplateBodyProps) => {
  const { t } = useTranslation(['workflow'])
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null)
  const hasRequestURL = getRequestURLCount(props.value ?? '') > 0
  return (
    <div
      id={`${nodeId}-message-body`}
      role="group"
      aria-labelledby={`${nodeId}-message-body-label`}
      aria-describedby={`${nodeId}-message-body-hint${error ? ` ${nodeId}-message-body-error` : ''}`}
    >
      <div className="mb-1 flex min-h-6 items-center justify-between gap-2">
        <span id={`${nodeId}-message-body-label`} className="system-sm-medium text-text-secondary">
          {t(($) => $['nodes.humanInputV2.template.body'], { ns: 'workflow' })}
        </span>
        <div ref={setToolbar} />
      </div>
      <div className="[&>div>[contenteditable]]:min-h-[118px]">
        <MailBodyInput
          {...props}
          aria-labelledby={`${nodeId}-message-body-label`}
          requestURLSelectable={!hasRequestURL}
        >
          <InsertRequestURL
            container={toolbar}
            hasRequestURL={hasRequestURL}
            readOnly={!!props.readOnly}
          />
        </MailBodyInput>
      </div>
      <p id={`${nodeId}-message-body-hint`} className="mt-1.5 system-xs-regular text-text-tertiary">
        {t(($) => $['nodes.humanInputV2.template.requestURLHint'], { ns: 'workflow' })}
      </p>
      {error && (
        <div
          id={`${nodeId}-message-body-error`}
          role="alert"
          className="mt-1 system-xs-regular text-text-destructive"
        >
          {error}
        </div>
      )}
    </div>
  )
}

export default MessageTemplateBody
