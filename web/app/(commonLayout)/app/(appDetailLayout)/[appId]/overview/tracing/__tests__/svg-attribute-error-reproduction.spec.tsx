import React from 'react'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom'
import { OpikIconBig } from '@/app/components/base/icons/src/public/tracing'

// Mock dependencies to isolate the SVG rendering issue
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('SVG Attribute Error Reproduction', () => {
  // Capture console errors
  const originalError = console.error
  let errorMessages: string[] = []

  beforeEach(() => {
    errorMessages = []
    console.error = jest.fn((message) => {
      errorMessages.push(message)
      originalError(message)
    })
  })

  afterEach(() => {
    console.error = originalError
  })

  it('should reproduce inkscape attribute errors when rendering OpikIconBig', () => {
    console.log('\n=== TESTING OpikIconBig SVG ATTRIBUTE ERRORS ===')

    // Test multiple renders to check for inconsistency
    for (let i = 0; i < 5; i++) {
      console.log(`\nRender attempt ${i + 1}:`)

      const { unmount } = render(<OpikIconBig />)

      // Check for specific inkscape attribute errors
      const inkscapeErrors = errorMessages.filter(msg =>
        typeof msg === 'string' && msg.includes('inkscape'),
      )

      if (inkscapeErrors.length > 0) {
        console.log(`Found ${inkscapeErrors.length} inkscape errors:`)
        inkscapeErrors.forEach((error, index) => {
          console.log(`  ${index + 1}. ${error.substring(0, 100)}...`)
        })
      }
      else {
        console.log('No inkscape errors found in this render')
      }

      unmount()

      // Clear errors for next iteration
      errorMessages = []
    }
  })

  it('should analyze the SVG structure causing the errors', () => {
    console.log('\n=== ANALYZING SVG STRUCTURE ===')

    // Import the JSON data directly
    const iconData = require('@/app/components/base/icons/src/public/tracing/OpikIconBig.json')

    console.log('Icon structure analysis:')
    console.log('- Root element:', iconData.icon.name)
    console.log('- Children count:', iconData.icon.children?.length || 0)

    // Find problematic elements
    const findProblematicElements = (node: any, path = '') => {
      const problematicElements: any[] = []

      if (node.name && (node.name.includes(':') || node.name.startsWith('sodipodi'))) {
        problematicElements.push({
          path,
          name: node.name,
          attributes: Object.keys(node.attributes || {}),
        })
      }

      // Check attributes for inkscape/sodipodi properties
      if (node.attributes) {
        const problematicAttrs = Object.keys(node.attributes).filter(attr =>
          attr.startsWith('inkscape:') || attr.startsWith('sodipodi:'),
        )

        if (problematicAttrs.length > 0) {
          problematicElements.push({
            path,
            name: node.name,
            problematicAttributes: problematicAttrs,
          })
        }
      }

      if (node.children) {
        node.children.forEach((child: any, index: number) => {
          problematicElements.push(
            ...findProblematicElements(child, `${path}/${node.name}[${index}]`),
          )
        })
      }

      return problematicElements
    }

    const problematicElements = findProblematicElements(iconData.icon, 'root')

    console.log(`\n🚨 Found ${problematicElements.length} problematic elements:`)
    problematicElements.forEach((element, index) => {
      console.log(`\n${index + 1}. Element: ${element.name}`)
      console.log(`   Path: ${element.path}`)
      if (element.problematicAttributes)
        console.log(`   Problematic attributes: ${element.problematicAttributes.join(', ')}`)
    })
  })

  it('should test the normalizeAttrs function behavior', () => {
    console.log('\n=== TESTING normalizeAttrs FUNCTION ===')

    const { normalizeAttrs } = require('@/app/components/base/icons/utils')

    const testAttributes = {
      'inkscape:showpageshadow': '2',
      'inkscape:pageopacity': '0.0',
      'inkscape:pagecheckerboard': '0',
      'inkscape:deskcolor': '#d1d1d1',
      'sodipodi:docname': 'opik-icon-big.svg',
      'xmlns:inkscape': 'https://www.inkscape.org/namespaces/inkscape',
      'xmlns:sodipodi': 'https://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd',
      'xmlns:svg': 'https://www.w3.org/2000/svg',
      'data-name': 'Layer 1',
      'normal-attr': 'value',
      'class': 'test-class',
    }

    console.log('Input attributes:', Object.keys(testAttributes))

    const normalized = normalizeAttrs(testAttributes)

    console.log('Normalized attributes:', Object.keys(normalized))
    console.log('Normalized values:', normalized)

    // Check if problematic attributes are still present
    const problematicKeys = Object.keys(normalized).filter(key =>
      key.toLowerCase().includes('inkscape') || key.toLowerCase().includes('sodipodi'),
    )

    if (problematicKeys.length > 0)
      console.log(`🚨 PROBLEM: Still found problematic attributes: ${problematicKeys.join(', ')}`)
    else
      console.log('✅ No problematic attributes found after normalization')
  })
})
