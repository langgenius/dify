export function cleanUpSvgCode(svgCode: string): string {
  return svgCode.replaceAll('<br>', '<br/>')
}

export const sanitizeMermaidCode = (mermaidCode: string): string => {
  if (!mermaidCode || typeof mermaidCode !== 'string')
    return ''

  return mermaidCode
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart()

      // Mermaid directives can override config; treat as untrusted in chat context.
      if (trimmed.startsWith('%%{'))
        return false

      // Mermaid click directives can create JS callbacks/links inside rendered SVG.
      if (trimmed.startsWith('click '))
        return false

      return true
    })
    .join('\n')
}

/**
 * Prepares mermaid code for rendering by sanitizing common syntax issues.
 * @param {string} mermaidCode - The mermaid code to prepare
 * @param {'classic' | 'handDrawn'} style - The rendering style
 * @returns {string} - The prepared mermaid code
 */
export const prepareMermaidCode = (mermaidCode: string, style: 'classic' | 'handDrawn'): string => {
  if (!mermaidCode || typeof mermaidCode !== 'string')
    return ''

  let code = sanitizeMermaidCode(mermaidCode.trim())

  // Convenience: Basic BR replacement. This is a common and safe operation.
  code = code.replace(/<br\s*\/?>/g, '\n')

  let finalCode = code

  // Hand-drawn style requires some specific clean-up.
  if (style === 'handDrawn') {
    finalCode = finalCode
      .replace(/style\s+[^\n]+/g, '')
      .replace(/linkStyle\s+[^\n]+/g, '')
      .replace(/^flowchart/, 'graph')
      .replace(/class="[^"]*"/g, '')
      .replace(/fill="[^"]*"/g, '')
      .replace(/stroke="[^"]*"/g, '')

    // Ensure hand-drawn style charts always start with graph
    if (!finalCode.startsWith('graph') && !finalCode.startsWith('flowchart'))
      finalCode = `graph TD\n${finalCode}`
  }

  return finalCode
}

/**
 * Converts SVG to base64 string for image rendering
 */
export function svgToBase64(svgGraph: string): Promise<string> {
  if (!svgGraph)
    return Promise.resolve('')

  try {
    // Ensure SVG has correct XML declaration
    if (!svgGraph.includes('<?xml'))
      svgGraph = `<?xml version="1.0" encoding="UTF-8"?>${svgGraph}`

    const blob = new Blob([new TextEncoder().encode(svgGraph)], { type: 'image/svg+xml;charset=utf-8' })
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }
  catch {
    return Promise.resolve('')
  }
}

/**
 * Processes SVG for theme styling
 */
export function processSvgForTheme(
  svg: string,
  isDark: boolean,
  isHandDrawn: boolean,
  themes: {
    light: any
    dark: any
  },
): string {
  let processedSvg = svg

  if (isDark) {
    processedSvg = processedSvg
      .replace(/style="fill: ?#000000"/g, 'style="fill: #e2e8f0"')
      .replace(/style="stroke: ?#000000"/g, 'style="stroke: #94a3b8"')
      .replace(/<rect [^>]*fill="#ffffff"/g, '<rect $& fill="#1e293b"')

    if (isHandDrawn) {
      processedSvg = processedSvg
        .replace(/fill="#[a-fA-F0-9]{6}"/g, `fill="${themes.dark.nodeColors[0].bg}"`)
        .replace(/stroke="#[a-fA-F0-9]{6}"/g, `stroke="${themes.dark.connectionColor}"`)
        .replace(/stroke-width="1"/g, 'stroke-width="1.5"')
    }
    else {
      let i = 0
      const nodeColorRegex = /fill="#[a-fA-F0-9]{6}"[^>]*class="node-[^"]*"/g
      processedSvg = processedSvg.replace(nodeColorRegex, (match: string) => {
        const colorIndex = i % themes.dark.nodeColors.length
        i++
        return match.replace(/fill="#[a-fA-F0-9]{6}"/, `fill="${themes.dark.nodeColors[colorIndex].bg}"`)
      })

      processedSvg = processedSvg
        .replace(/<path [^>]*stroke="#[a-fA-F0-9]{6}"/g, `<path stroke="${themes.dark.connectionColor}" stroke-width="1.5"`)
        .replace(/<(line|polyline) [^>]*stroke="#[a-fA-F0-9]{6}"/g, `<$1 stroke="${themes.dark.connectionColor}" stroke-width="1.5"`)
    }
  }
  else {
    if (isHandDrawn) {
      processedSvg = processedSvg
        .replace(/fill="#[a-fA-F0-9]{6}"/g, `fill="${themes.light.nodeColors[0].bg}"`)
        .replace(/stroke="#[a-fA-F0-9]{6}"/g, `stroke="${themes.light.connectionColor}"`)
        .replace(/stroke-width="1"/g, 'stroke-width="1.5"')
    }
    else {
      let i = 0
      const nodeColorRegex = /fill="#[a-fA-F0-9]{6}"[^>]*class="node-[^"]*"/g
      processedSvg = processedSvg.replace(nodeColorRegex, (match: string) => {
        const colorIndex = i % themes.light.nodeColors.length
        i++
        return match.replace(/fill="#[a-fA-F0-9]{6}"/, `fill="${themes.light.nodeColors[colorIndex].bg}"`)
      })

      processedSvg = processedSvg
        .replace(/<path [^>]*stroke="#[a-fA-F0-9]{6}"/g, `<path stroke="${themes.light.connectionColor}"`)
        .replace(/<(line|polyline) [^>]*stroke="#[a-fA-F0-9]{6}"/g, `<$1 stroke="${themes.light.connectionColor}"`)
    }
  }

  return processedSvg
}

/**
 * Checks if mermaid code is complete and valid
 */
export function isMermaidCodeComplete(code: string): boolean {
  if (!code || code.trim().length === 0)
    return false

  try {
    const trimmedCode = code.trim()

    // Special handling for gantt charts
    if (trimmedCode.startsWith('gantt')) {
      // For gantt charts, check if it has at least a title and one task
      const lines = trimmedCode.split('\n').filter(line => line.trim().length > 0)
      return lines.length >= 3
    }

    // Special handling for mindmaps
    if (trimmedCode.startsWith('mindmap')) {
      // For mindmaps, check if it has at least a root node
      const lines = trimmedCode.split('\n').filter(line => line.trim().length > 0)
      return lines.length >= 2
    }

    // Check for basic syntax structure
    const hasValidStart = /^(graph|flowchart|sequenceDiagram|classDiagram|classDef|class|stateDiagram|gantt|pie|er|journey|requirementDiagram|mindmap)/.test(trimmedCode)

    // The balanced bracket check was too strict and produced false negatives for valid
    // mermaid syntax like the asymmetric shape `A>B]`. Relying on Mermaid's own
    // parser is more robust.
    const isBalanced = true

    // Check for common syntax errors
    const hasNoSyntaxErrors = !trimmedCode.includes('undefined')
      && !trimmedCode.includes('[object Object]')
      && trimmedCode.split('\n').every(line =>
        !(line.includes('-->') && !line.match(/\S+\s*-->\s*\S+/)))

    return hasValidStart && isBalanced && hasNoSyntaxErrors
  }
  catch (error) {
    console.error('Mermaid code validation error:', error)
    return false
  }
}

/**
 * Helper to wait for DOM element with retry mechanism
 */
export function waitForDOMElement(callback: () => Promise<any>, maxAttempts = 3, delay = 100): Promise<any> {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const tryRender = async () => {
      try {
        resolve(await callback())
      }
      catch (error) {
        attempts++
        if (attempts < maxAttempts)
          setTimeout(tryRender, delay)
        else
          reject(error)
      }
    }
    tryRender()
  })
}
