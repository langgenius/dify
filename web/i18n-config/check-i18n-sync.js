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

function getNamespacesFromTypes() {
  const typesPath = path.join(__dirname, '../types/i18n.d.ts')
  
  if (!fs.existsSync(typesPath)) {
    return null
  }
  
  const typesContent = fs.readFileSync(typesPath, 'utf8')
  
  // Extract namespaces from Messages type
  const messagesMatch = typesContent.match(/export type Messages = \{([\s\S]*?)\}/)
  if (!messagesMatch) {
    return null
  }
  
  // Parse the properties
  const propertiesStr = messagesMatch[1]
  const properties = propertiesStr
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.includes(':'))
    .map(line => line.split(':')[0].trim())
    .filter(prop => prop.length > 0)
  
  return properties
}

function main() {
  try {
    console.log('🔍 Checking i18n types synchronization...')
    
    // Get namespaces from config
    const configNamespaces = getNamespacesFromConfig()
    console.log(`📦 Found ${configNamespaces.length} namespaces in config`)
    
    // Convert to camelCase for comparison
    const configCamelCase = configNamespaces.map(ns => camelCase(ns)).sort()
    
    // Get namespaces from type definitions
    const typeNamespaces = getNamespacesFromTypes()
    
    if (!typeNamespaces) {
      console.error('❌ Type definitions file not found or invalid')
      console.error('   Run: pnpm run gen:i18n-types')
      process.exit(1)
    }
    
    console.log(`🔧 Found ${typeNamespaces.length} namespaces in types`)
    
    const typeCamelCase = typeNamespaces.sort()
    
    // Compare arrays
    const configSet = new Set(configCamelCase)
    const typeSet = new Set(typeCamelCase)
    
    // Find missing in types
    const missingInTypes = configCamelCase.filter(ns => !typeSet.has(ns))
    
    // Find extra in types
    const extraInTypes = typeCamelCase.filter(ns => !configSet.has(ns))
    
    let hasErrors = false
    
    if (missingInTypes.length > 0) {
      hasErrors = true
      console.error('❌ Missing in type definitions:')
      missingInTypes.forEach(ns => console.error(`   - ${ns}`))
    }
    
    if (extraInTypes.length > 0) {
      hasErrors = true
      console.error('❌ Extra in type definitions:')
      extraInTypes.forEach(ns => console.error(`   - ${ns}`))
    }
    
    if (hasErrors) {
      console.error('\n💡 To fix synchronization issues:')
      console.error('   Run: pnpm run gen:i18n-types')
      process.exit(1)
    }
    
    console.log('✅ i18n types are synchronized')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}