// src/lsp/html/setup.ts
import * as client from "../client.mjs";
async function setup(monaco, languageId, languageSettings, formattingOptions, workspace) {
  const { editor, languages } = monaco;
  const { tabSize, insertSpaces, insertFinalNewline, trimFinalNewlines } = formattingOptions ?? {};
  const dataProviders = { ...languageSettings?.dataProviders };
  if (languageSettings?.customTags) {
    dataProviders["#custom-tags"] = { version: 1.1, tags: languageSettings.customTags };
  }
  const createData = {
    suggest: {
      attributeDefaultValue: languageSettings?.attributeDefaultValue,
      hideAutoCompleteProposals: languageSettings?.hideAutoCompleteProposals,
      hideEndTagSuggestions: languageSettings?.hideEndTagSuggestions
    },
    format: {
      tabSize,
      insertSpaces,
      endWithNewline: insertFinalNewline,
      preserveNewLines: !trimFinalNewlines,
      maxPreserveNewLines: 1,
      indentInnerHtml: false,
      indentHandlebars: false,
      unformatted: 'default": "a, abbr, acronym, b, bdo, big, br, button, cite, code, dfn, em, i, img, input, kbd, label, map, object, q, samp, select, small, span, strong, sub, sup, textarea, tt, var',
      contentUnformatted: "pre",
      // extraLiners: "head, body, /html",
      extraLiners: "",
      wrapAttributes: "auto"
    },
    data: {
      useDefaultDataProvider: languageSettings?.useDefaultDataProvider ?? true,
      dataProviders
    },
    fs: workspace ? await client.walkFS(workspace.fs, "/") : void 0
  };
  const htmlWorker = editor.createWebWorker({
    worker: getWorker(createData),
    host: client.createHost(workspace)
  });
  const workerWithEmbeddedLanguages = client.createWorkerWithEmbeddedLanguages(htmlWorker);
  client.init(monaco);
  client.registerEmbedded(languageId, workerWithEmbeddedLanguages, ["css", "javascript", "importmap"]);
  client.registerBasicFeatures(
    languageId,
    workerWithEmbeddedLanguages,
    ["<", "/", "=", '"'],
    workspace,
    languageSettings?.diagnosticsOptions
  );
  client.registerAutoComplete(languageId, workerWithEmbeddedLanguages, [">", "/", "="]);
  client.registerColorPresentation(languageId, workerWithEmbeddedLanguages);
  client.registerDocumentLinks(languageId, workerWithEmbeddedLanguages);
  if (languageSettings?.importMapCodeLens ?? true) {
    languages.registerCodeLensProvider(languageId, {
      provideCodeLenses: (model, _token) => {
        const m = model.findNextMatch(
          `<script\\s[^>]*?type=['"]importmap['"]`,
          { lineNumber: 4, column: 1 },
          true,
          false,
          null,
          false
        );
        if (m) {
          const m2 = model.findNextMatch(
            `"imports":\\s*\\{`,
            m.range.getEndPosition(),
            true,
            false,
            null,
            false
          );
          return {
            lenses: [
              {
                range: (m2 ?? m).range,
                command: {
                  id: "importmap:add-import",
                  title: "$(sparkle-filled) Add import from esm.sh",
                  tooltip: "Add Import",
                  arguments: [model]
                }
              }
            ],
            dispose: () => {
            }
          };
        }
      }
    });
  }
}
function createWebWorker() {
  const workerUrl = new URL("./worker.mjs", import.meta.url);
  if (workerUrl.origin !== location.origin) {
    return new Worker(
      URL.createObjectURL(new Blob([`import "${workerUrl.href}"`], { type: "application/javascript" })),
      { type: "module", name: "html-worker" }
    );
  }
  return new Worker(workerUrl, { type: "module", name: "html-worker" });
}
function getWorker(createData) {
  const worker = createWebWorker();
  worker.postMessage(createData);
  return worker;
}
export {
  setup
};
