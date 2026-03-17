// src/ssr/index.ts
import { setDefaultWasmLoader } from "../shiki.mjs";
import { getWasmInstance } from "../shiki-wasm.mjs";

// src/ssr/ssr.ts
import { getLanguageIdFromPath, initShiki } from "../shiki.mjs";
import { render } from "../shiki.mjs";
var ssrHighlighter;
async function renderToString(input, options) {
  const { language, theme, shiki } = options ?? {};
  const filename = typeof input === "string" ? void 0 : input.filename;
  const highlighter = await (ssrHighlighter ?? (ssrHighlighter = initShiki(shiki)));
  const promises = [];
  if (theme && !highlighter.getLoadedThemes().includes(theme)) {
    console.info(`[modern-monaco] Loading theme '${theme}' from CDN...`);
    promises.push(highlighter.loadThemeFromCDN(theme));
  }
  if (language || filename) {
    const languageId = language ?? getLanguageIdFromPath(filename);
    if (languageId && !highlighter.getLoadedLanguages().includes(languageId)) {
      console.info(
        `[modern-monaco] Loading grammar '${languageId}' from CDN...`
      );
      promises.push(highlighter.loadGrammarFromCDN(languageId));
    }
  }
  if (promises.length > 0) {
    await Promise.all(promises);
  }
  return render(highlighter, input, options);
}
async function renderToWebComponent(input, options) {
  const prerender = await renderToString(input, options);
  return '<monaco-editor><script type="application/json" class="monaco-editor-options">' + JSON.stringify([input, options]).replaceAll("/", "\\/") + '<\/script><div class="monaco-editor-prerender" style="width:100%;height:100%;">' + prerender + "</div></monaco-editor>";
}

// src/ssr/index.ts
setDefaultWasmLoader(getWasmInstance);
export {
  renderToString,
  renderToWebComponent
};
