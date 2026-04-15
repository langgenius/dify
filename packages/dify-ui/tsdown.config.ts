import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'tailwind-preset': 'src/tailwind-preset.ts',
    'tokens/tailwind-theme-var-define': 'src/themes/tailwind-theme-var-define.ts',
    'lib/cn': 'src/lib/cn.ts',
  },
  format: 'esm',
  dts: true,
  clean: true,
  deps: {
    neverBundle: [/^@egoist/, /^@iconify/, /^tailwindcss/, /^clsx/, /^tailwind-merge/],
  },
})
