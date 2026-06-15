// @ts-check

export const antfuWithoutFormatting = {
  stylistic: false,
  jsonc: {
    stylistic: false,
  },
  yaml: {
    stylistic: false,
  },
  toml: {
    stylistic: false,
  },
}

export const disableJsonSortFormatting = {
  name: 'dify/disable-json-sort-formatting',
  files: ['**/package.json', '**/[jt]sconfig.json', '**/[jt]sconfig.*.json'],
  rules: {
    'jsonc/sort-array-values': 'off',
    'jsonc/sort-keys': 'off',
  },
}
