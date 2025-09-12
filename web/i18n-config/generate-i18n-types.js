#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { camelCase } = require('lodash')

// Import the NAMESPACES array from i18next-config.ts
function getNamespacesFromConfig() {
  const configPath = path.join(__dirname, 'i18next-config.ts')
  const configContent = fs.readFileSync(configPath, 'utf8')
  
  // Extract NAMESPACES array using regex
  const namespacesMatch = configContent.match(/const NAMESPACES = \[([\s\S]*?)\]/)
  if (!namespacesMatch) {
    throw new Error('Could not find NAMESPACES array in i18next-config.ts')
  }
  
  // Parse the namespaces
  const namespacesStr = namespacesMatch[1]
  const namespaces = namespacesStr
    .split(',')
    .map(line => line.trim())
    .filter(line => line.startsWith("'") || line.startsWith('"'))
    .map(line => line.slice(1, -1)) // Remove quotes
  
  return namespaces
}

function generateTypeDefinitions(namespaces) {
  const header = `// TypeScript type definitions for Dify's i18next configuration
// This file is auto-generated. Do not edit manually.
// To regenerate, run: pnpm run gen:i18n-types
import 'react-i18next'

// Extract types from translation files using typeof import pattern`

  // Generate individual type definitions
  const typeDefinitions = namespaces.map(namespace => {
    const typeName = camelCase(namespace).replace(/^\w/, c => c.toUpperCase()) + 'Messages'
    return `type ${typeName} = typeof import('../i18n/en-US/${namespace}').default`
  }).join('\n')

  // Generate Messages interface
  const messagesInterface = `
// Complete type structure that matches i18next-config.ts camelCase conversion
export type Messages = {
${namespaces.map(namespace => {
    const camelCased = camelCase(namespace)
    const typeName = camelCase(namespace).replace(/^\w/, c => c.toUpperCase()) + 'Messages'
    return `  ${camelCased}: ${typeName};`
  }).join('\n')}
}`

  const utilityTypes = `
// Utility type to flatten nested object keys into dot notation
type FlattenKeys<T> = T extends object 
  ? {
      [K in keyof T]: T[K] extends object 
        ? \`\${K & string}.\${FlattenKeys<T[K]> & string}\`
        : \`\${K & string}\`
    }[keyof T]
  : never

export type ValidTranslationKeys = FlattenKeys<Messages>`

  const moduleDeclarations = `
// Extend react-i18next with Dify's type structure
declare module 'react-i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: Messages;
    };
  }
}

// Extend i18next for complete type safety
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: Messages;
    };
  }
}`

  return [header, typeDefinitions, messagesInterface, utilityTypes, moduleDeclarations].join('\n\n')
}

function main() {
  const args = process.argv.slice(2)
  const checkMode = args.includes('--check')
  
  try {
    console.log('📦 Generating i18n type definitions...')
    
    // Get namespaces from config
    const namespaces = getNamespacesFromConfig()
    console.log(`✅ Found ${namespaces.length} namespaces`)
    
    // Generate type definitions
    const typeDefinitions = generateTypeDefinitions(namespaces)
    
    const outputPath = path.join(__dirname, '../types/i18n.d.ts')
    
    if (checkMode) {
      // Check mode: compare with existing file
      if (!fs.existsSync(outputPath)) {
        console.error('❌ Type definitions file does not exist')
        process.exit(1)
      }
      
      const existingContent = fs.readFileSync(outputPath, 'utf8')
      if (existingContent.trim() !== typeDefinitions.trim()) {
        console.error('❌ Type definitions are out of sync')
        console.error('   Run: pnpm run gen:i18n-types')
        process.exit(1)
      }
      
      console.log('✅ Type definitions are in sync')
    } else {
      // Generate mode: write file
      fs.writeFileSync(outputPath, typeDefinitions)
      console.log(`✅ Generated type definitions: ${outputPath}`)
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}