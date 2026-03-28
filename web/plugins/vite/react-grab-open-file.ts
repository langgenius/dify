import type { Plugin } from 'vite'
import { injectClientSnippet, normalizeViteModuleId } from './utils'

type ReactGrabOpenFilePluginOptions = {
  injectTarget: string
  projectRoot: string
}

export const reactGrabOpenFilePlugin = ({
  injectTarget,
  projectRoot,
}: ReactGrabOpenFilePluginOptions): Plugin => {
  const reactGrabOpenFileClientMarker = 'react-grab-open-file-client'
  const reactGrabOpenFileClientSnippet = `/* ${reactGrabOpenFileClientMarker} */
if (typeof window !== 'undefined') {
  const projectRoot = ${JSON.stringify(projectRoot)};
  const pluginName = 'dify-vite-open-file';
  const rootRelativeSourcePathPattern = /^\\/(?!@|node_modules)(?:.+)\\.(?:[cm]?[jt]sx?|mdx?)$/;

  const normalizeProjectRoot = (input) => {
    return input.endsWith('/') ? input.slice(0, -1) : input;
  };

  const resolveFilePath = (filePath) => {
    if (filePath.startsWith('/@fs/')) {
      return filePath.slice('/@fs'.length);
    }

    if (!rootRelativeSourcePathPattern.test(filePath)) {
      return filePath;
    }

    const normalizedProjectRoot = normalizeProjectRoot(projectRoot);
    if (filePath.startsWith(normalizedProjectRoot)) {
      return filePath;
    }

    return \`\${normalizedProjectRoot}\${filePath}\`;
  };

  const registerPlugin = () => {
    if (window.__DIFY_REACT_GRAB_OPEN_FILE_PLUGIN_REGISTERED__) {
      return;
    }

    const reactGrab = window.__REACT_GRAB__;
    if (!reactGrab) {
      return;
    }

    reactGrab.registerPlugin({
      name: pluginName,
      hooks: {
        onOpenFile(filePath, lineNumber) {
          const params = new URLSearchParams({
            file: resolveFilePath(filePath),
            column: '1',
          });

          if (lineNumber) {
            params.set('line', String(lineNumber));
          }

          void fetch(\`/__open-in-editor?\${params.toString()}\`);
          return true;
        },
      },
    });

    window.__DIFY_REACT_GRAB_OPEN_FILE_PLUGIN_REGISTERED__ = true;
  };

  registerPlugin();
  window.addEventListener('react-grab:init', registerPlugin);
}
`

  return {
    name: 'react-grab-open-file',
    apply: 'serve',
    transform(code, id) {
      const cleanId = normalizeViteModuleId(id)
      if (cleanId !== injectTarget)
        return null

      const nextCode = injectClientSnippet(code, reactGrabOpenFileClientMarker, reactGrabOpenFileClientSnippet)
      if (nextCode === code)
        return null
      return { code: nextCode, map: null }
    },
  }
}
