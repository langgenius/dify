import type { EditorThemeClasses } from 'lexical'

import './theme.css'

const theme: EditorThemeClasses = {
  paragraph: 'note-editor-theme_paragraph',
  list: {
    ul: 'note-editor-theme_list-ul',
    listitem: 'note-editor-theme_list-li',
  },
  link: 'note-editor-theme_link',
  text: {
    italic: 'note-editor-theme_text-italic',
    strikethrough: 'note-editor-theme_text-strikethrough',
  },
}

export default theme
