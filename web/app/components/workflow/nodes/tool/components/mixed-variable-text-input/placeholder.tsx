import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { FOCUS_COMMAND } from 'lexical'
import { $insertNodes } from 'lexical'
import { CustomTextNode } from '@/app/components/base/prompt-editor/plugins/custom-text/node'
import Badge from '@/app/components/base/badge'

const Placeholder = () => {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()

  const handleInsert = useCallback((text: string) => {
    editor.update(() => {
      const textNode = new CustomTextNode(text)
      $insertNodes([textNode])
    })
    editor.dispatchCommand(FOCUS_COMMAND, undefined as any)
  }, [editor])

  return (
    <div
      className='pointer-events-auto flex h-full w-full cursor-text items-center px-2'
      onClick={(e) => {
        e.stopPropagation()
        handleInsert('')
      }}
    >
      <div className='flex grow items-center'>
        {t('workflow.nodes.tool.insertPlaceholder1')}
        <div className='system-kbd mx-0.5 flex h-4 w-4 items-center justify-center rounded bg-components-kbd-bg-gray text-text-placeholder'>/</div>
        <div
          className='system-sm-regular cursor-pointer text-components-input-text-placeholder underline decoration-dotted decoration-auto underline-offset-auto hover:text-text-tertiary'
          onClick={((e) => {
            e.stopPropagation()
            handleInsert('/')
          })}
        >
          {t('workflow.nodes.tool.insertPlaceholder2')}
        </div>
      </div>
      <Badge
        className='shrink-0'
        text='String'
        uppercase={false}
      />
    </div>
  )
}

export default Placeholder
