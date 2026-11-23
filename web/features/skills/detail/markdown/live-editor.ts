import { cn } from '@langgenius/dify-ui/cn'
import { getPathBaseName } from '../files/tree-model'
import {
  getReferenceDisplayLabel,
  getReferenceIconClass,
  parseMarkdownBodyReferences,
} from './references'

const markdownLiveBlockTags = new Set(['DIV', 'P'])

export function serializeMarkdownLiveEditorNode(node: Node, rootNode: Node = node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''

  if (node instanceof HTMLElement) {
    const referenceMarkdown = node.dataset.referenceMarkdown
    if (referenceMarkdown) return referenceMarkdown

    if (node.tagName === 'BR') return '\n'
  }

  const content = Array.from(node.childNodes)
    .map((childNode) => serializeMarkdownLiveEditorNode(childNode, rootNode))
    .join('')

  if (node !== rootNode && node instanceof HTMLElement && markdownLiveBlockTags.has(node.tagName))
    return content.endsWith('\n') ? content : `${content}\n`

  return content
}

export function renderMarkdownLiveEditorContent(root: HTMLDivElement, body: string) {
  root.replaceChildren()

  const segments = parseMarkdownBodyReferences(body)
  for (const segment of segments) {
    if (segment.type === 'text') {
      root.appendChild(root.ownerDocument.createTextNode(segment.text))
      continue
    }

    const markdown = `[${segment.label || getPathBaseName(segment.path)}](<${segment.path}>)`
    const referenceElement = root.ownerDocument.createElement('span')
    referenceElement.contentEditable = 'false'
    referenceElement.dataset.referenceMarkdown = markdown
    referenceElement.dataset.referencePath = segment.path
    referenceElement.className =
      'relative inline-flex cursor-pointer flex-col items-start px-0.5 py-px align-baseline outline-none focus-visible:rounded-[5px] focus-visible:ring-2 focus-visible:ring-state-accent-solid'
    referenceElement.tabIndex = 0
    referenceElement.setAttribute('role', 'button')

    const chipElement = root.ownerDocument.createElement('span')
    chipElement.className =
      'inline-flex min-w-[18px] items-center overflow-hidden rounded-[5px] border border-state-accent-hover-alt bg-state-accent-hover py-px pr-1 pl-px text-text-accent shadow-xs'

    const labelElement = root.ownerDocument.createElement('span')
    labelElement.className = 'inline-flex min-w-0 items-center gap-0.5'

    const iconWrapElement = root.ownerDocument.createElement('span')
    iconWrapElement.className = 'inline-flex shrink-0 items-center justify-center p-px'

    const iconElement = root.ownerDocument.createElement('span')
    iconElement.setAttribute('aria-hidden', 'true')
    iconElement.className = cn('size-3.5 shrink-0', getReferenceIconClass(segment.path))
    iconWrapElement.appendChild(iconElement)
    labelElement.appendChild(iconWrapElement)

    const textElement = root.ownerDocument.createElement('span')
    textElement.className = 'max-w-48 truncate system-xs-medium'
    textElement.textContent = getReferenceDisplayLabel(segment.path, segment.label)
    labelElement.appendChild(textElement)

    chipElement.appendChild(labelElement)
    referenceElement.appendChild(chipElement)

    root.appendChild(referenceElement)
  }
}

export function getMarkdownLiveEditorSelectionOffset(root: HTMLElement) {
  const selection = root.ownerDocument.getSelection()
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null

  const prefixRange = range.cloneRange()
  prefixRange.selectNodeContents(root)
  prefixRange.setEnd(range.startContainer, range.startOffset)

  return serializeMarkdownLiveEditorNode(prefixRange.cloneContents()).replace(/\u00A0/g, ' ').length
}

export function setMarkdownLiveEditorSelectionOffset(root: HTMLElement, offset: number) {
  const selection = root.ownerDocument.getSelection()
  if (!selection) return

  let remainingOffset = Math.max(offset, 0)
  let resolved = false

  const setRange = (node: Node, nodeOffset: number) => {
    const range = root.ownerDocument.createRange()
    range.setStart(node, nodeOffset)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    resolved = true
  }

  const walk = (node: Node) => {
    if (resolved) return

    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0
      if (remainingOffset <= length) {
        setRange(node, remainingOffset)
        return
      }
      remainingOffset -= length
      return
    }

    if (node instanceof HTMLElement) {
      const referenceMarkdown = node.dataset.referenceMarkdown
      if (referenceMarkdown) {
        const length = referenceMarkdown.length
        if (remainingOffset <= length) {
          const parent = node.parentNode
          if (!parent) return

          const nodeIndex = Array.from(parent.childNodes).indexOf(node)
          setRange(parent, nodeIndex + (remainingOffset === 0 ? 0 : 1))
          return
        }
        remainingOffset -= length
        return
      }

      if (node.tagName === 'BR') {
        if (remainingOffset <= 1) {
          const parent = node.parentNode
          if (!parent) return

          const nodeIndex = Array.from(parent.childNodes).indexOf(node)
          setRange(parent, nodeIndex + (remainingOffset === 0 ? 0 : 1))
          return
        }
        remainingOffset -= 1
        return
      }
    }

    for (const childNode of Array.from(node.childNodes)) walk(childNode)
  }

  walk(root)

  if (!resolved) setRange(root, root.childNodes.length)
}

export function insertMarkdownLiveEditorLineBreak(root: HTMLElement) {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null

  const currentOffset = getMarkdownLiveEditorSelectionOffset(root)
  if (currentOffset == null) return null

  range.deleteContents()
  range.insertNode(root.ownerDocument.createTextNode('\n'))
  setMarkdownLiveEditorSelectionOffset(root, currentOffset + 1)

  return currentOffset + 1
}

export function getContentEditableCaretAnchor(root: HTMLElement) {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return { x: 0, y: 0 }

  const range = selection.getRangeAt(0).cloneRange()
  range.collapse(false)
  const rect = range.getBoundingClientRect()

  return {
    x: rect.left,
    y: rect.bottom,
  }
}

export function getTextareaCaretAnchor(textarea: HTMLTextAreaElement, index: number) {
  const style = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')
  const properties = [
    'borderBottomWidth',
    'borderLeftWidth',
    'borderRightWidth',
    'borderTopWidth',
    'boxSizing',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'paddingBottom',
    'paddingLeft',
    'paddingRight',
    'paddingTop',
    'textTransform',
    'whiteSpace',
    'wordBreak',
    'wordSpacing',
  ] as const

  for (const property of properties) {
    mirror.style[property] = style[property]
  }

  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.overflow = 'hidden'
  mirror.style.left = '-9999px'
  mirror.style.top = '0'
  mirror.style.width = `${textarea.clientWidth}px`
  mirror.style.height = 'auto'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'

  const before = textarea.value.slice(0, index)
  const marker = document.createElement('span')
  marker.textContent = '\u200B'
  mirror.textContent = before
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const textareaRect = textarea.getBoundingClientRect()
  const markerRect = marker.getBoundingClientRect()
  const mirrorRect = mirror.getBoundingClientRect()
  const anchor = {
    x: textareaRect.left - mirrorRect.left + markerRect.left - textarea.scrollLeft,
    y:
      textareaRect.top -
      mirrorRect.top +
      markerRect.top -
      textarea.scrollTop +
      markerRect.height +
      6,
  }

  mirror.remove()
  return anchor
}
