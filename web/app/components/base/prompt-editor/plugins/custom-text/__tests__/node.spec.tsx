import { createTestEditor, withEditorUpdate } from '../../__tests__/utils'
import { $createCustomTextNode, CustomTextNode } from '../node'

it('preserves prompt text and formatting through its serialized contract', () => {
  const editor = createTestEditor([CustomTextNode])
  try {
    withEditorUpdate(editor, () => {
      const node = $createCustomTextNode('Hello {{#context#}}')
      node.setFormat('bold').setStyle('color: red').setDetail(1).setMode('segmented')
      const serialized = node.exportJSON()
      expect(serialized).toMatchObject({
        type: 'custom-text',
        version: 1,
        text: 'Hello {{#context#}}',
        format: 1,
        detail: 1,
        style: 'color: red',
        mode: 'segmented',
      })
      const restored = CustomTextNode.importJSON(serialized)
      expect(restored.getTextContent()).toBe(serialized.text)
      expect(restored.getFormat()).toBe(serialized.format)
      expect(restored.getDetail()).toBe(serialized.detail)
      expect(restored.getStyle()).toBe(serialized.style)
      expect(restored.getMode()).toBe(serialized.mode)
    })
  } finally {
    editor.setRootElement(null)
  }
})

it('limits simple-text replacement to normal-mode custom text', () => {
  const editor = createTestEditor([CustomTextNode])
  try {
    withEditorUpdate(editor, () => {
      const node = $createCustomTextNode('{{#context#}}')
      expect(node.isSimpleText()).toBe(true)
      node.setMode('token')
      expect(node.isSimpleText()).toBe(false)
    })
  } finally {
    editor.setRootElement(null)
  }
})
