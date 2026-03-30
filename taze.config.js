import { defineConfig } from 'taze'

export default defineConfig({
  exclude: [
    // We are going to replace these
    'react-syntax-highlighter',
    'react-window',
    '@types/react-window',

    // We can not upgrade these yet
    'tailwind-merge',
    'tailwindcss',
    'typescript',
  ],

  write: true,
  install: false,
  recursive: true,
  interactive: true,
})
