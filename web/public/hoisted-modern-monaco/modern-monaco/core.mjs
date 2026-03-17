// package.json
var version = "0.4.0";

// src/core.ts
import { getExtnameFromLanguageId, getLanguageIdFromPath, grammars, initShiki, setDefaultWasmLoader, themes } from "./shiki.mjs";
import { initShikiMonacoTokenizer, registerShikiMonacoTokenizer } from "./shiki.mjs";
import { render } from "./shiki.mjs";
import { getWasmInstance } from "./shiki-wasm.mjs";
import { NotFoundError, Workspace } from "./workspace.mjs";
import { debunce, decode, isDigital } from "./util.mjs";
var editorProps = [
  "autoDetectHighContrast",
  "automaticLayout",
  "contextmenu",
  "cursorBlinking",
  "cursorSmoothCaretAnimation",
  "cursorStyle",
  "cursorWidth",
  "fontFamily",
  "fontLigatures",
  "fontSize",
  "fontVariations",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "lineNumbers",
  "lineNumbersMinChars",
  "matchBrackets",
  "minimap",
  "mouseStyle",
  "multiCursorModifier",
  "padding",
  "readOnly",
  "readOnlyMessage",
  "rulers",
  "scrollbar",
  "stickyScroll",
  "tabSize",
  "theme",
  "wordWrap"
];
var errors = {
  NotFound: NotFoundError
};
var syntaxes = [];
var lspProviders = {};
var getAttr = (el, name) => el.getAttribute(name);
var setStyle = (el, style) => Object.assign(el.style, style);
async function init(options) {
  const langs = (options?.langs ?? []).concat(syntaxes);
  const shiki = await initShiki({ ...options, langs });
  return loadMonaco(shiki, options?.workspace, options?.lsp);
}
function lazy(options) {
  if (!customElements.get("monaco-editor")) {
    let monacoPromise = null;
    customElements.define(
      "monaco-editor",
      class extends HTMLElement {
        async connectedCallback() {
          const workspace = options?.workspace;
          const renderOptions = {};
          for (const attrName of this.getAttributeNames()) {
            const key = editorProps.find((k) => k.toLowerCase() === attrName);
            if (key) {
              let value = getAttr(this, attrName);
              if (value === "") {
                value = key === "minimap" || key === "stickyScroll" ? { enabled: true } : true;
              } else {
                value = value.trim();
                if (value === "true") {
                  value = true;
                } else if (value === "false") {
                  value = false;
                } else if (value === "null") {
                  value = null;
                } else if (/^\d+$/.test(value)) {
                  value = Number(value);
                } else if (/^\{.+\}$/.test(value)) {
                  try {
                    value = JSON.parse(value);
                  } catch (error) {
                    value = void 0;
                  }
                }
              }
              if (key === "padding") {
                if (typeof value === "number") {
                  value = { top: value, bottom: value };
                } else if (/^\d+\s+\d+$/.test(value)) {
                  const [top, bottom] = value.split(/\s+/);
                  if (top && bottom) {
                    value = { top: Number(top), bottom: Number(bottom) };
                  }
                } else {
                  value = void 0;
                }
              }
              if (key === "wordWrap" && (value === "on" || value === true)) {
                value = "on";
              }
              if (value !== void 0) {
                renderOptions[key] = value;
              }
            }
          }
          let filename;
          let code;
          const firstEl = this.firstElementChild;
          if (firstEl && firstEl.tagName === "SCRIPT" && firstEl.className === "monaco-editor-options") {
            try {
              const v = JSON.parse(firstEl.textContent);
              if (Array.isArray(v) && v.length === 2) {
                const [input, opts] = v;
                Object.assign(renderOptions, opts);
                if (opts.fontDigitWidth) {
                  Reflect.set(globalThis, "__monaco_maxDigitWidth", opts.fontDigitWidth);
                }
                if (typeof input === "string") {
                  code = input;
                } else {
                  filename = input.filename;
                  code = input.code;
                }
              }
            } catch {
            }
            firstEl.remove();
          }
          setStyle(this, { display: "block", position: "relative" });
          let widthAttr = getAttr(this, "width");
          let heightAttr = getAttr(this, "height");
          if (isDigital(widthAttr) && isDigital(heightAttr)) {
            const width = Number(widthAttr);
            const height = Number(heightAttr);
            setStyle(this, { width: width + "px", height: height + "px" });
            renderOptions.dimension = { width, height };
          } else {
            if (isDigital(widthAttr)) {
              widthAttr += "px";
            }
            if (isDigital(heightAttr)) {
              heightAttr += "px";
            }
            this.style.width ||= widthAttr ?? "100%";
            this.style.height ||= heightAttr ?? "100%";
          }
          const containerEl = document.createElement("div");
          containerEl.className = "monaco-editor-container";
          setStyle(containerEl, { width: "100%", height: "100%" });
          this.appendChild(containerEl);
          if (!filename && workspace) {
            if (workspace.history.state.current) {
              filename = workspace.history.state.current;
            } else if (workspace.entryFile) {
              filename = workspace.entryFile;
              workspace.history.replace(filename);
            } else {
              const rootFiles = (await workspace.fs.readDirectory("/")).filter(([name, type]) => type === 1).map(([name]) => name);
              filename = rootFiles.includes("index.html") ? "index.html" : rootFiles[0];
              if (filename) {
                workspace.history.replace(filename);
              }
            }
          }
          const langs = (options?.langs ?? []).concat(syntaxes);
          if (renderOptions.language || filename) {
            const lang = renderOptions.language ?? getLanguageIdFromPath(filename) ?? "plaintext";
            if (!syntaxes.find((s) => s.name === lang)) {
              langs.push(lang);
            }
          }
          let theme = options?.theme ?? renderOptions.theme;
          if (typeof theme === "string") {
            theme = theme.toLowerCase().replace(/ +/g, "-");
          }
          const highlighter = await initShiki({ ...options, theme, langs });
          renderOptions.theme = highlighter.getLoadedThemes()[0];
          let prerenderEl;
          for (const el of this.children) {
            if (el.className === "monaco-editor-prerender") {
              prerenderEl = el;
              break;
            }
          }
          if (!prerenderEl && filename && workspace) {
            try {
              const code2 = await workspace.fs.readFile(filename);
              const language = getLanguageIdFromPath(filename);
              prerenderEl = containerEl.cloneNode(true);
              prerenderEl.className = "monaco-editor-prerender";
              prerenderEl.innerHTML = render(highlighter, decode(code2), { ...renderOptions, language });
            } catch (error) {
              if (error instanceof NotFoundError) {
              } else {
                throw error;
              }
            }
          }
          if (prerenderEl) {
            setStyle(prerenderEl, { position: "absolute", top: "0", left: "0" });
            this.appendChild(prerenderEl);
            if (filename && workspace) {
              const viewState = await workspace.viewState.get(filename);
              const scrollTop = viewState?.viewState.scrollTop ?? 0;
              if (scrollTop) {
                const mockEl = prerenderEl.querySelector(".mock-monaco-editor");
                if (mockEl) {
                  mockEl.scrollTop = scrollTop;
                }
              }
            }
          }
          {
            const monaco = await (monacoPromise ?? (monacoPromise = loadMonaco(highlighter, workspace, options?.lsp)));
            const editor = monaco.editor.create(containerEl, renderOptions);
            if (workspace) {
              const storeViewState = () => {
                const currentModel = editor.getModel();
                if (currentModel?.uri.scheme === "file") {
                  const state = editor.saveViewState();
                  if (state) {
                    state.viewState.scrollTop ??= editor.getScrollTop();
                    workspace.viewState.save(currentModel.uri.toString(), Object.freeze(state));
                  }
                }
              };
              editor.onDidChangeCursorSelection(debunce(storeViewState, 500));
              editor.onDidScrollChange(debunce(storeViewState, 500));
              workspace.history.onChange((state) => {
                if (editor.getModel()?.uri.toString() !== state.current) {
                  workspace._openTextDocument(monaco, editor, state.current);
                }
              });
            }
            if (filename && workspace) {
              try {
                const model = await workspace._openTextDocument(monaco, editor, filename);
                if (code && code !== model.getValue()) {
                  model.setValue(code);
                }
              } catch (error) {
                if (error instanceof NotFoundError) {
                  if (code) {
                    const dirname = filename.split("/").slice(0, -1).join("/");
                    if (dirname) {
                      await workspace.fs.createDirectory(dirname);
                    }
                    await workspace.fs.writeFile(filename, code);
                    workspace._openTextDocument(monaco, editor, filename);
                  } else {
                    editor.setModel(monaco.editor.createModel(""));
                  }
                } else {
                  throw error;
                }
              }
            } else if (code && (renderOptions.language || filename)) {
              const modelUri = filename ? monaco.Uri.file(filename) : void 0;
              let model = modelUri ? monaco.editor.getModel(modelUri) : null;
              if (!model) {
                model = monaco.editor.createModel(code, renderOptions.language, modelUri);
              } else if (code !== model.getValue()) {
                model.setValue(code);
              }
              editor.setModel(model);
            } else {
              editor.setModel(monaco.editor.createModel(""));
            }
            if (prerenderEl) {
              setTimeout(() => {
                const animate = prerenderEl.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
                if (animate) {
                  animate.finished.then(() => prerenderEl.remove());
                } else {
                  setTimeout(() => prerenderEl.remove(), 200);
                }
              }, 200);
            }
          }
        }
      }
    );
  }
}
function hydrate(options) {
  return lazy(options);
}
async function loadMonaco(highlighter, workspace, lsp) {
  let cdnUrl = `https://esm.sh/modern-monaco@${version}`;
  let editorCoreModuleUrl = `${cdnUrl}/es2022/editor-core.mjs`;
  let lspModuleUrl = `${cdnUrl}/es2022/lsp.mjs`;
  let importmapEl = null;
  if (importmapEl = document.querySelector("script[type='importmap']")) {
    try {
      const { imports = {} } = JSON.parse(importmapEl.textContent);
      if (imports["modern-monaco/editor-core"]) {
        editorCoreModuleUrl = imports["modern-monaco/editor-core"];
      }
      if (imports["modern-monaco/lsp"]) {
        lspModuleUrl = imports["modern-monaco/lsp"];
      }
    } catch (error) {
    }
  }
  const useBuiltinLSP = globalThis.MonacoEnvironment?.useBuiltinLSP;
  const [monaco, { builtinLSPProviders }] = await Promise.all([
    import(
      /* webpackIgnore: true */
      editorCoreModuleUrl
    ),
    useBuiltinLSP ? import(
      /* webpackIgnore: true */
      lspModuleUrl
    ) : Promise.resolve({ builtinLSPProviders: {} })
  ]);
  const allLspProviders = { ...builtinLSPProviders, ...lspProviders, ...lsp?.providers };
  workspace?.setupMonaco(monaco);
  if (!document.getElementById("monaco-editor-core-css")) {
    const styleEl = document.createElement("style");
    styleEl.id = "monaco-editor-core-css";
    styleEl.media = "screen";
    styleEl.textContent = monaco.cssBundle;
    document.head.appendChild(styleEl);
  }
  Reflect.set(globalThis, "MonacoEnvironment", {
    getWorker: async (_workerId, label) => {
      if (label === "editorWorkerService") {
        return monaco.createEditorWorkerMain();
      }
    },
    getLanguageIdFromUri: (uri) => getLanguageIdFromPath(uri.path),
    getExtnameFromLanguageId
  });
  monaco.editor.registerLinkOpener({
    async open(link) {
      if ((link.scheme === "https" || link.scheme === "http") && monaco.editor.getModel(link)) {
        return true;
      }
      return false;
    }
  });
  monaco.editor.registerEditorOpener({
    openCodeEditor: async (editor, resource, selectionOrPosition) => {
      if (workspace && resource.scheme === "file") {
        try {
          await workspace._openTextDocument(monaco, editor, resource.toString(), selectionOrPosition);
          return true;
        } catch (err) {
          if (err instanceof NotFoundError) {
            return false;
          }
          throw err;
        }
      }
      try {
        const model = monaco.editor.getModel(resource);
        if (model) {
          editor.setModel(model);
          if (selectionOrPosition) {
            if ("startLineNumber" in selectionOrPosition) {
              editor.setSelection(selectionOrPosition);
            } else {
              editor.setPosition(selectionOrPosition);
            }
            const pos = editor.getPosition();
            if (pos) {
              const svp = editor.getScrolledVisiblePosition(new monaco.Position(pos.lineNumber - 7, pos.column));
              if (svp) {
                editor.setScrollTop(svp.top);
              }
            }
          }
          const isHttpUrl = resource.scheme === "https" || resource.scheme === "http";
          editor.updateOptions({ readOnly: isHttpUrl });
          return true;
        }
      } catch (error) {
      }
      return false;
    }
  });
  if (globalThis.navigator?.userAgent?.includes("Macintosh")) {
    monaco.editor.addKeybindingRule({
      keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
      command: "editor.action.quickCommand"
    });
  }
  const allLanguages = new Set(grammars.filter((g) => !g.injectTo).map((g) => g.name));
  allLanguages.forEach((id) => {
    const languages = monaco.languages;
    languages.register({ id, aliases: grammars.find((g) => g.name === id)?.aliases });
    languages.onLanguage(id, async () => {
      const config = monaco.languageConfigurations[monaco.languageConfigurationAliases[id] ?? id];
      const loadedGrammars = new Set(highlighter.getLoadedLanguages());
      const reqiredGrammars = [id].concat(grammars.find((g) => g.name === id)?.embedded ?? []).filter((id2) => !loadedGrammars.has(id2));
      if (config) {
        languages.setLanguageConfiguration(id, monaco.convertVscodeLanguageConfiguration(config));
      }
      if (reqiredGrammars.length > 0) {
        await highlighter.loadGrammarFromCDN(...reqiredGrammars);
      }
      registerShikiMonacoTokenizer(monaco, highlighter, id);
      let lspLabel = id;
      let lspProvider = allLspProviders[lspLabel];
      if (!lspProvider) {
        const alias = Object.entries(allLspProviders).find(([, lsp2]) => lsp2.aliases?.includes(id));
        if (alias) {
          [lspLabel, lspProvider] = alias;
        }
      }
      if (lspProvider) {
        lspProvider.import().then(({ setup }) => setup(monaco, id, lsp?.[lspLabel], lsp?.formatting, workspace));
      }
    });
  });
  initShikiMonacoTokenizer(monaco, highlighter);
  return monaco;
}
function registerSyntax(syntax) {
  syntaxes.push(syntax);
}
function registerTheme(theme) {
  if (theme.name) {
    themes.set(theme.name, theme);
  }
}
function registerLSPProvider(lang, provider) {
  lspProviders[lang] = provider;
}
setDefaultWasmLoader(getWasmInstance);
export {
  Workspace,
  errors,
  hydrate,
  init,
  lazy,
  registerLSPProvider,
  registerSyntax,
  registerTheme
};
