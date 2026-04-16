import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'lib',
  ignores: [
    'src/themes/tailwind-theme-var-define.ts',
    'src/themes/light.css',
    'src/themes/dark.css',
  ],
  typescript: {
    overrides: {
      'ts/consistent-type-definitions': ['error', 'type'],
      'ts/no-explicit-any': 'error',
    },
  },
})
