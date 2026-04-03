import { defineConfig } from 'taze'

export default defineConfig({
  exclude: [
    // We are going to replace these
    'react-syntax-highlighter',
    'react-window',
    '@types/react-window',
  ],
})
