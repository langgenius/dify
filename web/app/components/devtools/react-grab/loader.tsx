import Script from 'next/script'
import { IS_DEV } from '@/config'

const reactGrabProjectRoot = process.cwd()

const reactGrabOpenFileRegistrationScript = `
(() => {
  const projectRoot = ${JSON.stringify(reactGrabProjectRoot)};
  const pluginName = 'dify-vite-open-file';
  const rootRelativeSourcePathPattern = /^\\/(?!@|node_modules)(?:.+)\\.(?:[cm]?[jt]sx?|mdx?)$/;

  const normalizeProjectRoot = (input) => {
    return input.endsWith('/') ? input.slice(0, -1) : input;
  };

  const resolveFilePath = (filePath) => {
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
})();
`

export function ReactGrabLoader() {
  if (!IS_DEV)
    return null

  return (
    <>
      <Script
        src="//unpkg.com/react-grab/dist/index.global.js"
        crossOrigin="anonymous"
        strategy="beforeInteractive"
      />
      <Script
        id="react-grab-open-file-register"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: reactGrabOpenFileRegistrationScript,
        }}
      />
    </>
  )
}
