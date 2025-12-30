import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { transpile } from 'typescript'

describe('i18n:check script functionality', () => {
  const testDir = path.join(__dirname, '../i18n-test')
  const testEnDir = path.join(testDir, 'en-US')
  const testZhDir = path.join(testDir, 'zh-Hans')

  // Helper function that replicates the getKeysFromLanguage logic
  async function getKeysFromLanguage(language: string, testPath = testDir): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const folderPath = path.resolve(testPath, language)
      const allKeys: string[] = []

      if (!fs.existsSync(folderPath)) {
        resolve([])
        return
      }

      fs.readdir(folderPath, (err, files) => {
        if (err) {
          reject(err)
          return
        }

        const translationFiles = files.filter(file => /\.(ts|js)$/.test(file))

        translationFiles.forEach((file) => {
          const filePath = path.join(folderPath, file)
          const fileName = file.replace(/\.[^/.]+$/, '')
          const camelCaseFileName = fileName.replace(/[-_](.)/g, (_, c) =>
            c.toUpperCase())

          try {
            const content = fs.readFileSync(filePath, 'utf8')
            const moduleExports = {}
            const context = {
              exports: moduleExports,
              module: { exports: moduleExports },
              require,
              console,
              __filename: filePath,
              __dirname: folderPath,
            }

            vm.runInNewContext(transpile(content), context)
            const translationObj = (context.module.exports as any).default || context.module.exports

            if (!translationObj || typeof translationObj !== 'object')
              throw new Error(`Error parsing file: ${filePath}`)

            const nestedKeys: string[] = []
            const iterateKeys = (obj: any, prefix = '') => {
              for (const key in obj) {
                const nestedKey = prefix ? `${prefix}.${key}` : key
                if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
                  // This is an object (but not array), recurse into it but don't add it as a key
                  iterateKeys(obj[key], nestedKey)
                }
                else {
                  // This is a leaf node (string, number, boolean, array, etc.), add it as a key
                  nestedKeys.push(nestedKey)
                }
              }
            }
            iterateKeys(translationObj)

            const fileKeys = nestedKeys.map(key => `${camelCaseFileName}.${key}`)
            allKeys.push(...fileKeys)
          }
          catch (error) {
            reject(error)
          }
        })
        resolve(allKeys)
      })
    })
  }

  beforeEach(() => {
    // Clean up and create test directories
    if (fs.existsSync(testDir))
      fs.rmSync(testDir, { recursive: true })

    fs.mkdirSync(testDir, { recursive: true })
    fs.mkdirSync(testEnDir, { recursive: true })
    fs.mkdirSync(testZhDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(testDir))
      fs.rmSync(testDir, { recursive: true })
  })

  describe('Key extraction logic', () => {
    it('should extract only leaf node keys, not intermediate objects', async () => {
      const testContent = `const translation = {
  simple: 'Simple Value',
  nested: {
    level1: 'Level 1 Value',
    deep: {
      level2: 'Level 2 Value'
    }
  },
  array: ['not extracted'],
  number: 42,
  boolean: true
}

export default translation
`

      fs.writeFileSync(path.join(testEnDir, 'test.ts'), testContent)

      const keys = await getKeysFromLanguage('en-US')

      expect(keys).toEqual([
        'test.simple',
        'test.nested.level1',
        'test.nested.deep.level2',
        'test.array',
        'test.number',
        'test.boolean',
      ])

      // Should not include intermediate object keys
      expect(keys).not.toContain('test.nested')
      expect(keys).not.toContain('test.nested.deep')
    })

    it('should handle camelCase file name conversion correctly', async () => {
      const testContent = `const translation = {
  key: 'value'
}

export default translation
`

      fs.writeFileSync(path.join(testEnDir, 'app-debug.ts'), testContent)
      fs.writeFileSync(path.join(testEnDir, 'user_profile.ts'), testContent)

      const keys = await getKeysFromLanguage('en-US')

      expect(keys).toContain('appDebug.key')
      expect(keys).toContain('userProfile.key')
    })
  })

  describe('Missing keys detection', () => {
    it('should detect missing keys in target language', async () => {
      const enContent = `const translation = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete'
  },
  app: {
    title: 'My App',
    version: '1.0'
  }
}

export default translation
`

      const zhContent = `const translation = {
  common: {
    save: '保存',
    cancel: '取消'
    // missing 'delete'
  },
  app: {
    title: '我的应用'
    // missing 'version'
  }
}

export default translation
`

      fs.writeFileSync(path.join(testEnDir, 'test.ts'), enContent)
      fs.writeFileSync(path.join(testZhDir, 'test.ts'), zhContent)

      const enKeys = await getKeysFromLanguage('en-US')
      const zhKeys = await getKeysFromLanguage('zh-Hans')

      const missingKeys = enKeys.filter(key => !zhKeys.includes(key))

      expect(missingKeys).toContain('test.common.delete')
      expect(missingKeys).toContain('test.app.version')
      expect(missingKeys).toHaveLength(2)
    })
  })

  describe('Extra keys detection', () => {
    it('should detect extra keys in target language', async () => {
      const enContent = `const translation = {
  common: {
    save: 'Save',
    cancel: 'Cancel'
  }
}

export default translation
`

      const zhContent = `const translation = {
  common: {
    save: '保存',
    cancel: '取消',
    delete: '删除', // extra key
    extra: '额外的' // another extra key
  },
  newSection: {
    someKey: '某个值' // extra section
  }
}

export default translation
`

      fs.writeFileSync(path.join(testEnDir, 'test.ts'), enContent)
      fs.writeFileSync(path.join(testZhDir, 'test.ts'), zhContent)

      const enKeys = await getKeysFromLanguage('en-US')
      const zhKeys = await getKeysFromLanguage('zh-Hans')

      const extraKeys = zhKeys.filter(key => !enKeys.includes(key))

      expect(extraKeys).toContain('test.common.delete')
      expect(extraKeys).toContain('test.common.extra')
      expect(extraKeys).toContain('test.newSection.someKey')
      expect(extraKeys).toHaveLength(3)
    })
  })

  describe('File filtering logic', () => {
    it('should filter keys by specific file correctly', async () => {
      // Create multiple files
      const file1Content = `const translation = {
  button: 'Button',
  text: 'Text'
}

export default translation
`

      const file2Content = `const translation = {
  title: 'Title',
  description: 'Description'
}

export default translation
`

      fs.writeFileSync(path.join(testEnDir, 'components.ts'), file1Content)
      fs.writeFileSync(path.join(testEnDir, 'pages.ts'), file2Content)
      fs.writeFileSync(path.join(testZhDir, 'components.ts'), file1Content)
      fs.writeFileSync(path.join(testZhDir, 'pages.ts'), file2Content)

      const allEnKeys = await getKeysFromLanguage('en-US')

      // Test file filtering logic
      const targetFile = 'components'
      const filteredEnKeys = allEnKeys.filter(key =>
        key.startsWith(targetFile.replace(/[-_](.)/g, (_, c) => c.toUpperCase())),
      )

      expect(allEnKeys).toHaveLength(4) // 2 keys from each file
      expect(filteredEnKeys).toHaveLength(2) // only components keys
      expect(filteredEnKeys).toContain('components.button')
      expect(filteredEnKeys).toContain('components.text')
      expect(filteredEnKeys).not.toContain('pages.title')
      expect(filteredEnKeys).not.toContain('pages.description')
    })
  })

  describe('Complex nested structure handling', () => {
    it('should handle deeply nested objects correctly', async () => {
      const complexContent = `const translation = {
  level1: {
    level2: {
      level3: {
        level4: {
          deepValue: 'Deep Value'
        },
        anotherValue: 'Another Value'
      },
      simpleValue: 'Simple Value'
    },
    directValue: 'Direct Value'
  },
  rootValue: 'Root Value'
}

export default translation
`

      fs.writeFileSync(path.join(testEnDir, 'complex.ts'), complexContent)

      const keys = await getKeysFromLanguage('en-US')

      expect(keys).toContain('complex.level1.level2.level3.level4.deepValue')
      expect(keys).toContain('complex.level1.level2.level3.anotherValue')
      expect(keys).toContain('complex.level1.level2.simpleValue')
      expect(keys).toContain('complex.level1.directValue')
      expect(keys).toContain('complex.rootValue')

      // Should not include intermediate objects
      expect(keys).not.toContain('complex.level1')
      expect(keys).not.toContain('complex.level1.level2')
      expect(keys).not.toContain('complex.level1.level2.level3')
      expect(keys).not.toContain('complex.level1.level2.level3.level4')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty objects', async () => {
      const emptyContent = `const translation = {
  empty: {},
  withValue: 'value'
}

export default translation
`

      fs.writeFileSync(path.join(testEnDir, 'empty.ts'), emptyContent)

      const keys = await getKeysFromLanguage('en-US')

      expect(keys).toContain('empty.withValue')
      expect(keys).not.toContain('empty.empty')
    })

    it('should handle special characters in keys', async () => {
      const specialContent = `const translation = {
  'key-with-dash': 'value1',
  'key_with_underscore': 'value2',
  'key.with.dots': 'value3',
  normalKey: 'value4'
}

export default translation
`

      fs.writeFileSync(path.join(testEnDir, 'special.ts'), specialContent)

      const keys = await getKeysFromLanguage('en-US')

      expect(keys).toContain('special.key-with-dash')
      expect(keys).toContain('special.key_with_underscore')
      expect(keys).toContain('special.key.with.dots')
      expect(keys).toContain('special.normalKey')
    })

    it('should handle different value types', async () => {
      const typesContent = `const translation = {
  stringValue: 'string',
  numberValue: 42,
  booleanValue: true,
  nullValue: null,
  undefinedValue: undefined,
  arrayValue: ['array', 'values'],
  objectValue: {
    nested: 'nested value'
  }
}

export default translation
`

      fs.writeFileSync(path.join(testEnDir, 'types.ts'), typesContent)

      const keys = await getKeysFromLanguage('en-US')

      expect(keys).toContain('types.stringValue')
      expect(keys).toContain('types.numberValue')
      expect(keys).toContain('types.booleanValue')
      expect(keys).toContain('types.nullValue')
      expect(keys).toContain('types.undefinedValue')
      expect(keys).toContain('types.arrayValue')
      expect(keys).toContain('types.objectValue.nested')
      expect(keys).not.toContain('types.objectValue')
    })
  })

  describe('Real-world scenario tests', () => {
    it('should handle app-debug structure like real files', async () => {
      const appDebugEn = `const translation = {
  pageTitle: {
    line1: 'Prompt',
    line2: 'Engineering'
  },
  operation: {
    applyConfig: 'Publish',
    resetConfig: 'Reset',
    debugConfig: 'Debug'
  },
  generate: {
    instruction: 'Instructions',
    generate: 'Generate',
    resTitle: 'Generated Prompt',
    noDataLine1: 'Describe your use case on the left,',
    noDataLine2: 'the orchestration preview will show here.'
  }
}

export default translation
`

      const appDebugZh = `const translation = {
  pageTitle: {
    line1: '提示词',
    line2: '编排'
  },
  operation: {
    applyConfig: '发布',
    resetConfig: '重置',
    debugConfig: '调试'
  },
  generate: {
    instruction: '指令',
    generate: '生成',
    resTitle: '生成的提示词',
    noData: '在左侧描述您的用例，编排预览将在此处显示。' // This is extra
  }
}

export default translation
`

      fs.writeFileSync(path.join(testEnDir, 'app-debug.ts'), appDebugEn)
      fs.writeFileSync(path.join(testZhDir, 'app-debug.ts'), appDebugZh)

      const enKeys = await getKeysFromLanguage('en-US')
      const zhKeys = await getKeysFromLanguage('zh-Hans')

      const missingKeys = enKeys.filter(key => !zhKeys.includes(key))
      const extraKeys = zhKeys.filter(key => !enKeys.includes(key))

      expect(missingKeys).toContain('appDebug.generate.noDataLine1')
      expect(missingKeys).toContain('appDebug.generate.noDataLine2')
      expect(extraKeys).toContain('appDebug.generate.noData')

      expect(missingKeys).toHaveLength(2)
      expect(extraKeys).toHaveLength(1)
    })

    it('should handle time structure with operation nested keys', async () => {
      const timeEn = `const translation = {
  months: {
    January: 'January',
    February: 'February'
  },
  operation: {
    now: 'Now',
    ok: 'OK',
    cancel: 'Cancel',
    pickDate: 'Pick Date'
  },
  title: {
    pickTime: 'Pick Time'
  },
  defaultPlaceholder: 'Pick a time...'
}

export default translation
`

      const timeZh = `const translation = {
  months: {
    January: '一月',
    February: '二月'
  },
  operation: {
    now: '此刻',
    ok: '确定',
    cancel: '取消',
    pickDate: '选择日期'
  },
  title: {
    pickTime: '选择时间'
  },
  pickDate: '选择日期', // This is extra - duplicates operation.pickDate
  defaultPlaceholder: '请选择时间...'
}

export default translation
`

      fs.writeFileSync(path.join(testEnDir, 'time.ts'), timeEn)
      fs.writeFileSync(path.join(testZhDir, 'time.ts'), timeZh)

      const enKeys = await getKeysFromLanguage('en-US')
      const zhKeys = await getKeysFromLanguage('zh-Hans')

      const missingKeys = enKeys.filter(key => !zhKeys.includes(key))
      const extraKeys = zhKeys.filter(key => !enKeys.includes(key))

      expect(missingKeys).toHaveLength(0) // No missing keys
      expect(extraKeys).toContain('time.pickDate') // Extra root-level pickDate
      expect(extraKeys).toHaveLength(1)

      // Should have both keys available
      expect(zhKeys).toContain('time.operation.pickDate') // Correct nested key
      expect(zhKeys).toContain('time.pickDate') // Extra duplicate key
    })
  })

  describe('Statistics calculation', () => {
    it('should calculate correct difference statistics', async () => {
      const enContent = `const translation = {
  key1: 'value1',
  key2: 'value2',
  key3: 'value3'
}

export default translation
`

      const zhContentMissing = `const translation = {
  key1: 'value1',
  key2: 'value2'
  // missing key3
}

export default translation
`

      const zhContentExtra = `const translation = {
  key1: 'value1',
  key2: 'value2', 
  key3: 'value3',
  key4: 'extra',
  key5: 'extra2'
}

export default translation
`

      fs.writeFileSync(path.join(testEnDir, 'stats.ts'), enContent)

      // Test missing keys scenario
      fs.writeFileSync(path.join(testZhDir, 'stats.ts'), zhContentMissing)

      const enKeys = await getKeysFromLanguage('en-US')
      const zhKeysMissing = await getKeysFromLanguage('zh-Hans')

      expect(enKeys.length - zhKeysMissing.length).toBe(1) // +1 means 1 missing key

      // Test extra keys scenario
      fs.writeFileSync(path.join(testZhDir, 'stats.ts'), zhContentExtra)

      const zhKeysExtra = await getKeysFromLanguage('zh-Hans')

      expect(enKeys.length - zhKeysExtra.length).toBe(-2) // -2 means 2 extra keys
    })
  })

  describe('Auto-remove multiline key-value pairs', () => {
    // Helper function to simulate removeExtraKeysFromFile logic
    function removeExtraKeysFromFile(content: string, keysToRemove: string[]): string {
      const lines = content.split('\n')
      const linesToRemove: number[] = []

      for (const keyToRemove of keysToRemove) {
        let targetLineIndex = -1
        const linesToRemoveForKey: number[] = []

        // Find the key line (simplified for single-level keys in test)
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          const keyPattern = new RegExp(`^\\s*${keyToRemove}\\s*:`)
          if (keyPattern.test(line)) {
            targetLineIndex = i
            break
          }
        }

        if (targetLineIndex !== -1) {
          linesToRemoveForKey.push(targetLineIndex)

          // Check if this is a multiline key-value pair
          const keyLine = lines[targetLineIndex]
          const trimmedKeyLine = keyLine.trim()

          // If key line ends with ":" (not complete value), it's likely multiline
          if (trimmedKeyLine.endsWith(':') && !trimmedKeyLine.includes('{') && !trimmedKeyLine.match(/:\s*['"`]/)) {
            // Find the value lines that belong to this key
            let currentLine = targetLineIndex + 1
            let foundValue = false

            while (currentLine < lines.length) {
              const line = lines[currentLine]
              const trimmed = line.trim()

              // Skip empty lines
              if (trimmed === '') {
                currentLine++
                continue
              }

              // Check if this line starts a new key (indicates end of current value)
              if (trimmed.match(/^\w+\s*:/))
                break

              // Check if this line is part of the value
              if (trimmed.startsWith('\'') || trimmed.startsWith('"') || trimmed.startsWith('`') || foundValue) {
                linesToRemoveForKey.push(currentLine)
                foundValue = true

                // Check if this line ends the value (ends with quote and comma/no comma)
                if ((trimmed.endsWith('\',') || trimmed.endsWith('",') || trimmed.endsWith('`,')
                  || trimmed.endsWith('\'') || trimmed.endsWith('"') || trimmed.endsWith('`'))
                && !trimmed.startsWith('//')) {
                  break
                }
              }
              else {
                break
              }

              currentLine++
            }
          }

          linesToRemove.push(...linesToRemoveForKey)
        }
      }

      // Remove duplicates and sort in reverse order
      const uniqueLinesToRemove = [...new Set(linesToRemove)].sort((a, b) => b - a)

      for (const lineIndex of uniqueLinesToRemove)
        lines.splice(lineIndex, 1)

      return lines.join('\n')
    }

    it('should remove single-line key-value pairs correctly', () => {
      const content = `const translation = {
  keepThis: 'This should stay',
  removeThis: 'This should be removed',
  alsoKeep: 'This should also stay',
}

export default translation`

      const result = removeExtraKeysFromFile(content, ['removeThis'])

      expect(result).toContain('keepThis: \'This should stay\'')
      expect(result).toContain('alsoKeep: \'This should also stay\'')
      expect(result).not.toContain('removeThis: \'This should be removed\'')
    })

    it('should remove multiline key-value pairs completely', () => {
      const content = `const translation = {
  keepThis: 'This should stay',
  removeMultiline:
    'This is a multiline value that should be removed completely',
  alsoKeep: 'This should also stay',
}

export default translation`

      const result = removeExtraKeysFromFile(content, ['removeMultiline'])

      expect(result).toContain('keepThis: \'This should stay\'')
      expect(result).toContain('alsoKeep: \'This should also stay\'')
      expect(result).not.toContain('removeMultiline:')
      expect(result).not.toContain('This is a multiline value that should be removed completely')
    })

    it('should handle mixed single-line and multiline removals', () => {
      const content = `const translation = {
  keepThis: 'Keep this',
  removeSingle: 'Remove this single line',
  removeMultiline:
    'Remove this multiline value',
  anotherMultiline:
    'Another multiline that spans multiple lines',
  keepAnother: 'Keep this too',
}

export default translation`

      const result = removeExtraKeysFromFile(content, ['removeSingle', 'removeMultiline', 'anotherMultiline'])

      expect(result).toContain('keepThis: \'Keep this\'')
      expect(result).toContain('keepAnother: \'Keep this too\'')
      expect(result).not.toContain('removeSingle:')
      expect(result).not.toContain('removeMultiline:')
      expect(result).not.toContain('anotherMultiline:')
      expect(result).not.toContain('Remove this single line')
      expect(result).not.toContain('Remove this multiline value')
      expect(result).not.toContain('Another multiline that spans multiple lines')
    })

    it('should properly detect multiline vs single-line patterns', () => {
      const multilineContent = `const translation = {
  singleLine: 'This is single line',
  multilineKey:
    'This is multiline',
  keyWithColon: 'Value with: colon inside',
  objectKey: {
    nested: 'value'
  },
}

export default translation`

      // Test that single line with colon in value is not treated as multiline
      const result1 = removeExtraKeysFromFile(multilineContent, ['keyWithColon'])
      expect(result1).not.toContain('keyWithColon:')
      expect(result1).not.toContain('Value with: colon inside')

      // Test that true multiline is handled correctly
      const result2 = removeExtraKeysFromFile(multilineContent, ['multilineKey'])
      expect(result2).not.toContain('multilineKey:')
      expect(result2).not.toContain('This is multiline')

      // Test that object key removal works (note: this is a simplified test)
      // In real scenario, object removal would be more complex
      const result3 = removeExtraKeysFromFile(multilineContent, ['objectKey'])
      expect(result3).not.toContain('objectKey: {')
      // Note: Our simplified test function doesn't handle nested object removal perfectly
      // This is acceptable as it's testing the main multiline string removal functionality
    })

    it('should handle real-world Polish translation structure', () => {
      const polishContent = `const translation = {
  createApp: 'UTWÓRZ APLIKACJĘ',
  newApp: {
    captionAppType: 'Jaki typ aplikacji chcesz stworzyć?',
    chatbotDescription:
      'Zbuduj aplikację opartą na czacie. Ta aplikacja używa formatu pytań i odpowiedzi.',
    agentDescription:
      'Zbuduj inteligentnego agenta, który może autonomicznie wybierać narzędzia.',
    basic: 'Podstawowy',
  },
}

export default translation`

      const result = removeExtraKeysFromFile(polishContent, ['captionAppType', 'chatbotDescription', 'agentDescription'])

      expect(result).toContain('createApp: \'UTWÓRZ APLIKACJĘ\'')
      expect(result).toContain('basic: \'Podstawowy\'')
      expect(result).not.toContain('captionAppType:')
      expect(result).not.toContain('chatbotDescription:')
      expect(result).not.toContain('agentDescription:')
      expect(result).not.toContain('Jaki typ aplikacji')
      expect(result).not.toContain('Zbuduj aplikację opartą na czacie')
      expect(result).not.toContain('Zbuduj inteligentnego agenta')
    })
  })

  describe('Performance and Scalability', () => {
    it('should handle large translation files efficiently', async () => {
      // Create a large translation file with 1000 keys
      const largeContent = `const translation = {
${Array.from({ length: 1000 }, (_, i) => `  key${i}: 'value${i}',`).join('\n')}
}

export default translation`

      fs.writeFileSync(path.join(testEnDir, 'large.ts'), largeContent)

      const startTime = Date.now()
      const keys = await getKeysFromLanguage('en-US')
      const endTime = Date.now()

      expect(keys.length).toBe(1000)
      expect(endTime - startTime).toBeLessThan(1000) // Should complete in under 1 second
    })

    it('should handle multiple translation files concurrently', async () => {
      // Create multiple files
      for (let i = 0; i < 10; i++) {
        const content = `const translation = {
  key${i}: 'value${i}',
  nested${i}: {
    subkey: 'subvalue'
  }
}

export default translation`
        fs.writeFileSync(path.join(testEnDir, `file${i}.ts`), content)
      }

      const startTime = Date.now()
      const keys = await getKeysFromLanguage('en-US')
      const endTime = Date.now()

      expect(keys.length).toBe(20) // 10 files * 2 keys each
      expect(endTime - startTime).toBeLessThan(500)
    })
  })

  describe('Unicode and Internationalization', () => {
    it('should handle Unicode characters in keys and values', async () => {
      const unicodeContent = `const translation = {
  '中文键': '中文值',
  'العربية': 'قيمة',
  'emoji_😀': 'value with emoji 🎉',
  'mixed_中文_English': 'mixed value'
}

export default translation`

      fs.writeFileSync(path.join(testEnDir, 'unicode.ts'), unicodeContent)

      const keys = await getKeysFromLanguage('en-US')

      expect(keys).toContain('unicode.中文键')
      expect(keys).toContain('unicode.العربية')
      expect(keys).toContain('unicode.emoji_😀')
      expect(keys).toContain('unicode.mixed_中文_English')
    })

    it('should handle RTL language files', async () => {
      const rtlContent = `const translation = {
  مرحبا: 'Hello',
  العالم: 'World',
  nested: {
    مفتاح: 'key'
  }
}

export default translation`

      fs.writeFileSync(path.join(testEnDir, 'rtl.ts'), rtlContent)

      const keys = await getKeysFromLanguage('en-US')

      expect(keys).toContain('rtl.مرحبا')
      expect(keys).toContain('rtl.العالم')
      expect(keys).toContain('rtl.nested.مفتاح')
    })
  })

  describe('Error Recovery', () => {
    it('should handle syntax errors in translation files gracefully', async () => {
      const invalidContent = `const translation = {
  validKey: 'valid value',
  invalidKey: 'missing quote,
  anotherKey: 'another value'
}

export default translation`

      fs.writeFileSync(path.join(testEnDir, 'invalid.ts'), invalidContent)

      await expect(getKeysFromLanguage('en-US')).rejects.toThrow()
    })
  })
})
