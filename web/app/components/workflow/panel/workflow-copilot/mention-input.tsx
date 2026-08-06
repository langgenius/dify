import type { KeyboardEvent, Ref } from 'react'
import { useCallback, useImperativeHandle, useRef, useState } from 'react'

/**
 * Rich single-field input for the Copilot panel.
 *
 * A plain textarea can't show a node reference as a bordered, atomic "bubble" —
 * its text is one flat color and a transparent highlight overlay can only paint
 * a background that lines up glyph-for-glyph with the literal 【Title】. So this
 * is a `contentEditable` editor where each mention is an inline pill element
 * (`contentEditable=false`, so it's non-editable and deletes as one unit).
 *
 * The editor is *uncontrolled*: the DOM owns the content, we only read it. On
 * every change we serialize the DOM back to a plain string (mentions become
 * `【Title】`, so the wire format and chat-history rendering are unchanged) and
 * report the set of mention ids currently present, letting the parent keep the
 * context chips in sync (delete pill → drop chip, all keyed by node id).
 */

export type MentionNode = { id: string, title: string }

export type MentionInputHandle = {
  focus: () => void
  clear: () => void
  // Insert at the caret, replacing the pending `#query` (picking from the menu).
  insertMentionAtCaret: (node: MentionNode) => void
  // Append at the end (adding a node from its "..." menu — there's no caret).
  appendMention: (node: MentionNode) => void
  // Remove a mention pill by node id (a context chip was removed).
  removeMention: (id: string) => void
}

type MentionInputProps = {
  disabled?: boolean
  placeholder?: string
  isPickerOpen?: boolean
  // Serialized draft (with 【Title】 tokens) + the mention ids currently present.
  onChange: (text: string, mentionIds: string[]) => void
  // The unbroken run of text after a `#` immediately before the caret, or null
  // when there's no active `#` trigger. Drives the parent's mention picker.
  onHashQueryChange: (query: string | null) => void
  onEnter: () => void
  // While the picker is open, let the parent drive arrow/enter/esc navigation.
  // Return true if the key was handled (the parent will have preventDefault-ed).
  onPickerKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => boolean
  ref?: Ref<MentionInputHandle>
}

// A node mention pill inside the editor: a light, bordered "bubble" (matching
// Dify's variable-label badges) with an accent `#` glyph so it clearly reads as
// a node reference rather than plain text.
const MENTION_PILL_CLASS = 'mx-0.5 inline-flex items-center gap-0.5 rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark px-1 py-px align-middle system-xs-medium text-text-secondary shadow-xs select-none'
const MENTION_ICON_CLASS = 'i-ri-hashtag size-3 shrink-0 text-text-accent'

// Serialize one DOM node: text as-is, a mention pill as 【Title】, <br> as a
// newline; recurse into any other wrapper (e.g. a div a paste introduced).
const serializeNode = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE)
    return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE)
    return ''
  const el = node as HTMLElement
  if (el.dataset.mentionTitle !== undefined)
    return `【${el.dataset.mentionTitle}】`
  if (el.tagName === 'BR')
    return '\n'
  let inner = ''
  el.childNodes.forEach((child) => {
    inner += serializeNode(child)
  })
  return /^(?:DIV|P)$/.test(el.tagName) ? `\n${inner}` : inner
}

const serialize = (root: HTMLElement): string => {
  let out = ''
  root.childNodes.forEach((child) => {
    out += serializeNode(child)
  })
  return out.replace(/^\n/, '') // a leading wrapper newline is noise
}

const MentionInput = ({
  disabled,
  placeholder,
  isPickerOpen,
  onChange,
  onHashQueryChange,
  onEnter,
  onPickerKeyDown,
  ref,
}: MentionInputProps) => {
  const editorRef = useRef<HTMLDivElement>(null)
  const [isEmpty, setIsEmpty] = useState(true)
  // True while an IME (e.g. Chinese pinyin) is composing — Enter must NOT send.
  const composingRef = useRef(false)

  const createPill = useCallback((node: MentionNode): HTMLSpanElement => {
    const pill = document.createElement('span')
    pill.dataset.mentionId = node.id
    pill.dataset.mentionTitle = node.title
    pill.contentEditable = 'false'
    pill.className = MENTION_PILL_CLASS
    const icon = document.createElement('span')
    icon.className = MENTION_ICON_CLASS
    icon.setAttribute('aria-hidden', 'true')
    const label = document.createElement('span')
    label.textContent = node.title
    pill.appendChild(icon)
    pill.appendChild(label)
    return pill
  }, [])

  const emitChange = useCallback(() => {
    const el = editorRef.current
    if (!el)
      return
    const text = serialize(el)
    const ids = Array.from(el.querySelectorAll<HTMLElement>('[data-mention-id]'))
      .map(n => n.dataset.mentionId)
      .filter((id): id is string => !!id)
    setIsEmpty(text.length === 0)
    onChange(text, ids)
  }, [onChange])

  // Place the caret immediately after a given DOM node.
  const placeCaretAfter = useCallback((node: Node) => {
    const sel = window.getSelection()
    if (!sel)
      return
    const range = document.createRange()
    range.setStartAfter(node)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }, [])

  // Append a pill (+ surrounding spaces) at the very end of the editor.
  const appendMentionAtEnd = useCallback((node: MentionNode) => {
    const el = editorRef.current
    if (!el)
      return
    if (el.textContent && !el.textContent.endsWith(' '))
      el.appendChild(document.createTextNode(' '))
    const pill = createPill(node)
    el.appendChild(pill)
    const space = document.createTextNode(' ')
    el.appendChild(space)
    placeCaretAfter(space)
    emitChange()
  }, [createPill, placeCaretAfter, emitChange])

  // Insert a pill at the caret. When `replaceHash`, first delete the pending
  // `#query` the caret sits in (menu pick). Falls back to end-append when the
  // caret isn't inside the editor.
  const insertMention = useCallback((node: MentionNode, replaceHash: boolean) => {
    const el = editorRef.current
    if (!el)
      return
    el.focus()
    const sel = window.getSelection()
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
    if (!range || !el.contains(range.startContainer)) {
      appendMentionAtEnd(node)
      return
    }

    if (replaceHash && range.startContainer.nodeType === Node.TEXT_NODE) {
      const textNode = range.startContainer as Text
      const offset = range.startOffset
      const before = (textNode.textContent ?? '').slice(0, offset)
      const hashIdx = before.lastIndexOf('#')
      if (hashIdx !== -1) {
        const delRange = document.createRange()
        delRange.setStart(textNode, hashIdx)
        delRange.setEnd(textNode, offset)
        delRange.deleteContents()
        range.setStart(delRange.startContainer, delRange.startOffset)
        range.collapse(true)
      }
    }

    range.deleteContents()
    const pill = createPill(node)
    range.insertNode(pill)
    const space = document.createTextNode(' ')
    pill.parentNode?.insertBefore(space, pill.nextSibling)
    placeCaretAfter(space)
    emitChange()
  }, [appendMentionAtEnd, createPill, placeCaretAfter, emitChange])

  const removeMention = useCallback((id: string) => {
    const el = editorRef.current
    if (!el)
      return
    const pill = el.querySelector<HTMLElement>(`[data-mention-id="${CSS.escape(id)}"]`)
    if (!pill)
      return
    const next = pill.nextSibling
    pill.remove()
    // Drop the single trailing space we inserted with the pill to avoid gaps.
    if (next && next.nodeType === Node.TEXT_NODE && next.textContent === ' ')
      next.remove()
    emitChange()
  }, [emitChange])

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    clear: () => {
      const el = editorRef.current
      if (!el)
        return
      el.innerHTML = ''
      setIsEmpty(true)
      onChange('', [])
    },
    insertMentionAtCaret: node => insertMention(node, true),
    appendMention: node => appendMentionAtEnd(node),
    removeMention,
  }), [insertMention, appendMentionAtEnd, removeMention, onChange])

  // The unbroken run of text after a `#` right before a collapsed caret.
  const computeHashQuery = useCallback((): string | null => {
    const el = editorRef.current
    const sel = window.getSelection()
    if (!el || !sel || sel.rangeCount === 0 || !sel.isCollapsed)
      return null
    const anchor = sel.anchorNode
    if (!anchor || anchor.nodeType !== Node.TEXT_NODE || !el.contains(anchor))
      return null
    const before = (anchor.textContent ?? '').slice(0, sel.anchorOffset)
    const hashIdx = before.lastIndexOf('#')
    if (hashIdx === -1)
      return null
    const between = before.slice(hashIdx + 1)
    if (/[\s【】]/.test(between))
      return null
    return between
  }, [])

  const handleInput = useCallback(() => {
    emitChange()
    onHashQueryChange(computeHashQuery())
  }, [emitChange, onHashQueryChange, computeHashQuery])

  const insertNewline = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0)
      return
    const range = sel.getRangeAt(0)
    range.deleteContents()
    const br = document.createElement('br')
    range.insertNode(br)
    placeCaretAfter(br)
    emitChange()
  }, [placeCaretAfter, emitChange])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    // While the picker is open, let the parent drive navigation/selection.
    if (isPickerOpen && onPickerKeyDown && onPickerKeyDown(e))
      return
    if (e.key === 'Enter' && !e.shiftKey) {
      if (composingRef.current || e.nativeEvent.isComposing)
        return
      e.preventDefault()
      onEnter()
      return
    }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      insertNewline()
    }
  }, [isPickerOpen, onPickerKeyDown, onEnter, insertNewline])

  return (
    <div className="relative">
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 p-2 system-sm-regular text-text-placeholder">
          {placeholder}
        </div>
      )}
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        tabIndex={0}
        contentEditable={!disabled}
        suppressContentEditableWarning
        className="min-h-[60px] w-full rounded-lg border border-divider-regular bg-components-input-bg-normal p-2 system-sm-regular break-words whitespace-pre-wrap text-text-primary outline-none focus:border-components-input-border-active"
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={() => onHashQueryChange(computeHashQuery())}
        onMouseUp={() => onHashQueryChange(computeHashQuery())}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => {
          composingRef.current = false
          handleInput()
        }}
      />
    </div>
  )
}

MentionInput.displayName = 'MentionInput'

export default MentionInput
