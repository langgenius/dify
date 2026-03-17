// node_modules/@vscode/l10n/dist/browser.js
var bundle;
function t(...args) {
  const firstArg = args[0];
  let key;
  let message;
  let formatArgs;
  if (typeof firstArg === "string") {
    key = firstArg;
    message = firstArg;
    args.splice(0, 1);
    formatArgs = !args || typeof args[0] !== "object" ? args : args[0];
  } else if (firstArg instanceof Array) {
    const replacements = args.slice(1);
    if (firstArg.length !== replacements.length + 1) {
      throw new Error("expected a string as the first argument to l10n.t");
    }
    let str = firstArg[0];
    for (let i = 1; i < firstArg.length; i++) {
      str += `{${i - 1}}` + firstArg[i];
    }
    return t(str, ...replacements);
  } else {
    message = firstArg.message;
    key = message;
    if (firstArg.comment && firstArg.comment.length > 0) {
      key += `/${Array.isArray(firstArg.comment) ? firstArg.comment.join("") : firstArg.comment}`;
    }
    formatArgs = firstArg.args ?? {};
  }
  const messageFromBundle = bundle?.[key];
  if (!messageFromBundle) {
    return format(message, formatArgs);
  }
  if (typeof messageFromBundle === "string") {
    return format(messageFromBundle, formatArgs);
  }
  if (messageFromBundle.comment) {
    return format(messageFromBundle.message, formatArgs);
  }
  return format(message, formatArgs);
}
var _format2Regexp = /{([^}]+)}/g;
function format(template, values) {
  if (Object.keys(values).length === 0) {
    return template;
  }
  return template.replace(_format2Regexp, (match, group) => values[group] ?? match);
}

// node_modules/vscode-languageserver-types/lib/esm/main.js
var DocumentUri;
(function(DocumentUri2) {
  function is(value) {
    return typeof value === "string";
  }
  DocumentUri2.is = is;
})(DocumentUri || (DocumentUri = {}));
var URI;
(function(URI3) {
  function is(value) {
    return typeof value === "string";
  }
  URI3.is = is;
})(URI || (URI = {}));
var integer;
(function(integer2) {
  integer2.MIN_VALUE = -2147483648;
  integer2.MAX_VALUE = 2147483647;
  function is(value) {
    return typeof value === "number" && integer2.MIN_VALUE <= value && value <= integer2.MAX_VALUE;
  }
  integer2.is = is;
})(integer || (integer = {}));
var uinteger;
(function(uinteger2) {
  uinteger2.MIN_VALUE = 0;
  uinteger2.MAX_VALUE = 2147483647;
  function is(value) {
    return typeof value === "number" && uinteger2.MIN_VALUE <= value && value <= uinteger2.MAX_VALUE;
  }
  uinteger2.is = is;
})(uinteger || (uinteger = {}));
var Position;
(function(Position3) {
  function create(line, character) {
    if (line === Number.MAX_VALUE) {
      line = uinteger.MAX_VALUE;
    }
    if (character === Number.MAX_VALUE) {
      character = uinteger.MAX_VALUE;
    }
    return { line, character };
  }
  Position3.create = create;
  function is(value) {
    let candidate = value;
    return Is.objectLiteral(candidate) && Is.uinteger(candidate.line) && Is.uinteger(candidate.character);
  }
  Position3.is = is;
})(Position || (Position = {}));
var Range;
(function(Range2) {
  function create(one, two, three, four) {
    if (Is.uinteger(one) && Is.uinteger(two) && Is.uinteger(three) && Is.uinteger(four)) {
      return { start: Position.create(one, two), end: Position.create(three, four) };
    } else if (Position.is(one) && Position.is(two)) {
      return { start: one, end: two };
    } else {
      throw new Error(`Range#create called with invalid arguments[${one}, ${two}, ${three}, ${four}]`);
    }
  }
  Range2.create = create;
  function is(value) {
    let candidate = value;
    return Is.objectLiteral(candidate) && Position.is(candidate.start) && Position.is(candidate.end);
  }
  Range2.is = is;
})(Range || (Range = {}));
var Location;
(function(Location2) {
  function create(uri, range) {
    return { uri, range };
  }
  Location2.create = create;
  function is(value) {
    let candidate = value;
    return Is.objectLiteral(candidate) && Range.is(candidate.range) && (Is.string(candidate.uri) || Is.undefined(candidate.uri));
  }
  Location2.is = is;
})(Location || (Location = {}));
var LocationLink;
(function(LocationLink2) {
  function create(targetUri, targetRange, targetSelectionRange, originSelectionRange) {
    return { targetUri, targetRange, targetSelectionRange, originSelectionRange };
  }
  LocationLink2.create = create;
  function is(value) {
    let candidate = value;
    return Is.objectLiteral(candidate) && Range.is(candidate.targetRange) && Is.string(candidate.targetUri) && Range.is(candidate.targetSelectionRange) && (Range.is(candidate.originSelectionRange) || Is.undefined(candidate.originSelectionRange));
  }
  LocationLink2.is = is;
})(LocationLink || (LocationLink = {}));
var Color;
(function(Color2) {
  function create(red, green, blue, alpha) {
    return {
      red,
      green,
      blue,
      alpha
    };
  }
  Color2.create = create;
  function is(value) {
    const candidate = value;
    return Is.objectLiteral(candidate) && Is.numberRange(candidate.red, 0, 1) && Is.numberRange(candidate.green, 0, 1) && Is.numberRange(candidate.blue, 0, 1) && Is.numberRange(candidate.alpha, 0, 1);
  }
  Color2.is = is;
})(Color || (Color = {}));
var ColorInformation;
(function(ColorInformation2) {
  function create(range, color) {
    return {
      range,
      color
    };
  }
  ColorInformation2.create = create;
  function is(value) {
    const candidate = value;
    return Is.objectLiteral(candidate) && Range.is(candidate.range) && Color.is(candidate.color);
  }
  ColorInformation2.is = is;
})(ColorInformation || (ColorInformation = {}));
var ColorPresentation;
(function(ColorPresentation2) {
  function create(label, textEdit, additionalTextEdits) {
    return {
      label,
      textEdit,
      additionalTextEdits
    };
  }
  ColorPresentation2.create = create;
  function is(value) {
    const candidate = value;
    return Is.objectLiteral(candidate) && Is.string(candidate.label) && (Is.undefined(candidate.textEdit) || TextEdit.is(candidate)) && (Is.undefined(candidate.additionalTextEdits) || Is.typedArray(candidate.additionalTextEdits, TextEdit.is));
  }
  ColorPresentation2.is = is;
})(ColorPresentation || (ColorPresentation = {}));
var FoldingRangeKind;
(function(FoldingRangeKind2) {
  FoldingRangeKind2.Comment = "comment";
  FoldingRangeKind2.Imports = "imports";
  FoldingRangeKind2.Region = "region";
})(FoldingRangeKind || (FoldingRangeKind = {}));
var FoldingRange;
(function(FoldingRange2) {
  function create(startLine, endLine, startCharacter, endCharacter, kind, collapsedText) {
    const result = {
      startLine,
      endLine
    };
    if (Is.defined(startCharacter)) {
      result.startCharacter = startCharacter;
    }
    if (Is.defined(endCharacter)) {
      result.endCharacter = endCharacter;
    }
    if (Is.defined(kind)) {
      result.kind = kind;
    }
    if (Is.defined(collapsedText)) {
      result.collapsedText = collapsedText;
    }
    return result;
  }
  FoldingRange2.create = create;
  function is(value) {
    const candidate = value;
    return Is.objectLiteral(candidate) && Is.uinteger(candidate.startLine) && Is.uinteger(candidate.startLine) && (Is.undefined(candidate.startCharacter) || Is.uinteger(candidate.startCharacter)) && (Is.undefined(candidate.endCharacter) || Is.uinteger(candidate.endCharacter)) && (Is.undefined(candidate.kind) || Is.string(candidate.kind));
  }
  FoldingRange2.is = is;
})(FoldingRange || (FoldingRange = {}));
var DiagnosticRelatedInformation;
(function(DiagnosticRelatedInformation2) {
  function create(location, message) {
    return {
      location,
      message
    };
  }
  DiagnosticRelatedInformation2.create = create;
  function is(value) {
    let candidate = value;
    return Is.defined(candidate) && Location.is(candidate.location) && Is.string(candidate.message);
  }
  DiagnosticRelatedInformation2.is = is;
})(DiagnosticRelatedInformation || (DiagnosticRelatedInformation = {}));
var DiagnosticSeverity;
(function(DiagnosticSeverity2) {
  DiagnosticSeverity2.Error = 1;
  DiagnosticSeverity2.Warning = 2;
  DiagnosticSeverity2.Information = 3;
  DiagnosticSeverity2.Hint = 4;
})(DiagnosticSeverity || (DiagnosticSeverity = {}));
var DiagnosticTag;
(function(DiagnosticTag2) {
  DiagnosticTag2.Unnecessary = 1;
  DiagnosticTag2.Deprecated = 2;
})(DiagnosticTag || (DiagnosticTag = {}));
var CodeDescription;
(function(CodeDescription2) {
  function is(value) {
    const candidate = value;
    return Is.objectLiteral(candidate) && Is.string(candidate.href);
  }
  CodeDescription2.is = is;
})(CodeDescription || (CodeDescription = {}));
var Diagnostic;
(function(Diagnostic2) {
  function create(range, message, severity, code, source, relatedInformation) {
    let result = { range, message };
    if (Is.defined(severity)) {
      result.severity = severity;
    }
    if (Is.defined(code)) {
      result.code = code;
    }
    if (Is.defined(source)) {
      result.source = source;
    }
    if (Is.defined(relatedInformation)) {
      result.relatedInformation = relatedInformation;
    }
    return result;
  }
  Diagnostic2.create = create;
  function is(value) {
    var _a2;
    let candidate = value;
    return Is.defined(candidate) && Range.is(candidate.range) && Is.string(candidate.message) && (Is.number(candidate.severity) || Is.undefined(candidate.severity)) && (Is.integer(candidate.code) || Is.string(candidate.code) || Is.undefined(candidate.code)) && (Is.undefined(candidate.codeDescription) || Is.string((_a2 = candidate.codeDescription) === null || _a2 === void 0 ? void 0 : _a2.href)) && (Is.string(candidate.source) || Is.undefined(candidate.source)) && (Is.undefined(candidate.relatedInformation) || Is.typedArray(candidate.relatedInformation, DiagnosticRelatedInformation.is));
  }
  Diagnostic2.is = is;
})(Diagnostic || (Diagnostic = {}));
var Command;
(function(Command2) {
  function create(title, command, ...args) {
    let result = { title, command };
    if (Is.defined(args) && args.length > 0) {
      result.arguments = args;
    }
    return result;
  }
  Command2.create = create;
  function is(value) {
    let candidate = value;
    return Is.defined(candidate) && Is.string(candidate.title) && Is.string(candidate.command);
  }
  Command2.is = is;
})(Command || (Command = {}));
var TextEdit;
(function(TextEdit2) {
  function replace(range, newText) {
    return { range, newText };
  }
  TextEdit2.replace = replace;
  function insert(position, newText) {
    return { range: { start: position, end: position }, newText };
  }
  TextEdit2.insert = insert;
  function del(range) {
    return { range, newText: "" };
  }
  TextEdit2.del = del;
  function is(value) {
    const candidate = value;
    return Is.objectLiteral(candidate) && Is.string(candidate.newText) && Range.is(candidate.range);
  }
  TextEdit2.is = is;
})(TextEdit || (TextEdit = {}));
var ChangeAnnotation;
(function(ChangeAnnotation2) {
  function create(label, needsConfirmation, description) {
    const result = { label };
    if (needsConfirmation !== void 0) {
      result.needsConfirmation = needsConfirmation;
    }
    if (description !== void 0) {
      result.description = description;
    }
    return result;
  }
  ChangeAnnotation2.create = create;
  function is(value) {
    const candidate = value;
    return Is.objectLiteral(candidate) && Is.string(candidate.label) && (Is.boolean(candidate.needsConfirmation) || candidate.needsConfirmation === void 0) && (Is.string(candidate.description) || candidate.description === void 0);
  }
  ChangeAnnotation2.is = is;
})(ChangeAnnotation || (ChangeAnnotation = {}));
var ChangeAnnotationIdentifier;
(function(ChangeAnnotationIdentifier2) {
  function is(value) {
    const candidate = value;
    return Is.string(candidate);
  }
  ChangeAnnotationIdentifier2.is = is;
})(ChangeAnnotationIdentifier || (ChangeAnnotationIdentifier = {}));
var AnnotatedTextEdit;
(function(AnnotatedTextEdit2) {
  function replace(range, newText, annotation) {
    return { range, newText, annotationId: annotation };
  }
  AnnotatedTextEdit2.replace = replace;
  function insert(position, newText, annotation) {
    return { range: { start: position, end: position }, newText, annotationId: annotation };
  }
  AnnotatedTextEdit2.insert = insert;
  function del(range, annotation) {
    return { range, newText: "", annotationId: annotation };
  }
  AnnotatedTextEdit2.del = del;
  function is(value) {
    const candidate = value;
    return TextEdit.is(candidate) && (ChangeAnnotation.is(candidate.annotationId) || ChangeAnnotationIdentifier.is(candidate.annotationId));
  }
  AnnotatedTextEdit2.is = is;
})(AnnotatedTextEdit || (AnnotatedTextEdit = {}));
var TextDocumentEdit;
(function(TextDocumentEdit2) {
  function create(textDocument, edits) {
    return { textDocument, edits };
  }
  TextDocumentEdit2.create = create;
  function is(value) {
    let candidate = value;
    return Is.defined(candidate) && OptionalVersionedTextDocumentIdentifier.is(candidate.textDocument) && Array.isArray(candidate.edits);
  }
  TextDocumentEdit2.is = is;
})(TextDocumentEdit || (TextDocumentEdit = {}));
var CreateFile;
(function(CreateFile2) {
  function create(uri, options, annotation) {
    let result = {
      kind: "create",
      uri
    };
    if (options !== void 0 && (options.overwrite !== void 0 || options.ignoreIfExists !== void 0)) {
      result.options = options;
    }
    if (annotation !== void 0) {
      result.annotationId = annotation;
    }
    return result;
  }
  CreateFile2.create = create;
  function is(value) {
    let candidate = value;
    return candidate && candidate.kind === "create" && Is.string(candidate.uri) && (candidate.options === void 0 || (candidate.options.overwrite === void 0 || Is.boolean(candidate.options.overwrite)) && (candidate.options.ignoreIfExists === void 0 || Is.boolean(candidate.options.ignoreIfExists))) && (candidate.annotationId === void 0 || ChangeAnnotationIdentifier.is(candidate.annotationId));
  }
  CreateFile2.is = is;
})(CreateFile || (CreateFile = {}));
var RenameFile;
(function(RenameFile2) {
  function create(oldUri, newUri, options, annotation) {
    let result = {
      kind: "rename",
      oldUri,
      newUri
    };
    if (options !== void 0 && (options.overwrite !== void 0 || options.ignoreIfExists !== void 0)) {
      result.options = options;
    }
    if (annotation !== void 0) {
      result.annotationId = annotation;
    }
    return result;
  }
  RenameFile2.create = create;
  function is(value) {
    let candidate = value;
    return candidate && candidate.kind === "rename" && Is.string(candidate.oldUri) && Is.string(candidate.newUri) && (candidate.options === void 0 || (candidate.options.overwrite === void 0 || Is.boolean(candidate.options.overwrite)) && (candidate.options.ignoreIfExists === void 0 || Is.boolean(candidate.options.ignoreIfExists))) && (candidate.annotationId === void 0 || ChangeAnnotationIdentifier.is(candidate.annotationId));
  }
  RenameFile2.is = is;
})(RenameFile || (RenameFile = {}));
var DeleteFile;
(function(DeleteFile2) {
  function create(uri, options, annotation) {
    let result = {
      kind: "delete",
      uri
    };
    if (options !== void 0 && (options.recursive !== void 0 || options.ignoreIfNotExists !== void 0)) {
      result.options = options;
    }
    if (annotation !== void 0) {
      result.annotationId = annotation;
    }
    return result;
  }
  DeleteFile2.create = create;
  function is(value) {
    let candidate = value;
    return candidate && candidate.kind === "delete" && Is.string(candidate.uri) && (candidate.options === void 0 || (candidate.options.recursive === void 0 || Is.boolean(candidate.options.recursive)) && (candidate.options.ignoreIfNotExists === void 0 || Is.boolean(candidate.options.ignoreIfNotExists))) && (candidate.annotationId === void 0 || ChangeAnnotationIdentifier.is(candidate.annotationId));
  }
  DeleteFile2.is = is;
})(DeleteFile || (DeleteFile = {}));
var WorkspaceEdit;
(function(WorkspaceEdit2) {
  function is(value) {
    let candidate = value;
    return candidate && (candidate.changes !== void 0 || candidate.documentChanges !== void 0) && (candidate.documentChanges === void 0 || candidate.documentChanges.every((change) => {
      if (Is.string(change.kind)) {
        return CreateFile.is(change) || RenameFile.is(change) || DeleteFile.is(change);
      } else {
        return TextDocumentEdit.is(change);
      }
    }));
  }
  WorkspaceEdit2.is = is;
})(WorkspaceEdit || (WorkspaceEdit = {}));
var TextDocumentIdentifier;
(function(TextDocumentIdentifier2) {
  function create(uri) {
    return { uri };
  }
  TextDocumentIdentifier2.create = create;
  function is(value) {
    let candidate = value;
    return Is.defined(candidate) && Is.string(candidate.uri);
  }
  TextDocumentIdentifier2.is = is;
})(TextDocumentIdentifier || (TextDocumentIdentifier = {}));
var VersionedTextDocumentIdentifier;
(function(VersionedTextDocumentIdentifier2) {
  function create(uri, version) {
    return { uri, version };
  }
  VersionedTextDocumentIdentifier2.create = create;
  function is(value) {
    let candidate = value;
    return Is.defined(candidate) && Is.string(candidate.uri) && Is.integer(candidate.version);
  }
  VersionedTextDocumentIdentifier2.is = is;
})(VersionedTextDocumentIdentifier || (VersionedTextDocumentIdentifier = {}));
var OptionalVersionedTextDocumentIdentifier;
(function(OptionalVersionedTextDocumentIdentifier2) {
  function create(uri, version) {
    return { uri, version };
  }
  OptionalVersionedTextDocumentIdentifier2.create = create;
  function is(value) {
    let candidate = value;
    return Is.defined(candidate) && Is.string(candidate.uri) && (candidate.version === null || Is.integer(candidate.version));
  }
  OptionalVersionedTextDocumentIdentifier2.is = is;
})(OptionalVersionedTextDocumentIdentifier || (OptionalVersionedTextDocumentIdentifier = {}));
var TextDocumentItem;
(function(TextDocumentItem2) {
  function create(uri, languageId, version, text) {
    return { uri, languageId, version, text };
  }
  TextDocumentItem2.create = create;
  function is(value) {
    let candidate = value;
    return Is.defined(candidate) && Is.string(candidate.uri) && Is.string(candidate.languageId) && Is.integer(candidate.version) && Is.string(candidate.text);
  }
  TextDocumentItem2.is = is;
})(TextDocumentItem || (TextDocumentItem = {}));
var MarkupKind;
(function(MarkupKind2) {
  MarkupKind2.PlainText = "plaintext";
  MarkupKind2.Markdown = "markdown";
  function is(value) {
    const candidate = value;
    return candidate === MarkupKind2.PlainText || candidate === MarkupKind2.Markdown;
  }
  MarkupKind2.is = is;
})(MarkupKind || (MarkupKind = {}));
var MarkupContent;
(function(MarkupContent2) {
  function is(value) {
    const candidate = value;
    return Is.objectLiteral(value) && MarkupKind.is(candidate.kind) && Is.string(candidate.value);
  }
  MarkupContent2.is = is;
})(MarkupContent || (MarkupContent = {}));
var CompletionItemKind;
(function(CompletionItemKind2) {
  CompletionItemKind2.Text = 1;
  CompletionItemKind2.Method = 2;
  CompletionItemKind2.Function = 3;
  CompletionItemKind2.Constructor = 4;
  CompletionItemKind2.Field = 5;
  CompletionItemKind2.Variable = 6;
  CompletionItemKind2.Class = 7;
  CompletionItemKind2.Interface = 8;
  CompletionItemKind2.Module = 9;
  CompletionItemKind2.Property = 10;
  CompletionItemKind2.Unit = 11;
  CompletionItemKind2.Value = 12;
  CompletionItemKind2.Enum = 13;
  CompletionItemKind2.Keyword = 14;
  CompletionItemKind2.Snippet = 15;
  CompletionItemKind2.Color = 16;
  CompletionItemKind2.File = 17;
  CompletionItemKind2.Reference = 18;
  CompletionItemKind2.Folder = 19;
  CompletionItemKind2.EnumMember = 20;
  CompletionItemKind2.Constant = 21;
  CompletionItemKind2.Struct = 22;
  CompletionItemKind2.Event = 23;
  CompletionItemKind2.Operator = 24;
  CompletionItemKind2.TypeParameter = 25;
})(CompletionItemKind || (CompletionItemKind = {}));
var InsertTextFormat;
(function(InsertTextFormat2) {
  InsertTextFormat2.PlainText = 1;
  InsertTextFormat2.Snippet = 2;
})(InsertTextFormat || (InsertTextFormat = {}));
var CompletionItemTag;
(function(CompletionItemTag2) {
  CompletionItemTag2.Deprecated = 1;
})(CompletionItemTag || (CompletionItemTag = {}));
var InsertReplaceEdit;
(function(InsertReplaceEdit2) {
  function create(newText, insert, replace) {
    return { newText, insert, replace };
  }
  InsertReplaceEdit2.create = create;
  function is(value) {
    const candidate = value;
    return candidate && Is.string(candidate.newText) && Range.is(candidate.insert) && Range.is(candidate.replace);
  }
  InsertReplaceEdit2.is = is;
})(InsertReplaceEdit || (InsertReplaceEdit = {}));
var InsertTextMode;
(function(InsertTextMode2) {
  InsertTextMode2.asIs = 1;
  InsertTextMode2.adjustIndentation = 2;
})(InsertTextMode || (InsertTextMode = {}));
var CompletionItemLabelDetails;
(function(CompletionItemLabelDetails2) {
  function is(value) {
    const candidate = value;
    return candidate && (Is.string(candidate.detail) || candidate.detail === void 0) && (Is.string(candidate.description) || candidate.description === void 0);
  }
  CompletionItemLabelDetails2.is = is;
})(CompletionItemLabelDetails || (CompletionItemLabelDetails = {}));
var CompletionItem;
(function(CompletionItem2) {
  function create(label) {
    return { label };
  }
  CompletionItem2.create = create;
})(CompletionItem || (CompletionItem = {}));
var CompletionList;
(function(CompletionList2) {
  function create(items, isIncomplete) {
    return { items: items ? items : [], isIncomplete: !!isIncomplete };
  }
  CompletionList2.create = create;
})(CompletionList || (CompletionList = {}));
var MarkedString;
(function(MarkedString2) {
  function fromPlainText(plainText) {
    return plainText.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
  }
  MarkedString2.fromPlainText = fromPlainText;
  function is(value) {
    const candidate = value;
    return Is.string(candidate) || Is.objectLiteral(candidate) && Is.string(candidate.language) && Is.string(candidate.value);
  }
  MarkedString2.is = is;
})(MarkedString || (MarkedString = {}));
var Hover;
(function(Hover2) {
  function is(value) {
    let candidate = value;
    return !!candidate && Is.objectLiteral(candidate) && (MarkupContent.is(candidate.contents) || MarkedString.is(candidate.contents) || Is.typedArray(candidate.contents, MarkedString.is)) && (value.range === void 0 || Range.is(value.range));
  }
  Hover2.is = is;
})(Hover || (Hover = {}));
var ParameterInformation;
(function(ParameterInformation2) {
  function create(label, documentation) {
    return documentation ? { label, documentation } : { label };
  }
  ParameterInformation2.create = create;
})(ParameterInformation || (ParameterInformation = {}));
var SignatureInformation;
(function(SignatureInformation2) {
  function create(label, documentation, ...parameters) {
    let result = { label };
    if (Is.defined(documentation)) {
      result.documentation = documentation;
    }
    if (Is.defined(parameters)) {
      result.parameters = parameters;
    } else {
      result.parameters = [];
    }
    return result;
  }
  SignatureInformation2.create = create;
})(SignatureInformation || (SignatureInformation = {}));
var DocumentHighlightKind;
(function(DocumentHighlightKind2) {
  DocumentHighlightKind2.Text = 1;
  DocumentHighlightKind2.Read = 2;
  DocumentHighlightKind2.Write = 3;
})(DocumentHighlightKind || (DocumentHighlightKind = {}));
var DocumentHighlight;
(function(DocumentHighlight2) {
  function create(range, kind) {
    let result = { range };
    if (Is.number(kind)) {
      result.kind = kind;
    }
    return result;
  }
  DocumentHighlight2.create = create;
})(DocumentHighlight || (DocumentHighlight = {}));
var SymbolKind;
(function(SymbolKind2) {
  SymbolKind2.File = 1;
  SymbolKind2.Module = 2;
  SymbolKind2.Namespace = 3;
  SymbolKind2.Package = 4;
  SymbolKind2.Class = 5;
  SymbolKind2.Method = 6;
  SymbolKind2.Property = 7;
  SymbolKind2.Field = 8;
  SymbolKind2.Constructor = 9;
  SymbolKind2.Enum = 10;
  SymbolKind2.Interface = 11;
  SymbolKind2.Function = 12;
  SymbolKind2.Variable = 13;
  SymbolKind2.Constant = 14;
  SymbolKind2.String = 15;
  SymbolKind2.Number = 16;
  SymbolKind2.Boolean = 17;
  SymbolKind2.Array = 18;
  SymbolKind2.Object = 19;
  SymbolKind2.Key = 20;
  SymbolKind2.Null = 21;
  SymbolKind2.EnumMember = 22;
  SymbolKind2.Struct = 23;
  SymbolKind2.Event = 24;
  SymbolKind2.Operator = 25;
  SymbolKind2.TypeParameter = 26;
})(SymbolKind || (SymbolKind = {}));
var SymbolTag;
(function(SymbolTag2) {
  SymbolTag2.Deprecated = 1;
})(SymbolTag || (SymbolTag = {}));
var SymbolInformation;
(function(SymbolInformation2) {
  function create(name, kind, range, uri, containerName) {
    let result = {
      name,
      kind,
      location: { uri, range }
    };
    if (containerName) {
      result.containerName = containerName;
    }
    return result;
  }
  SymbolInformation2.create = create;
})(SymbolInformation || (SymbolInformation = {}));
var WorkspaceSymbol;
(function(WorkspaceSymbol2) {
  function create(name, kind, uri, range) {
    return range !== void 0 ? { name, kind, location: { uri, range } } : { name, kind, location: { uri } };
  }
  WorkspaceSymbol2.create = create;
})(WorkspaceSymbol || (WorkspaceSymbol = {}));
var DocumentSymbol;
(function(DocumentSymbol2) {
  function create(name, detail, kind, range, selectionRange, children) {
    let result = {
      name,
      detail,
      kind,
      range,
      selectionRange
    };
    if (children !== void 0) {
      result.children = children;
    }
    return result;
  }
  DocumentSymbol2.create = create;
  function is(value) {
    let candidate = value;
    return candidate && Is.string(candidate.name) && Is.number(candidate.kind) && Range.is(candidate.range) && Range.is(candidate.selectionRange) && (candidate.detail === void 0 || Is.string(candidate.detail)) && (candidate.deprecated === void 0 || Is.boolean(candidate.deprecated)) && (candidate.children === void 0 || Array.isArray(candidate.children)) && (candidate.tags === void 0 || Array.isArray(candidate.tags));
  }
  DocumentSymbol2.is = is;
})(DocumentSymbol || (DocumentSymbol = {}));
var CodeActionKind;
(function(CodeActionKind2) {
  CodeActionKind2.Empty = "";
  CodeActionKind2.QuickFix = "quickfix";
  CodeActionKind2.Refactor = "refactor";
  CodeActionKind2.RefactorExtract = "refactor.extract";
  CodeActionKind2.RefactorInline = "refactor.inline";
  CodeActionKind2.RefactorRewrite = "refactor.rewrite";
  CodeActionKind2.Source = "source";
  CodeActionKind2.SourceOrganizeImports = "source.organizeImports";
  CodeActionKind2.SourceFixAll = "source.fixAll";
})(CodeActionKind || (CodeActionKind = {}));
var CodeActionTriggerKind;
(function(CodeActionTriggerKind2) {
  CodeActionTriggerKind2.Invoked = 1;
  CodeActionTriggerKind2.Automatic = 2;
})(CodeActionTriggerKind || (CodeActionTriggerKind = {}));
var CodeActionContext;
(function(CodeActionContext2) {
  function create(diagnostics, only, triggerKind) {
    let result = { diagnostics };
    if (only !== void 0 && only !== null) {
      result.only = only;
    }
    if (triggerKind !== void 0 && triggerKind !== null) {
      result.triggerKind = triggerKind;
    }
    return result;
  }
  CodeActionContext2.create = create;
  function is(value) {
    let candidate = value;
    return Is.defined(candidate) && Is.typedArray(candidate.diagnostics, Diagnostic.is) && (candidate.only === void 0 || Is.typedArray(candidate.only, Is.string)) && (candidate.triggerKind === void 0 || candidate.triggerKind === CodeActionTriggerKind.Invoked || candidate.triggerKind === CodeActionTriggerKind.Automatic);
  }
  CodeActionContext2.is = is;
})(CodeActionContext || (CodeActionContext = {}));
var CodeAction;
(function(CodeAction2) {
  function create(title, kindOrCommandOrEdit, kind) {
    let result = { title };
    let checkKind = true;
    if (typeof kindOrCommandOrEdit === "string") {
      checkKind = false;
      result.kind = kindOrCommandOrEdit;
    } else if (Command.is(kindOrCommandOrEdit)) {
      result.command = kindOrCommandOrEdit;
    } else {
      result.edit = kindOrCommandOrEdit;
    }
    if (checkKind && kind !== void 0) {
      result.kind = kind;
    }
    return result;
  }
  CodeAction2.create = create;
  function is(value) {
    let candidate = value;
    return candidate && Is.string(candidate.title) && (candidate.diagnostics === void 0 || Is.typedArray(candidate.diagnostics, Diagnostic.is)) && (candidate.kind === void 0 || Is.string(candidate.kind)) && (candidate.edit !== void 0 || candidate.command !== void 0) && (candidate.command === void 0 || Command.is(candidate.command)) && (candidate.isPreferred === void 0 || Is.boolean(candidate.isPreferred)) && (candidate.edit === void 0 || WorkspaceEdit.is(candidate.edit));
  }
  CodeAction2.is = is;
})(CodeAction || (CodeAction = {}));
var CodeLens;
(function(CodeLens2) {
  function create(range, data) {
    let result = { range };
    if (Is.defined(data)) {
      result.data = data;
    }
    return result;
  }
  CodeLens2.create = create;
  function is(value) {
    let candidate = value;
    return Is.defined(candidate) && Range.is(candidate.range) && (Is.undefined(candidate.command) || Command.is(candidate.command));
  }
  CodeLens2.is = is;
})(CodeLens || (CodeLens = {}));
var FormattingOptions;
(function(FormattingOptions2) {
  function create(tabSize, insertSpaces) {
    return { tabSize, insertSpaces };
  }
  FormattingOptions2.create = create;
  function is(value) {
    let candidate = value;
    return Is.defined(candidate) && Is.uinteger(candidate.tabSize) && Is.boolean(candidate.insertSpaces);
  }
  FormattingOptions2.is = is;
})(FormattingOptions || (FormattingOptions = {}));
var DocumentLink;
(function(DocumentLink2) {
  function create(range, target, data) {
    return { range, target, data };
  }
  DocumentLink2.create = create;
  function is(value) {
    let candidate = value;
    return Is.defined(candidate) && Range.is(candidate.range) && (Is.undefined(candidate.target) || Is.string(candidate.target));
  }
  DocumentLink2.is = is;
})(DocumentLink || (DocumentLink = {}));
var SelectionRange;
(function(SelectionRange2) {
  function create(range, parent) {
    return { range, parent };
  }
  SelectionRange2.create = create;
  function is(value) {
    let candidate = value;
    return Is.objectLiteral(candidate) && Range.is(candidate.range) && (candidate.parent === void 0 || SelectionRange2.is(candidate.parent));
  }
  SelectionRange2.is = is;
})(SelectionRange || (SelectionRange = {}));
var SemanticTokenTypes;
(function(SemanticTokenTypes2) {
  SemanticTokenTypes2["namespace"] = "namespace";
  SemanticTokenTypes2["type"] = "type";
  SemanticTokenTypes2["class"] = "class";
  SemanticTokenTypes2["enum"] = "enum";
  SemanticTokenTypes2["interface"] = "interface";
  SemanticTokenTypes2["struct"] = "struct";
  SemanticTokenTypes2["typeParameter"] = "typeParameter";
  SemanticTokenTypes2["parameter"] = "parameter";
  SemanticTokenTypes2["variable"] = "variable";
  SemanticTokenTypes2["property"] = "property";
  SemanticTokenTypes2["enumMember"] = "enumMember";
  SemanticTokenTypes2["event"] = "event";
  SemanticTokenTypes2["function"] = "function";
  SemanticTokenTypes2["method"] = "method";
  SemanticTokenTypes2["macro"] = "macro";
  SemanticTokenTypes2["keyword"] = "keyword";
  SemanticTokenTypes2["modifier"] = "modifier";
  SemanticTokenTypes2["comment"] = "comment";
  SemanticTokenTypes2["string"] = "string";
  SemanticTokenTypes2["number"] = "number";
  SemanticTokenTypes2["regexp"] = "regexp";
  SemanticTokenTypes2["operator"] = "operator";
  SemanticTokenTypes2["decorator"] = "decorator";
})(SemanticTokenTypes || (SemanticTokenTypes = {}));
var SemanticTokenModifiers;
(function(SemanticTokenModifiers2) {
  SemanticTokenModifiers2["declaration"] = "declaration";
  SemanticTokenModifiers2["definition"] = "definition";
  SemanticTokenModifiers2["readonly"] = "readonly";
  SemanticTokenModifiers2["static"] = "static";
  SemanticTokenModifiers2["deprecated"] = "deprecated";
  SemanticTokenModifiers2["abstract"] = "abstract";
  SemanticTokenModifiers2["async"] = "async";
  SemanticTokenModifiers2["modification"] = "modification";
  SemanticTokenModifiers2["documentation"] = "documentation";
  SemanticTokenModifiers2["defaultLibrary"] = "defaultLibrary";
})(SemanticTokenModifiers || (SemanticTokenModifiers = {}));
var SemanticTokens;
(function(SemanticTokens2) {
  function is(value) {
    const candidate = value;
    return Is.objectLiteral(candidate) && (candidate.resultId === void 0 || typeof candidate.resultId === "string") && Array.isArray(candidate.data) && (candidate.data.length === 0 || typeof candidate.data[0] === "number");
  }
  SemanticTokens2.is = is;
})(SemanticTokens || (SemanticTokens = {}));
var InlineValueText;
(function(InlineValueText2) {
  function create(range, text) {
    return { range, text };
  }
  InlineValueText2.create = create;
  function is(value) {
    const candidate = value;
    return candidate !== void 0 && candidate !== null && Range.is(candidate.range) && Is.string(candidate.text);
  }
  InlineValueText2.is = is;
})(InlineValueText || (InlineValueText = {}));
var InlineValueVariableLookup;
(function(InlineValueVariableLookup2) {
  function create(range, variableName, caseSensitiveLookup) {
    return { range, variableName, caseSensitiveLookup };
  }
  InlineValueVariableLookup2.create = create;
  function is(value) {
    const candidate = value;
    return candidate !== void 0 && candidate !== null && Range.is(candidate.range) && Is.boolean(candidate.caseSensitiveLookup) && (Is.string(candidate.variableName) || candidate.variableName === void 0);
  }
  InlineValueVariableLookup2.is = is;
})(InlineValueVariableLookup || (InlineValueVariableLookup = {}));
var InlineValueEvaluatableExpression;
(function(InlineValueEvaluatableExpression2) {
  function create(range, expression) {
    return { range, expression };
  }
  InlineValueEvaluatableExpression2.create = create;
  function is(value) {
    const candidate = value;
    return candidate !== void 0 && candidate !== null && Range.is(candidate.range) && (Is.string(candidate.expression) || candidate.expression === void 0);
  }
  InlineValueEvaluatableExpression2.is = is;
})(InlineValueEvaluatableExpression || (InlineValueEvaluatableExpression = {}));
var InlineValueContext;
(function(InlineValueContext2) {
  function create(frameId, stoppedLocation) {
    return { frameId, stoppedLocation };
  }
  InlineValueContext2.create = create;
  function is(value) {
    const candidate = value;
    return Is.defined(candidate) && Range.is(value.stoppedLocation);
  }
  InlineValueContext2.is = is;
})(InlineValueContext || (InlineValueContext = {}));
var InlayHintKind;
(function(InlayHintKind2) {
  InlayHintKind2.Type = 1;
  InlayHintKind2.Parameter = 2;
  function is(value) {
    return value === 1 || value === 2;
  }
  InlayHintKind2.is = is;
})(InlayHintKind || (InlayHintKind = {}));
var InlayHintLabelPart;
(function(InlayHintLabelPart2) {
  function create(value) {
    return { value };
  }
  InlayHintLabelPart2.create = create;
  function is(value) {
    const candidate = value;
    return Is.objectLiteral(candidate) && (candidate.tooltip === void 0 || Is.string(candidate.tooltip) || MarkupContent.is(candidate.tooltip)) && (candidate.location === void 0 || Location.is(candidate.location)) && (candidate.command === void 0 || Command.is(candidate.command));
  }
  InlayHintLabelPart2.is = is;
})(InlayHintLabelPart || (InlayHintLabelPart = {}));
var InlayHint;
(function(InlayHint2) {
  function create(position, label, kind) {
    const result = { position, label };
    if (kind !== void 0) {
      result.kind = kind;
    }
    return result;
  }
  InlayHint2.create = create;
  function is(value) {
    const candidate = value;
    return Is.objectLiteral(candidate) && Position.is(candidate.position) && (Is.string(candidate.label) || Is.typedArray(candidate.label, InlayHintLabelPart.is)) && (candidate.kind === void 0 || InlayHintKind.is(candidate.kind)) && candidate.textEdits === void 0 || Is.typedArray(candidate.textEdits, TextEdit.is) && (candidate.tooltip === void 0 || Is.string(candidate.tooltip) || MarkupContent.is(candidate.tooltip)) && (candidate.paddingLeft === void 0 || Is.boolean(candidate.paddingLeft)) && (candidate.paddingRight === void 0 || Is.boolean(candidate.paddingRight));
  }
  InlayHint2.is = is;
})(InlayHint || (InlayHint = {}));
var StringValue;
(function(StringValue2) {
  function createSnippet(value) {
    return { kind: "snippet", value };
  }
  StringValue2.createSnippet = createSnippet;
})(StringValue || (StringValue = {}));
var InlineCompletionItem;
(function(InlineCompletionItem2) {
  function create(insertText, filterText, range, command) {
    return { insertText, filterText, range, command };
  }
  InlineCompletionItem2.create = create;
})(InlineCompletionItem || (InlineCompletionItem = {}));
var InlineCompletionList;
(function(InlineCompletionList2) {
  function create(items) {
    return { items };
  }
  InlineCompletionList2.create = create;
})(InlineCompletionList || (InlineCompletionList = {}));
var InlineCompletionTriggerKind;
(function(InlineCompletionTriggerKind2) {
  InlineCompletionTriggerKind2.Invoked = 0;
  InlineCompletionTriggerKind2.Automatic = 1;
})(InlineCompletionTriggerKind || (InlineCompletionTriggerKind = {}));
var SelectedCompletionInfo;
(function(SelectedCompletionInfo2) {
  function create(range, text) {
    return { range, text };
  }
  SelectedCompletionInfo2.create = create;
})(SelectedCompletionInfo || (SelectedCompletionInfo = {}));
var InlineCompletionContext;
(function(InlineCompletionContext2) {
  function create(triggerKind, selectedCompletionInfo) {
    return { triggerKind, selectedCompletionInfo };
  }
  InlineCompletionContext2.create = create;
})(InlineCompletionContext || (InlineCompletionContext = {}));
var WorkspaceFolder;
(function(WorkspaceFolder2) {
  function is(value) {
    const candidate = value;
    return Is.objectLiteral(candidate) && URI.is(candidate.uri) && Is.string(candidate.name);
  }
  WorkspaceFolder2.is = is;
})(WorkspaceFolder || (WorkspaceFolder = {}));
var TextDocument;
(function(TextDocument4) {
  function create(uri, languageId, version, content) {
    return new FullTextDocument(uri, languageId, version, content);
  }
  TextDocument4.create = create;
  function is(value) {
    let candidate = value;
    return Is.defined(candidate) && Is.string(candidate.uri) && (Is.undefined(candidate.languageId) || Is.string(candidate.languageId)) && Is.uinteger(candidate.lineCount) && Is.func(candidate.getText) && Is.func(candidate.positionAt) && Is.func(candidate.offsetAt) ? true : false;
  }
  TextDocument4.is = is;
  function applyEdits(document, edits) {
    let text = document.getText();
    let sortedEdits = mergeSort2(edits, (a, b) => {
      let diff = a.range.start.line - b.range.start.line;
      if (diff === 0) {
        return a.range.start.character - b.range.start.character;
      }
      return diff;
    });
    let lastModifiedOffset = text.length;
    for (let i = sortedEdits.length - 1; i >= 0; i--) {
      let e = sortedEdits[i];
      let startOffset = document.offsetAt(e.range.start);
      let endOffset = document.offsetAt(e.range.end);
      if (endOffset <= lastModifiedOffset) {
        text = text.substring(0, startOffset) + e.newText + text.substring(endOffset, text.length);
      } else {
        throw new Error("Overlapping edit");
      }
      lastModifiedOffset = startOffset;
    }
    return text;
  }
  TextDocument4.applyEdits = applyEdits;
  function mergeSort2(data, compare) {
    if (data.length <= 1) {
      return data;
    }
    const p = data.length / 2 | 0;
    const left = data.slice(0, p);
    const right = data.slice(p);
    mergeSort2(left, compare);
    mergeSort2(right, compare);
    let leftIdx = 0;
    let rightIdx = 0;
    let i = 0;
    while (leftIdx < left.length && rightIdx < right.length) {
      let ret = compare(left[leftIdx], right[rightIdx]);
      if (ret <= 0) {
        data[i++] = left[leftIdx++];
      } else {
        data[i++] = right[rightIdx++];
      }
    }
    while (leftIdx < left.length) {
      data[i++] = left[leftIdx++];
    }
    while (rightIdx < right.length) {
      data[i++] = right[rightIdx++];
    }
    return data;
  }
})(TextDocument || (TextDocument = {}));
var FullTextDocument = class {
  constructor(uri, languageId, version, content) {
    this._uri = uri;
    this._languageId = languageId;
    this._version = version;
    this._content = content;
    this._lineOffsets = void 0;
  }
  get uri() {
    return this._uri;
  }
  get languageId() {
    return this._languageId;
  }
  get version() {
    return this._version;
  }
  getText(range) {
    if (range) {
      let start = this.offsetAt(range.start);
      let end = this.offsetAt(range.end);
      return this._content.substring(start, end);
    }
    return this._content;
  }
  update(event, version) {
    this._content = event.text;
    this._version = version;
    this._lineOffsets = void 0;
  }
  getLineOffsets() {
    if (this._lineOffsets === void 0) {
      let lineOffsets = [];
      let text = this._content;
      let isLineStart = true;
      for (let i = 0; i < text.length; i++) {
        if (isLineStart) {
          lineOffsets.push(i);
          isLineStart = false;
        }
        let ch = text.charAt(i);
        isLineStart = ch === "\r" || ch === "\n";
        if (ch === "\r" && i + 1 < text.length && text.charAt(i + 1) === "\n") {
          i++;
        }
      }
      if (isLineStart && text.length > 0) {
        lineOffsets.push(text.length);
      }
      this._lineOffsets = lineOffsets;
    }
    return this._lineOffsets;
  }
  positionAt(offset) {
    offset = Math.max(Math.min(offset, this._content.length), 0);
    let lineOffsets = this.getLineOffsets();
    let low = 0, high = lineOffsets.length;
    if (high === 0) {
      return Position.create(0, offset);
    }
    while (low < high) {
      let mid = Math.floor((low + high) / 2);
      if (lineOffsets[mid] > offset) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    let line = low - 1;
    return Position.create(line, offset - lineOffsets[line]);
  }
  offsetAt(position) {
    let lineOffsets = this.getLineOffsets();
    if (position.line >= lineOffsets.length) {
      return this._content.length;
    } else if (position.line < 0) {
      return 0;
    }
    let lineOffset = lineOffsets[position.line];
    let nextLineOffset = position.line + 1 < lineOffsets.length ? lineOffsets[position.line + 1] : this._content.length;
    return Math.max(Math.min(lineOffset + position.character, nextLineOffset), lineOffset);
  }
  get lineCount() {
    return this.getLineOffsets().length;
  }
};
var Is;
(function(Is2) {
  const toString = Object.prototype.toString;
  function defined(value) {
    return typeof value !== "undefined";
  }
  Is2.defined = defined;
  function undefined2(value) {
    return typeof value === "undefined";
  }
  Is2.undefined = undefined2;
  function boolean(value) {
    return value === true || value === false;
  }
  Is2.boolean = boolean;
  function string(value) {
    return toString.call(value) === "[object String]";
  }
  Is2.string = string;
  function number(value) {
    return toString.call(value) === "[object Number]";
  }
  Is2.number = number;
  function numberRange(value, min, max) {
    return toString.call(value) === "[object Number]" && min <= value && value <= max;
  }
  Is2.numberRange = numberRange;
  function integer2(value) {
    return toString.call(value) === "[object Number]" && -2147483648 <= value && value <= 2147483647;
  }
  Is2.integer = integer2;
  function uinteger2(value) {
    return toString.call(value) === "[object Number]" && 0 <= value && value <= 2147483647;
  }
  Is2.uinteger = uinteger2;
  function func(value) {
    return toString.call(value) === "[object Function]";
  }
  Is2.func = func;
  function objectLiteral(value) {
    return value !== null && typeof value === "object";
  }
  Is2.objectLiteral = objectLiteral;
  function typedArray(value, check) {
    return Array.isArray(value) && value.every(check);
  }
  Is2.typedArray = typedArray;
})(Is || (Is = {}));

// node_modules/vscode-languageserver-textdocument/lib/esm/main.js
var FullTextDocument2 = class _FullTextDocument {
  constructor(uri, languageId, version, content) {
    this._uri = uri;
    this._languageId = languageId;
    this._version = version;
    this._content = content;
    this._lineOffsets = void 0;
  }
  get uri() {
    return this._uri;
  }
  get languageId() {
    return this._languageId;
  }
  get version() {
    return this._version;
  }
  getText(range) {
    if (range) {
      const start = this.offsetAt(range.start);
      const end = this.offsetAt(range.end);
      return this._content.substring(start, end);
    }
    return this._content;
  }
  update(changes, version) {
    for (const change of changes) {
      if (_FullTextDocument.isIncremental(change)) {
        const range = getWellformedRange(change.range);
        const startOffset = this.offsetAt(range.start);
        const endOffset = this.offsetAt(range.end);
        this._content = this._content.substring(0, startOffset) + change.text + this._content.substring(endOffset, this._content.length);
        const startLine = Math.max(range.start.line, 0);
        const endLine = Math.max(range.end.line, 0);
        let lineOffsets = this._lineOffsets;
        const addedLineOffsets = computeLineOffsets(change.text, false, startOffset);
        if (endLine - startLine === addedLineOffsets.length) {
          for (let i = 0, len = addedLineOffsets.length; i < len; i++) {
            lineOffsets[i + startLine + 1] = addedLineOffsets[i];
          }
        } else {
          if (addedLineOffsets.length < 1e4) {
            lineOffsets.splice(startLine + 1, endLine - startLine, ...addedLineOffsets);
          } else {
            this._lineOffsets = lineOffsets = lineOffsets.slice(0, startLine + 1).concat(addedLineOffsets, lineOffsets.slice(endLine + 1));
          }
        }
        const diff = change.text.length - (endOffset - startOffset);
        if (diff !== 0) {
          for (let i = startLine + 1 + addedLineOffsets.length, len = lineOffsets.length; i < len; i++) {
            lineOffsets[i] = lineOffsets[i] + diff;
          }
        }
      } else if (_FullTextDocument.isFull(change)) {
        this._content = change.text;
        this._lineOffsets = void 0;
      } else {
        throw new Error("Unknown change event received");
      }
    }
    this._version = version;
  }
  getLineOffsets() {
    if (this._lineOffsets === void 0) {
      this._lineOffsets = computeLineOffsets(this._content, true);
    }
    return this._lineOffsets;
  }
  positionAt(offset) {
    offset = Math.max(Math.min(offset, this._content.length), 0);
    const lineOffsets = this.getLineOffsets();
    let low = 0, high = lineOffsets.length;
    if (high === 0) {
      return { line: 0, character: offset };
    }
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (lineOffsets[mid] > offset) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    const line = low - 1;
    offset = this.ensureBeforeEOL(offset, lineOffsets[line]);
    return { line, character: offset - lineOffsets[line] };
  }
  offsetAt(position) {
    const lineOffsets = this.getLineOffsets();
    if (position.line >= lineOffsets.length) {
      return this._content.length;
    } else if (position.line < 0) {
      return 0;
    }
    const lineOffset = lineOffsets[position.line];
    if (position.character <= 0) {
      return lineOffset;
    }
    const nextLineOffset = position.line + 1 < lineOffsets.length ? lineOffsets[position.line + 1] : this._content.length;
    const offset = Math.min(lineOffset + position.character, nextLineOffset);
    return this.ensureBeforeEOL(offset, lineOffset);
  }
  ensureBeforeEOL(offset, lineOffset) {
    while (offset > lineOffset && isEOL(this._content.charCodeAt(offset - 1))) {
      offset--;
    }
    return offset;
  }
  get lineCount() {
    return this.getLineOffsets().length;
  }
  static isIncremental(event) {
    const candidate = event;
    return candidate !== void 0 && candidate !== null && typeof candidate.text === "string" && candidate.range !== void 0 && (candidate.rangeLength === void 0 || typeof candidate.rangeLength === "number");
  }
  static isFull(event) {
    const candidate = event;
    return candidate !== void 0 && candidate !== null && typeof candidate.text === "string" && candidate.range === void 0 && candidate.rangeLength === void 0;
  }
};
var TextDocument2;
(function(TextDocument4) {
  function create(uri, languageId, version, content) {
    return new FullTextDocument2(uri, languageId, version, content);
  }
  TextDocument4.create = create;
  function update(document, changes, version) {
    if (document instanceof FullTextDocument2) {
      document.update(changes, version);
      return document;
    } else {
      throw new Error("TextDocument.update: document must be created by TextDocument.create");
    }
  }
  TextDocument4.update = update;
  function applyEdits(document, edits) {
    const text = document.getText();
    const sortedEdits = mergeSort(edits.map(getWellformedEdit), (a, b) => {
      const diff = a.range.start.line - b.range.start.line;
      if (diff === 0) {
        return a.range.start.character - b.range.start.character;
      }
      return diff;
    });
    let lastModifiedOffset = 0;
    const spans = [];
    for (const e of sortedEdits) {
      const startOffset = document.offsetAt(e.range.start);
      if (startOffset < lastModifiedOffset) {
        throw new Error("Overlapping edit");
      } else if (startOffset > lastModifiedOffset) {
        spans.push(text.substring(lastModifiedOffset, startOffset));
      }
      if (e.newText.length) {
        spans.push(e.newText);
      }
      lastModifiedOffset = document.offsetAt(e.range.end);
    }
    spans.push(text.substr(lastModifiedOffset));
    return spans.join("");
  }
  TextDocument4.applyEdits = applyEdits;
})(TextDocument2 || (TextDocument2 = {}));
function mergeSort(data, compare) {
  if (data.length <= 1) {
    return data;
  }
  const p = data.length / 2 | 0;
  const left = data.slice(0, p);
  const right = data.slice(p);
  mergeSort(left, compare);
  mergeSort(right, compare);
  let leftIdx = 0;
  let rightIdx = 0;
  let i = 0;
  while (leftIdx < left.length && rightIdx < right.length) {
    const ret = compare(left[leftIdx], right[rightIdx]);
    if (ret <= 0) {
      data[i++] = left[leftIdx++];
    } else {
      data[i++] = right[rightIdx++];
    }
  }
  while (leftIdx < left.length) {
    data[i++] = left[leftIdx++];
  }
  while (rightIdx < right.length) {
    data[i++] = right[rightIdx++];
  }
  return data;
}
function computeLineOffsets(text, isAtLineStart, textOffset = 0) {
  const result = isAtLineStart ? [textOffset] : [];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (isEOL(ch)) {
      if (ch === 13 && i + 1 < text.length && text.charCodeAt(i + 1) === 10) {
        i++;
      }
      result.push(textOffset + i + 1);
    }
  }
  return result;
}
function isEOL(char) {
  return char === 13 || char === 10;
}
function getWellformedRange(range) {
  const start = range.start;
  const end = range.end;
  if (start.line > end.line || start.line === end.line && start.character > end.character) {
    return { start: end, end: start };
  }
  return range;
}
function getWellformedEdit(textEdit) {
  const range = getWellformedRange(textEdit.range);
  if (range !== textEdit.range) {
    return { newText: textEdit.newText, range };
  }
  return textEdit;
}

// node_modules/vscode-html-languageservice/lib/esm/htmlLanguageTypes.js
var TokenType;
(function(TokenType2) {
  TokenType2[TokenType2["StartCommentTag"] = 0] = "StartCommentTag";
  TokenType2[TokenType2["Comment"] = 1] = "Comment";
  TokenType2[TokenType2["EndCommentTag"] = 2] = "EndCommentTag";
  TokenType2[TokenType2["StartTagOpen"] = 3] = "StartTagOpen";
  TokenType2[TokenType2["StartTagClose"] = 4] = "StartTagClose";
  TokenType2[TokenType2["StartTagSelfClose"] = 5] = "StartTagSelfClose";
  TokenType2[TokenType2["StartTag"] = 6] = "StartTag";
  TokenType2[TokenType2["EndTagOpen"] = 7] = "EndTagOpen";
  TokenType2[TokenType2["EndTagClose"] = 8] = "EndTagClose";
  TokenType2[TokenType2["EndTag"] = 9] = "EndTag";
  TokenType2[TokenType2["DelimiterAssign"] = 10] = "DelimiterAssign";
  TokenType2[TokenType2["AttributeName"] = 11] = "AttributeName";
  TokenType2[TokenType2["AttributeValue"] = 12] = "AttributeValue";
  TokenType2[TokenType2["StartDoctypeTag"] = 13] = "StartDoctypeTag";
  TokenType2[TokenType2["Doctype"] = 14] = "Doctype";
  TokenType2[TokenType2["EndDoctypeTag"] = 15] = "EndDoctypeTag";
  TokenType2[TokenType2["Content"] = 16] = "Content";
  TokenType2[TokenType2["Whitespace"] = 17] = "Whitespace";
  TokenType2[TokenType2["Unknown"] = 18] = "Unknown";
  TokenType2[TokenType2["Script"] = 19] = "Script";
  TokenType2[TokenType2["Styles"] = 20] = "Styles";
  TokenType2[TokenType2["EOS"] = 21] = "EOS";
})(TokenType || (TokenType = {}));
var ScannerState;
(function(ScannerState2) {
  ScannerState2[ScannerState2["WithinContent"] = 0] = "WithinContent";
  ScannerState2[ScannerState2["AfterOpeningStartTag"] = 1] = "AfterOpeningStartTag";
  ScannerState2[ScannerState2["AfterOpeningEndTag"] = 2] = "AfterOpeningEndTag";
  ScannerState2[ScannerState2["WithinDoctype"] = 3] = "WithinDoctype";
  ScannerState2[ScannerState2["WithinTag"] = 4] = "WithinTag";
  ScannerState2[ScannerState2["WithinEndTag"] = 5] = "WithinEndTag";
  ScannerState2[ScannerState2["WithinComment"] = 6] = "WithinComment";
  ScannerState2[ScannerState2["WithinScriptContent"] = 7] = "WithinScriptContent";
  ScannerState2[ScannerState2["WithinStyleContent"] = 8] = "WithinStyleContent";
  ScannerState2[ScannerState2["AfterAttributeName"] = 9] = "AfterAttributeName";
  ScannerState2[ScannerState2["BeforeAttributeValue"] = 10] = "BeforeAttributeValue";
})(ScannerState || (ScannerState = {}));
var ClientCapabilities;
(function(ClientCapabilities2) {
  ClientCapabilities2.LATEST = {
    textDocument: {
      completion: {
        completionItem: {
          documentationFormat: [MarkupKind.Markdown, MarkupKind.PlainText]
        }
      },
      hover: {
        contentFormat: [MarkupKind.Markdown, MarkupKind.PlainText]
      }
    }
  };
})(ClientCapabilities || (ClientCapabilities = {}));
var FileType;
(function(FileType2) {
  FileType2[FileType2["Unknown"] = 0] = "Unknown";
  FileType2[FileType2["File"] = 1] = "File";
  FileType2[FileType2["Directory"] = 2] = "Directory";
  FileType2[FileType2["SymbolicLink"] = 64] = "SymbolicLink";
})(FileType || (FileType = {}));

// node_modules/vscode-html-languageservice/lib/esm/parser/htmlScanner.js
var MultiLineStream = class {
  constructor(source, position) {
    this.source = source;
    this.len = source.length;
    this.position = position;
  }
  eos() {
    return this.len <= this.position;
  }
  getSource() {
    return this.source;
  }
  pos() {
    return this.position;
  }
  goBackTo(pos) {
    this.position = pos;
  }
  goBack(n) {
    this.position -= n;
  }
  advance(n) {
    this.position += n;
  }
  goToEnd() {
    this.position = this.source.length;
  }
  nextChar() {
    return this.source.charCodeAt(this.position++) || 0;
  }
  peekChar(n = 0) {
    return this.source.charCodeAt(this.position + n) || 0;
  }
  advanceIfChar(ch) {
    if (ch === this.source.charCodeAt(this.position)) {
      this.position++;
      return true;
    }
    return false;
  }
  advanceIfChars(ch) {
    let i;
    if (this.position + ch.length > this.source.length) {
      return false;
    }
    for (i = 0; i < ch.length; i++) {
      if (this.source.charCodeAt(this.position + i) !== ch[i]) {
        return false;
      }
    }
    this.advance(i);
    return true;
  }
  advanceIfRegExp(regex) {
    const str = this.source.substr(this.position);
    const match = str.match(regex);
    if (match) {
      this.position = this.position + match.index + match[0].length;
      return match[0];
    }
    return "";
  }
  advanceUntilRegExp(regex) {
    const str = this.source.substr(this.position);
    const match = str.match(regex);
    if (match) {
      this.position = this.position + match.index;
      return match[0];
    } else {
      this.goToEnd();
    }
    return "";
  }
  advanceUntilChar(ch) {
    while (this.position < this.source.length) {
      if (this.source.charCodeAt(this.position) === ch) {
        return true;
      }
      this.advance(1);
    }
    return false;
  }
  advanceUntilChars(ch) {
    while (this.position + ch.length <= this.source.length) {
      let i = 0;
      for (; i < ch.length && this.source.charCodeAt(this.position + i) === ch[i]; i++) {
      }
      if (i === ch.length) {
        return true;
      }
      this.advance(1);
    }
    this.goToEnd();
    return false;
  }
  skipWhitespace() {
    const n = this.advanceWhileChar((ch) => {
      return ch === _WSP || ch === _TAB || ch === _NWL || ch === _LFD || ch === _CAR;
    });
    return n > 0;
  }
  advanceWhileChar(condition) {
    const posNow = this.position;
    while (this.position < this.len && condition(this.source.charCodeAt(this.position))) {
      this.position++;
    }
    return this.position - posNow;
  }
};
var _BNG = "!".charCodeAt(0);
var _MIN = "-".charCodeAt(0);
var _LAN = "<".charCodeAt(0);
var _RAN = ">".charCodeAt(0);
var _FSL = "/".charCodeAt(0);
var _EQS = "=".charCodeAt(0);
var _DQO = '"'.charCodeAt(0);
var _SQO = "'".charCodeAt(0);
var _NWL = "\n".charCodeAt(0);
var _CAR = "\r".charCodeAt(0);
var _LFD = "\f".charCodeAt(0);
var _WSP = " ".charCodeAt(0);
var _TAB = "	".charCodeAt(0);
var htmlScriptContents = {
  "text/x-handlebars-template": true,
  // Fix for https://github.com/microsoft/vscode/issues/77977
  "text/html": true
};
function createScanner(input, initialOffset = 0, initialState = ScannerState.WithinContent, emitPseudoCloseTags = false) {
  const stream = new MultiLineStream(input, initialOffset);
  let state = initialState;
  let tokenOffset = 0;
  let tokenType = TokenType.Unknown;
  let tokenError;
  let hasSpaceAfterTag;
  let lastTag;
  let lastAttributeName;
  let lastTypeValue;
  function nextElementName() {
    return stream.advanceIfRegExp(/^[_:\w][_:\w-.\d]*/).toLowerCase();
  }
  function nextAttributeName() {
    return stream.advanceIfRegExp(/^[^\s"'></=\x00-\x0F\x7F\x80-\x9F]*/).toLowerCase();
  }
  function finishToken(offset, type, errorMessage) {
    tokenType = type;
    tokenOffset = offset;
    tokenError = errorMessage;
    return type;
  }
  function scan() {
    const offset = stream.pos();
    const oldState = state;
    const token = internalScan();
    if (token !== TokenType.EOS && offset === stream.pos() && !(emitPseudoCloseTags && (token === TokenType.StartTagClose || token === TokenType.EndTagClose))) {
      console.warn("Scanner.scan has not advanced at offset " + offset + ", state before: " + oldState + " after: " + state);
      stream.advance(1);
      return finishToken(offset, TokenType.Unknown);
    }
    return token;
  }
  function internalScan() {
    const offset = stream.pos();
    if (stream.eos()) {
      return finishToken(offset, TokenType.EOS);
    }
    let errorMessage;
    switch (state) {
      case ScannerState.WithinComment:
        if (stream.advanceIfChars([_MIN, _MIN, _RAN])) {
          state = ScannerState.WithinContent;
          return finishToken(offset, TokenType.EndCommentTag);
        }
        stream.advanceUntilChars([_MIN, _MIN, _RAN]);
        return finishToken(offset, TokenType.Comment);
      case ScannerState.WithinDoctype:
        if (stream.advanceIfChar(_RAN)) {
          state = ScannerState.WithinContent;
          return finishToken(offset, TokenType.EndDoctypeTag);
        }
        stream.advanceUntilChar(_RAN);
        return finishToken(offset, TokenType.Doctype);
      case ScannerState.WithinContent:
        if (stream.advanceIfChar(_LAN)) {
          if (!stream.eos() && stream.peekChar() === _BNG) {
            if (stream.advanceIfChars([_BNG, _MIN, _MIN])) {
              state = ScannerState.WithinComment;
              return finishToken(offset, TokenType.StartCommentTag);
            }
            if (stream.advanceIfRegExp(/^!doctype/i)) {
              state = ScannerState.WithinDoctype;
              return finishToken(offset, TokenType.StartDoctypeTag);
            }
          }
          if (stream.advanceIfChar(_FSL)) {
            state = ScannerState.AfterOpeningEndTag;
            return finishToken(offset, TokenType.EndTagOpen);
          }
          state = ScannerState.AfterOpeningStartTag;
          return finishToken(offset, TokenType.StartTagOpen);
        }
        stream.advanceUntilChar(_LAN);
        return finishToken(offset, TokenType.Content);
      case ScannerState.AfterOpeningEndTag:
        const tagName = nextElementName();
        if (tagName.length > 0) {
          state = ScannerState.WithinEndTag;
          return finishToken(offset, TokenType.EndTag);
        }
        if (stream.skipWhitespace()) {
          return finishToken(offset, TokenType.Whitespace, t("Tag name must directly follow the open bracket."));
        }
        state = ScannerState.WithinEndTag;
        stream.advanceUntilChar(_RAN);
        if (offset < stream.pos()) {
          return finishToken(offset, TokenType.Unknown, t("End tag name expected."));
        }
        return internalScan();
      case ScannerState.WithinEndTag:
        if (stream.skipWhitespace()) {
          return finishToken(offset, TokenType.Whitespace);
        }
        if (stream.advanceIfChar(_RAN)) {
          state = ScannerState.WithinContent;
          return finishToken(offset, TokenType.EndTagClose);
        }
        if (emitPseudoCloseTags && stream.peekChar() === _LAN) {
          state = ScannerState.WithinContent;
          return finishToken(offset, TokenType.EndTagClose, t("Closing bracket missing."));
        }
        errorMessage = t("Closing bracket expected.");
        break;
      case ScannerState.AfterOpeningStartTag:
        lastTag = nextElementName();
        lastTypeValue = void 0;
        lastAttributeName = void 0;
        if (lastTag.length > 0) {
          hasSpaceAfterTag = false;
          state = ScannerState.WithinTag;
          return finishToken(offset, TokenType.StartTag);
        }
        if (stream.skipWhitespace()) {
          return finishToken(offset, TokenType.Whitespace, t("Tag name must directly follow the open bracket."));
        }
        state = ScannerState.WithinTag;
        stream.advanceUntilChar(_RAN);
        if (offset < stream.pos()) {
          return finishToken(offset, TokenType.Unknown, t("Start tag name expected."));
        }
        return internalScan();
      case ScannerState.WithinTag:
        if (stream.skipWhitespace()) {
          hasSpaceAfterTag = true;
          return finishToken(offset, TokenType.Whitespace);
        }
        if (hasSpaceAfterTag) {
          lastAttributeName = nextAttributeName();
          if (lastAttributeName.length > 0) {
            state = ScannerState.AfterAttributeName;
            hasSpaceAfterTag = false;
            return finishToken(offset, TokenType.AttributeName);
          }
        }
        if (stream.advanceIfChars([_FSL, _RAN])) {
          state = ScannerState.WithinContent;
          return finishToken(offset, TokenType.StartTagSelfClose);
        }
        if (stream.advanceIfChar(_RAN)) {
          if (lastTag === "script") {
            if (lastTypeValue && htmlScriptContents[lastTypeValue]) {
              state = ScannerState.WithinContent;
            } else {
              state = ScannerState.WithinScriptContent;
            }
          } else if (lastTag === "style") {
            state = ScannerState.WithinStyleContent;
          } else {
            state = ScannerState.WithinContent;
          }
          return finishToken(offset, TokenType.StartTagClose);
        }
        if (emitPseudoCloseTags && stream.peekChar() === _LAN) {
          state = ScannerState.WithinContent;
          return finishToken(offset, TokenType.StartTagClose, t("Closing bracket missing."));
        }
        stream.advance(1);
        return finishToken(offset, TokenType.Unknown, t("Unexpected character in tag."));
      case ScannerState.AfterAttributeName:
        if (stream.skipWhitespace()) {
          hasSpaceAfterTag = true;
          return finishToken(offset, TokenType.Whitespace);
        }
        if (stream.advanceIfChar(_EQS)) {
          state = ScannerState.BeforeAttributeValue;
          return finishToken(offset, TokenType.DelimiterAssign);
        }
        state = ScannerState.WithinTag;
        return internalScan();
      // no advance yet - jump to WithinTag
      case ScannerState.BeforeAttributeValue:
        if (stream.skipWhitespace()) {
          return finishToken(offset, TokenType.Whitespace);
        }
        let attributeValue = stream.advanceIfRegExp(/^[^\s"'`=<>]+/);
        if (attributeValue.length > 0) {
          if (stream.peekChar() === _RAN && stream.peekChar(-1) === _FSL) {
            stream.goBack(1);
            attributeValue = attributeValue.substring(0, attributeValue.length - 1);
          }
          if (lastAttributeName === "type") {
            lastTypeValue = attributeValue;
          }
          if (attributeValue.length > 0) {
            state = ScannerState.WithinTag;
            hasSpaceAfterTag = false;
            return finishToken(offset, TokenType.AttributeValue);
          }
        }
        const ch = stream.peekChar();
        if (ch === _SQO || ch === _DQO) {
          stream.advance(1);
          if (stream.advanceUntilChar(ch)) {
            stream.advance(1);
          }
          if (lastAttributeName === "type") {
            lastTypeValue = stream.getSource().substring(offset + 1, stream.pos() - 1);
          }
          state = ScannerState.WithinTag;
          hasSpaceAfterTag = false;
          return finishToken(offset, TokenType.AttributeValue);
        }
        state = ScannerState.WithinTag;
        hasSpaceAfterTag = false;
        return internalScan();
      // no advance yet - jump to WithinTag
      case ScannerState.WithinScriptContent:
        let sciptState = 1;
        while (!stream.eos()) {
          const match = stream.advanceIfRegExp(/<!--|-->|<\/?script\s*\/?>?/i);
          if (match.length === 0) {
            stream.goToEnd();
            return finishToken(offset, TokenType.Script);
          } else if (match === "<!--") {
            if (sciptState === 1) {
              sciptState = 2;
            }
          } else if (match === "-->") {
            sciptState = 1;
          } else if (match[1] !== "/") {
            if (sciptState === 2) {
              sciptState = 3;
            }
          } else {
            if (sciptState === 3) {
              sciptState = 2;
            } else {
              stream.goBack(match.length);
              break;
            }
          }
        }
        state = ScannerState.WithinContent;
        if (offset < stream.pos()) {
          return finishToken(offset, TokenType.Script);
        }
        return internalScan();
      // no advance yet - jump to content
      case ScannerState.WithinStyleContent:
        stream.advanceUntilRegExp(/<\/style/i);
        state = ScannerState.WithinContent;
        if (offset < stream.pos()) {
          return finishToken(offset, TokenType.Styles);
        }
        return internalScan();
    }
    stream.advance(1);
    state = ScannerState.WithinContent;
    return finishToken(offset, TokenType.Unknown, errorMessage);
  }
  return {
    scan,
    getTokenType: () => tokenType,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => stream.pos() - tokenOffset,
    getTokenEnd: () => stream.pos(),
    getTokenText: () => stream.getSource().substring(tokenOffset, stream.pos()),
    getScannerState: () => state,
    getTokenError: () => tokenError
  };
}

// node_modules/vscode-html-languageservice/lib/esm/utils/arrays.js
function findFirst(array, p) {
  let low = 0, high = array.length;
  if (high === 0) {
    return 0;
  }
  while (low < high) {
    let mid = Math.floor((low + high) / 2);
    if (p(array[mid])) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}
function binarySearch(array, key, comparator) {
  let low = 0, high = array.length - 1;
  while (low <= high) {
    const mid = (low + high) / 2 | 0;
    const comp = comparator(array[mid], key);
    if (comp < 0) {
      low = mid + 1;
    } else if (comp > 0) {
      high = mid - 1;
    } else {
      return mid;
    }
  }
  return -(low + 1);
}

// node_modules/vscode-html-languageservice/lib/esm/parser/htmlParser.js
var Node = class {
  get attributeNames() {
    return this.attributes ? Object.keys(this.attributes) : [];
  }
  constructor(start, end, children, parent) {
    this.start = start;
    this.end = end;
    this.children = children;
    this.parent = parent;
    this.closed = false;
  }
  isSameTag(tagInLowerCase) {
    if (this.tag === void 0) {
      return tagInLowerCase === void 0;
    } else {
      return tagInLowerCase !== void 0 && this.tag.length === tagInLowerCase.length && this.tag.toLowerCase() === tagInLowerCase;
    }
  }
  get firstChild() {
    return this.children[0];
  }
  get lastChild() {
    return this.children.length ? this.children[this.children.length - 1] : void 0;
  }
  findNodeBefore(offset) {
    const idx = findFirst(this.children, (c) => offset <= c.start) - 1;
    if (idx >= 0) {
      const child = this.children[idx];
      if (offset > child.start) {
        if (offset < child.end) {
          return child.findNodeBefore(offset);
        }
        const lastChild = child.lastChild;
        if (lastChild && lastChild.end === child.end) {
          return child.findNodeBefore(offset);
        }
        return child;
      }
    }
    return this;
  }
  findNodeAt(offset) {
    const idx = findFirst(this.children, (c) => offset <= c.start) - 1;
    if (idx >= 0) {
      const child = this.children[idx];
      if (offset > child.start && offset <= child.end) {
        return child.findNodeAt(offset);
      }
    }
    return this;
  }
};
var HTMLParser = class {
  constructor(dataManager) {
    this.dataManager = dataManager;
  }
  parseDocument(document) {
    return this.parse(document.getText(), this.dataManager.getVoidElements(document.languageId));
  }
  parse(text, voidElements) {
    const scanner = createScanner(text, void 0, void 0, true);
    const htmlDocument = new Node(0, text.length, [], void 0);
    let curr = htmlDocument;
    let endTagStart = -1;
    let endTagName = void 0;
    let pendingAttribute = null;
    let token = scanner.scan();
    while (token !== TokenType.EOS) {
      switch (token) {
        case TokenType.StartTagOpen:
          const child = new Node(scanner.getTokenOffset(), text.length, [], curr);
          curr.children.push(child);
          curr = child;
          break;
        case TokenType.StartTag:
          curr.tag = scanner.getTokenText();
          break;
        case TokenType.StartTagClose:
          if (curr.parent) {
            curr.end = scanner.getTokenEnd();
            if (scanner.getTokenLength()) {
              curr.startTagEnd = scanner.getTokenEnd();
              if (curr.tag && this.dataManager.isVoidElement(curr.tag, voidElements)) {
                curr.closed = true;
                curr = curr.parent;
              }
            } else {
              curr = curr.parent;
            }
          }
          break;
        case TokenType.StartTagSelfClose:
          if (curr.parent) {
            curr.closed = true;
            curr.end = scanner.getTokenEnd();
            curr.startTagEnd = scanner.getTokenEnd();
            curr = curr.parent;
          }
          break;
        case TokenType.EndTagOpen:
          endTagStart = scanner.getTokenOffset();
          endTagName = void 0;
          break;
        case TokenType.EndTag:
          endTagName = scanner.getTokenText().toLowerCase();
          break;
        case TokenType.EndTagClose:
          let node = curr;
          while (!node.isSameTag(endTagName) && node.parent) {
            node = node.parent;
          }
          if (node.parent) {
            while (curr !== node) {
              curr.end = endTagStart;
              curr.closed = false;
              curr = curr.parent;
            }
            curr.closed = true;
            curr.endTagStart = endTagStart;
            curr.end = scanner.getTokenEnd();
            curr = curr.parent;
          }
          break;
        case TokenType.AttributeName: {
          pendingAttribute = scanner.getTokenText();
          let attributes = curr.attributes;
          if (!attributes) {
            curr.attributes = attributes = {};
          }
          attributes[pendingAttribute] = null;
          break;
        }
        case TokenType.AttributeValue: {
          const value = scanner.getTokenText();
          const attributes = curr.attributes;
          if (attributes && pendingAttribute) {
            attributes[pendingAttribute] = value;
            pendingAttribute = null;
          }
          break;
        }
      }
      token = scanner.scan();
    }
    while (curr.parent) {
      curr.end = text.length;
      curr.closed = false;
      curr = curr.parent;
    }
    return {
      roots: htmlDocument.children,
      findNodeBefore: htmlDocument.findNodeBefore.bind(htmlDocument),
      findNodeAt: htmlDocument.findNodeAt.bind(htmlDocument)
    };
  }
};

// node_modules/vscode-html-languageservice/lib/esm/parser/htmlEntities.js
var entities = {
  "Aacute;": "\xC1",
  "Aacute": "\xC1",
  "aacute;": "\xE1",
  "aacute": "\xE1",
  "Abreve;": "\u0102",
  "abreve;": "\u0103",
  "ac;": "\u223E",
  "acd;": "\u223F",
  "acE;": "\u223E\u0333",
  "Acirc;": "\xC2",
  "Acirc": "\xC2",
  "acirc;": "\xE2",
  "acirc": "\xE2",
  "acute;": "\xB4",
  "acute": "\xB4",
  "Acy;": "\u0410",
  "acy;": "\u0430",
  "AElig;": "\xC6",
  "AElig": "\xC6",
  "aelig;": "\xE6",
  "aelig": "\xE6",
  "af;": "\u2061",
  "Afr;": "\u{1D504}",
  "afr;": "\u{1D51E}",
  "Agrave;": "\xC0",
  "Agrave": "\xC0",
  "agrave;": "\xE0",
  "agrave": "\xE0",
  "alefsym;": "\u2135",
  "aleph;": "\u2135",
  "Alpha;": "\u0391",
  "alpha;": "\u03B1",
  "Amacr;": "\u0100",
  "amacr;": "\u0101",
  "amalg;": "\u2A3F",
  "AMP;": "&",
  "AMP": "&",
  "amp;": "&",
  "amp": "&",
  "And;": "\u2A53",
  "and;": "\u2227",
  "andand;": "\u2A55",
  "andd;": "\u2A5C",
  "andslope;": "\u2A58",
  "andv;": "\u2A5A",
  "ang;": "\u2220",
  "ange;": "\u29A4",
  "angle;": "\u2220",
  "angmsd;": "\u2221",
  "angmsdaa;": "\u29A8",
  "angmsdab;": "\u29A9",
  "angmsdac;": "\u29AA",
  "angmsdad;": "\u29AB",
  "angmsdae;": "\u29AC",
  "angmsdaf;": "\u29AD",
  "angmsdag;": "\u29AE",
  "angmsdah;": "\u29AF",
  "angrt;": "\u221F",
  "angrtvb;": "\u22BE",
  "angrtvbd;": "\u299D",
  "angsph;": "\u2222",
  "angst;": "\xC5",
  "angzarr;": "\u237C",
  "Aogon;": "\u0104",
  "aogon;": "\u0105",
  "Aopf;": "\u{1D538}",
  "aopf;": "\u{1D552}",
  "ap;": "\u2248",
  "apacir;": "\u2A6F",
  "apE;": "\u2A70",
  "ape;": "\u224A",
  "apid;": "\u224B",
  "apos;": "'",
  "ApplyFunction;": "\u2061",
  "approx;": "\u2248",
  "approxeq;": "\u224A",
  "Aring;": "\xC5",
  "Aring": "\xC5",
  "aring;": "\xE5",
  "aring": "\xE5",
  "Ascr;": "\u{1D49C}",
  "ascr;": "\u{1D4B6}",
  "Assign;": "\u2254",
  "ast;": "*",
  "asymp;": "\u2248",
  "asympeq;": "\u224D",
  "Atilde;": "\xC3",
  "Atilde": "\xC3",
  "atilde;": "\xE3",
  "atilde": "\xE3",
  "Auml;": "\xC4",
  "Auml": "\xC4",
  "auml;": "\xE4",
  "auml": "\xE4",
  "awconint;": "\u2233",
  "awint;": "\u2A11",
  "backcong;": "\u224C",
  "backepsilon;": "\u03F6",
  "backprime;": "\u2035",
  "backsim;": "\u223D",
  "backsimeq;": "\u22CD",
  "Backslash;": "\u2216",
  "Barv;": "\u2AE7",
  "barvee;": "\u22BD",
  "Barwed;": "\u2306",
  "barwed;": "\u2305",
  "barwedge;": "\u2305",
  "bbrk;": "\u23B5",
  "bbrktbrk;": "\u23B6",
  "bcong;": "\u224C",
  "Bcy;": "\u0411",
  "bcy;": "\u0431",
  "bdquo;": "\u201E",
  "becaus;": "\u2235",
  "Because;": "\u2235",
  "because;": "\u2235",
  "bemptyv;": "\u29B0",
  "bepsi;": "\u03F6",
  "bernou;": "\u212C",
  "Bernoullis;": "\u212C",
  "Beta;": "\u0392",
  "beta;": "\u03B2",
  "beth;": "\u2136",
  "between;": "\u226C",
  "Bfr;": "\u{1D505}",
  "bfr;": "\u{1D51F}",
  "bigcap;": "\u22C2",
  "bigcirc;": "\u25EF",
  "bigcup;": "\u22C3",
  "bigodot;": "\u2A00",
  "bigoplus;": "\u2A01",
  "bigotimes;": "\u2A02",
  "bigsqcup;": "\u2A06",
  "bigstar;": "\u2605",
  "bigtriangledown;": "\u25BD",
  "bigtriangleup;": "\u25B3",
  "biguplus;": "\u2A04",
  "bigvee;": "\u22C1",
  "bigwedge;": "\u22C0",
  "bkarow;": "\u290D",
  "blacklozenge;": "\u29EB",
  "blacksquare;": "\u25AA",
  "blacktriangle;": "\u25B4",
  "blacktriangledown;": "\u25BE",
  "blacktriangleleft;": "\u25C2",
  "blacktriangleright;": "\u25B8",
  "blank;": "\u2423",
  "blk12;": "\u2592",
  "blk14;": "\u2591",
  "blk34;": "\u2593",
  "block;": "\u2588",
  "bne;": "=\u20E5",
  "bnequiv;": "\u2261\u20E5",
  "bNot;": "\u2AED",
  "bnot;": "\u2310",
  "Bopf;": "\u{1D539}",
  "bopf;": "\u{1D553}",
  "bot;": "\u22A5",
  "bottom;": "\u22A5",
  "bowtie;": "\u22C8",
  "boxbox;": "\u29C9",
  "boxDL;": "\u2557",
  "boxDl;": "\u2556",
  "boxdL;": "\u2555",
  "boxdl;": "\u2510",
  "boxDR;": "\u2554",
  "boxDr;": "\u2553",
  "boxdR;": "\u2552",
  "boxdr;": "\u250C",
  "boxH;": "\u2550",
  "boxh;": "\u2500",
  "boxHD;": "\u2566",
  "boxHd;": "\u2564",
  "boxhD;": "\u2565",
  "boxhd;": "\u252C",
  "boxHU;": "\u2569",
  "boxHu;": "\u2567",
  "boxhU;": "\u2568",
  "boxhu;": "\u2534",
  "boxminus;": "\u229F",
  "boxplus;": "\u229E",
  "boxtimes;": "\u22A0",
  "boxUL;": "\u255D",
  "boxUl;": "\u255C",
  "boxuL;": "\u255B",
  "boxul;": "\u2518",
  "boxUR;": "\u255A",
  "boxUr;": "\u2559",
  "boxuR;": "\u2558",
  "boxur;": "\u2514",
  "boxV;": "\u2551",
  "boxv;": "\u2502",
  "boxVH;": "\u256C",
  "boxVh;": "\u256B",
  "boxvH;": "\u256A",
  "boxvh;": "\u253C",
  "boxVL;": "\u2563",
  "boxVl;": "\u2562",
  "boxvL;": "\u2561",
  "boxvl;": "\u2524",
  "boxVR;": "\u2560",
  "boxVr;": "\u255F",
  "boxvR;": "\u255E",
  "boxvr;": "\u251C",
  "bprime;": "\u2035",
  "Breve;": "\u02D8",
  "breve;": "\u02D8",
  "brvbar;": "\xA6",
  "brvbar": "\xA6",
  "Bscr;": "\u212C",
  "bscr;": "\u{1D4B7}",
  "bsemi;": "\u204F",
  "bsim;": "\u223D",
  "bsime;": "\u22CD",
  "bsol;": "\\",
  "bsolb;": "\u29C5",
  "bsolhsub;": "\u27C8",
  "bull;": "\u2022",
  "bullet;": "\u2022",
  "bump;": "\u224E",
  "bumpE;": "\u2AAE",
  "bumpe;": "\u224F",
  "Bumpeq;": "\u224E",
  "bumpeq;": "\u224F",
  "Cacute;": "\u0106",
  "cacute;": "\u0107",
  "Cap;": "\u22D2",
  "cap;": "\u2229",
  "capand;": "\u2A44",
  "capbrcup;": "\u2A49",
  "capcap;": "\u2A4B",
  "capcup;": "\u2A47",
  "capdot;": "\u2A40",
  "CapitalDifferentialD;": "\u2145",
  "caps;": "\u2229\uFE00",
  "caret;": "\u2041",
  "caron;": "\u02C7",
  "Cayleys;": "\u212D",
  "ccaps;": "\u2A4D",
  "Ccaron;": "\u010C",
  "ccaron;": "\u010D",
  "Ccedil;": "\xC7",
  "Ccedil": "\xC7",
  "ccedil;": "\xE7",
  "ccedil": "\xE7",
  "Ccirc;": "\u0108",
  "ccirc;": "\u0109",
  "Cconint;": "\u2230",
  "ccups;": "\u2A4C",
  "ccupssm;": "\u2A50",
  "Cdot;": "\u010A",
  "cdot;": "\u010B",
  "cedil;": "\xB8",
  "cedil": "\xB8",
  "Cedilla;": "\xB8",
  "cemptyv;": "\u29B2",
  "cent;": "\xA2",
  "cent": "\xA2",
  "CenterDot;": "\xB7",
  "centerdot;": "\xB7",
  "Cfr;": "\u212D",
  "cfr;": "\u{1D520}",
  "CHcy;": "\u0427",
  "chcy;": "\u0447",
  "check;": "\u2713",
  "checkmark;": "\u2713",
  "Chi;": "\u03A7",
  "chi;": "\u03C7",
  "cir;": "\u25CB",
  "circ;": "\u02C6",
  "circeq;": "\u2257",
  "circlearrowleft;": "\u21BA",
  "circlearrowright;": "\u21BB",
  "circledast;": "\u229B",
  "circledcirc;": "\u229A",
  "circleddash;": "\u229D",
  "CircleDot;": "\u2299",
  "circledR;": "\xAE",
  "circledS;": "\u24C8",
  "CircleMinus;": "\u2296",
  "CirclePlus;": "\u2295",
  "CircleTimes;": "\u2297",
  "cirE;": "\u29C3",
  "cire;": "\u2257",
  "cirfnint;": "\u2A10",
  "cirmid;": "\u2AEF",
  "cirscir;": "\u29C2",
  "ClockwiseContourIntegral;": "\u2232",
  "CloseCurlyDoubleQuote;": "\u201D",
  "CloseCurlyQuote;": "\u2019",
  "clubs;": "\u2663",
  "clubsuit;": "\u2663",
  "Colon;": "\u2237",
  "colon;": ":",
  "Colone;": "\u2A74",
  "colone;": "\u2254",
  "coloneq;": "\u2254",
  "comma;": ",",
  "commat;": "@",
  "comp;": "\u2201",
  "compfn;": "\u2218",
  "complement;": "\u2201",
  "complexes;": "\u2102",
  "cong;": "\u2245",
  "congdot;": "\u2A6D",
  "Congruent;": "\u2261",
  "Conint;": "\u222F",
  "conint;": "\u222E",
  "ContourIntegral;": "\u222E",
  "Copf;": "\u2102",
  "copf;": "\u{1D554}",
  "coprod;": "\u2210",
  "Coproduct;": "\u2210",
  "COPY;": "\xA9",
  "COPY": "\xA9",
  "copy;": "\xA9",
  "copy": "\xA9",
  "copysr;": "\u2117",
  "CounterClockwiseContourIntegral;": "\u2233",
  "crarr;": "\u21B5",
  "Cross;": "\u2A2F",
  "cross;": "\u2717",
  "Cscr;": "\u{1D49E}",
  "cscr;": "\u{1D4B8}",
  "csub;": "\u2ACF",
  "csube;": "\u2AD1",
  "csup;": "\u2AD0",
  "csupe;": "\u2AD2",
  "ctdot;": "\u22EF",
  "cudarrl;": "\u2938",
  "cudarrr;": "\u2935",
  "cuepr;": "\u22DE",
  "cuesc;": "\u22DF",
  "cularr;": "\u21B6",
  "cularrp;": "\u293D",
  "Cup;": "\u22D3",
  "cup;": "\u222A",
  "cupbrcap;": "\u2A48",
  "CupCap;": "\u224D",
  "cupcap;": "\u2A46",
  "cupcup;": "\u2A4A",
  "cupdot;": "\u228D",
  "cupor;": "\u2A45",
  "cups;": "\u222A\uFE00",
  "curarr;": "\u21B7",
  "curarrm;": "\u293C",
  "curlyeqprec;": "\u22DE",
  "curlyeqsucc;": "\u22DF",
  "curlyvee;": "\u22CE",
  "curlywedge;": "\u22CF",
  "curren;": "\xA4",
  "curren": "\xA4",
  "curvearrowleft;": "\u21B6",
  "curvearrowright;": "\u21B7",
  "cuvee;": "\u22CE",
  "cuwed;": "\u22CF",
  "cwconint;": "\u2232",
  "cwint;": "\u2231",
  "cylcty;": "\u232D",
  "Dagger;": "\u2021",
  "dagger;": "\u2020",
  "daleth;": "\u2138",
  "Darr;": "\u21A1",
  "dArr;": "\u21D3",
  "darr;": "\u2193",
  "dash;": "\u2010",
  "Dashv;": "\u2AE4",
  "dashv;": "\u22A3",
  "dbkarow;": "\u290F",
  "dblac;": "\u02DD",
  "Dcaron;": "\u010E",
  "dcaron;": "\u010F",
  "Dcy;": "\u0414",
  "dcy;": "\u0434",
  "DD;": "\u2145",
  "dd;": "\u2146",
  "ddagger;": "\u2021",
  "ddarr;": "\u21CA",
  "DDotrahd;": "\u2911",
  "ddotseq;": "\u2A77",
  "deg;": "\xB0",
  "deg": "\xB0",
  "Del;": "\u2207",
  "Delta;": "\u0394",
  "delta;": "\u03B4",
  "demptyv;": "\u29B1",
  "dfisht;": "\u297F",
  "Dfr;": "\u{1D507}",
  "dfr;": "\u{1D521}",
  "dHar;": "\u2965",
  "dharl;": "\u21C3",
  "dharr;": "\u21C2",
  "DiacriticalAcute;": "\xB4",
  "DiacriticalDot;": "\u02D9",
  "DiacriticalDoubleAcute;": "\u02DD",
  "DiacriticalGrave;": "`",
  "DiacriticalTilde;": "\u02DC",
  "diam;": "\u22C4",
  "Diamond;": "\u22C4",
  "diamond;": "\u22C4",
  "diamondsuit;": "\u2666",
  "diams;": "\u2666",
  "die;": "\xA8",
  "DifferentialD;": "\u2146",
  "digamma;": "\u03DD",
  "disin;": "\u22F2",
  "div;": "\xF7",
  "divide;": "\xF7",
  "divide": "\xF7",
  "divideontimes;": "\u22C7",
  "divonx;": "\u22C7",
  "DJcy;": "\u0402",
  "djcy;": "\u0452",
  "dlcorn;": "\u231E",
  "dlcrop;": "\u230D",
  "dollar;": "$",
  "Dopf;": "\u{1D53B}",
  "dopf;": "\u{1D555}",
  "Dot;": "\xA8",
  "dot;": "\u02D9",
  "DotDot;": "\u20DC",
  "doteq;": "\u2250",
  "doteqdot;": "\u2251",
  "DotEqual;": "\u2250",
  "dotminus;": "\u2238",
  "dotplus;": "\u2214",
  "dotsquare;": "\u22A1",
  "doublebarwedge;": "\u2306",
  "DoubleContourIntegral;": "\u222F",
  "DoubleDot;": "\xA8",
  "DoubleDownArrow;": "\u21D3",
  "DoubleLeftArrow;": "\u21D0",
  "DoubleLeftRightArrow;": "\u21D4",
  "DoubleLeftTee;": "\u2AE4",
  "DoubleLongLeftArrow;": "\u27F8",
  "DoubleLongLeftRightArrow;": "\u27FA",
  "DoubleLongRightArrow;": "\u27F9",
  "DoubleRightArrow;": "\u21D2",
  "DoubleRightTee;": "\u22A8",
  "DoubleUpArrow;": "\u21D1",
  "DoubleUpDownArrow;": "\u21D5",
  "DoubleVerticalBar;": "\u2225",
  "DownArrow;": "\u2193",
  "Downarrow;": "\u21D3",
  "downarrow;": "\u2193",
  "DownArrowBar;": "\u2913",
  "DownArrowUpArrow;": "\u21F5",
  "DownBreve;": "\u0311",
  "downdownarrows;": "\u21CA",
  "downharpoonleft;": "\u21C3",
  "downharpoonright;": "\u21C2",
  "DownLeftRightVector;": "\u2950",
  "DownLeftTeeVector;": "\u295E",
  "DownLeftVector;": "\u21BD",
  "DownLeftVectorBar;": "\u2956",
  "DownRightTeeVector;": "\u295F",
  "DownRightVector;": "\u21C1",
  "DownRightVectorBar;": "\u2957",
  "DownTee;": "\u22A4",
  "DownTeeArrow;": "\u21A7",
  "drbkarow;": "\u2910",
  "drcorn;": "\u231F",
  "drcrop;": "\u230C",
  "Dscr;": "\u{1D49F}",
  "dscr;": "\u{1D4B9}",
  "DScy;": "\u0405",
  "dscy;": "\u0455",
  "dsol;": "\u29F6",
  "Dstrok;": "\u0110",
  "dstrok;": "\u0111",
  "dtdot;": "\u22F1",
  "dtri;": "\u25BF",
  "dtrif;": "\u25BE",
  "duarr;": "\u21F5",
  "duhar;": "\u296F",
  "dwangle;": "\u29A6",
  "DZcy;": "\u040F",
  "dzcy;": "\u045F",
  "dzigrarr;": "\u27FF",
  "Eacute;": "\xC9",
  "Eacute": "\xC9",
  "eacute;": "\xE9",
  "eacute": "\xE9",
  "easter;": "\u2A6E",
  "Ecaron;": "\u011A",
  "ecaron;": "\u011B",
  "ecir;": "\u2256",
  "Ecirc;": "\xCA",
  "Ecirc": "\xCA",
  "ecirc;": "\xEA",
  "ecirc": "\xEA",
  "ecolon;": "\u2255",
  "Ecy;": "\u042D",
  "ecy;": "\u044D",
  "eDDot;": "\u2A77",
  "Edot;": "\u0116",
  "eDot;": "\u2251",
  "edot;": "\u0117",
  "ee;": "\u2147",
  "efDot;": "\u2252",
  "Efr;": "\u{1D508}",
  "efr;": "\u{1D522}",
  "eg;": "\u2A9A",
  "Egrave;": "\xC8",
  "Egrave": "\xC8",
  "egrave;": "\xE8",
  "egrave": "\xE8",
  "egs;": "\u2A96",
  "egsdot;": "\u2A98",
  "el;": "\u2A99",
  "Element;": "\u2208",
  "elinters;": "\u23E7",
  "ell;": "\u2113",
  "els;": "\u2A95",
  "elsdot;": "\u2A97",
  "Emacr;": "\u0112",
  "emacr;": "\u0113",
  "empty;": "\u2205",
  "emptyset;": "\u2205",
  "EmptySmallSquare;": "\u25FB",
  "emptyv;": "\u2205",
  "EmptyVerySmallSquare;": "\u25AB",
  "emsp;": "\u2003",
  "emsp13;": "\u2004",
  "emsp14;": "\u2005",
  "ENG;": "\u014A",
  "eng;": "\u014B",
  "ensp;": "\u2002",
  "Eogon;": "\u0118",
  "eogon;": "\u0119",
  "Eopf;": "\u{1D53C}",
  "eopf;": "\u{1D556}",
  "epar;": "\u22D5",
  "eparsl;": "\u29E3",
  "eplus;": "\u2A71",
  "epsi;": "\u03B5",
  "Epsilon;": "\u0395",
  "epsilon;": "\u03B5",
  "epsiv;": "\u03F5",
  "eqcirc;": "\u2256",
  "eqcolon;": "\u2255",
  "eqsim;": "\u2242",
  "eqslantgtr;": "\u2A96",
  "eqslantless;": "\u2A95",
  "Equal;": "\u2A75",
  "equals;": "=",
  "EqualTilde;": "\u2242",
  "equest;": "\u225F",
  "Equilibrium;": "\u21CC",
  "equiv;": "\u2261",
  "equivDD;": "\u2A78",
  "eqvparsl;": "\u29E5",
  "erarr;": "\u2971",
  "erDot;": "\u2253",
  "Escr;": "\u2130",
  "escr;": "\u212F",
  "esdot;": "\u2250",
  "Esim;": "\u2A73",
  "esim;": "\u2242",
  "Eta;": "\u0397",
  "eta;": "\u03B7",
  "ETH;": "\xD0",
  "ETH": "\xD0",
  "eth;": "\xF0",
  "eth": "\xF0",
  "Euml;": "\xCB",
  "Euml": "\xCB",
  "euml;": "\xEB",
  "euml": "\xEB",
  "euro;": "\u20AC",
  "excl;": "!",
  "exist;": "\u2203",
  "Exists;": "\u2203",
  "expectation;": "\u2130",
  "ExponentialE;": "\u2147",
  "exponentiale;": "\u2147",
  "fallingdotseq;": "\u2252",
  "Fcy;": "\u0424",
  "fcy;": "\u0444",
  "female;": "\u2640",
  "ffilig;": "\uFB03",
  "fflig;": "\uFB00",
  "ffllig;": "\uFB04",
  "Ffr;": "\u{1D509}",
  "ffr;": "\u{1D523}",
  "filig;": "\uFB01",
  "FilledSmallSquare;": "\u25FC",
  "FilledVerySmallSquare;": "\u25AA",
  "fjlig;": "fj",
  "flat;": "\u266D",
  "fllig;": "\uFB02",
  "fltns;": "\u25B1",
  "fnof;": "\u0192",
  "Fopf;": "\u{1D53D}",
  "fopf;": "\u{1D557}",
  "ForAll;": "\u2200",
  "forall;": "\u2200",
  "fork;": "\u22D4",
  "forkv;": "\u2AD9",
  "Fouriertrf;": "\u2131",
  "fpartint;": "\u2A0D",
  "frac12;": "\xBD",
  "frac12": "\xBD",
  "frac13;": "\u2153",
  "frac14;": "\xBC",
  "frac14": "\xBC",
  "frac15;": "\u2155",
  "frac16;": "\u2159",
  "frac18;": "\u215B",
  "frac23;": "\u2154",
  "frac25;": "\u2156",
  "frac34;": "\xBE",
  "frac34": "\xBE",
  "frac35;": "\u2157",
  "frac38;": "\u215C",
  "frac45;": "\u2158",
  "frac56;": "\u215A",
  "frac58;": "\u215D",
  "frac78;": "\u215E",
  "frasl;": "\u2044",
  "frown;": "\u2322",
  "Fscr;": "\u2131",
  "fscr;": "\u{1D4BB}",
  "gacute;": "\u01F5",
  "Gamma;": "\u0393",
  "gamma;": "\u03B3",
  "Gammad;": "\u03DC",
  "gammad;": "\u03DD",
  "gap;": "\u2A86",
  "Gbreve;": "\u011E",
  "gbreve;": "\u011F",
  "Gcedil;": "\u0122",
  "Gcirc;": "\u011C",
  "gcirc;": "\u011D",
  "Gcy;": "\u0413",
  "gcy;": "\u0433",
  "Gdot;": "\u0120",
  "gdot;": "\u0121",
  "gE;": "\u2267",
  "ge;": "\u2265",
  "gEl;": "\u2A8C",
  "gel;": "\u22DB",
  "geq;": "\u2265",
  "geqq;": "\u2267",
  "geqslant;": "\u2A7E",
  "ges;": "\u2A7E",
  "gescc;": "\u2AA9",
  "gesdot;": "\u2A80",
  "gesdoto;": "\u2A82",
  "gesdotol;": "\u2A84",
  "gesl;": "\u22DB\uFE00",
  "gesles;": "\u2A94",
  "Gfr;": "\u{1D50A}",
  "gfr;": "\u{1D524}",
  "Gg;": "\u22D9",
  "gg;": "\u226B",
  "ggg;": "\u22D9",
  "gimel;": "\u2137",
  "GJcy;": "\u0403",
  "gjcy;": "\u0453",
  "gl;": "\u2277",
  "gla;": "\u2AA5",
  "glE;": "\u2A92",
  "glj;": "\u2AA4",
  "gnap;": "\u2A8A",
  "gnapprox;": "\u2A8A",
  "gnE;": "\u2269",
  "gne;": "\u2A88",
  "gneq;": "\u2A88",
  "gneqq;": "\u2269",
  "gnsim;": "\u22E7",
  "Gopf;": "\u{1D53E}",
  "gopf;": "\u{1D558}",
  "grave;": "`",
  "GreaterEqual;": "\u2265",
  "GreaterEqualLess;": "\u22DB",
  "GreaterFullEqual;": "\u2267",
  "GreaterGreater;": "\u2AA2",
  "GreaterLess;": "\u2277",
  "GreaterSlantEqual;": "\u2A7E",
  "GreaterTilde;": "\u2273",
  "Gscr;": "\u{1D4A2}",
  "gscr;": "\u210A",
  "gsim;": "\u2273",
  "gsime;": "\u2A8E",
  "gsiml;": "\u2A90",
  "GT;": ">",
  "GT": ">",
  "Gt;": "\u226B",
  "gt;": ">",
  "gt": ">",
  "gtcc;": "\u2AA7",
  "gtcir;": "\u2A7A",
  "gtdot;": "\u22D7",
  "gtlPar;": "\u2995",
  "gtquest;": "\u2A7C",
  "gtrapprox;": "\u2A86",
  "gtrarr;": "\u2978",
  "gtrdot;": "\u22D7",
  "gtreqless;": "\u22DB",
  "gtreqqless;": "\u2A8C",
  "gtrless;": "\u2277",
  "gtrsim;": "\u2273",
  "gvertneqq;": "\u2269\uFE00",
  "gvnE;": "\u2269\uFE00",
  "Hacek;": "\u02C7",
  "hairsp;": "\u200A",
  "half;": "\xBD",
  "hamilt;": "\u210B",
  "HARDcy;": "\u042A",
  "hardcy;": "\u044A",
  "hArr;": "\u21D4",
  "harr;": "\u2194",
  "harrcir;": "\u2948",
  "harrw;": "\u21AD",
  "Hat;": "^",
  "hbar;": "\u210F",
  "Hcirc;": "\u0124",
  "hcirc;": "\u0125",
  "hearts;": "\u2665",
  "heartsuit;": "\u2665",
  "hellip;": "\u2026",
  "hercon;": "\u22B9",
  "Hfr;": "\u210C",
  "hfr;": "\u{1D525}",
  "HilbertSpace;": "\u210B",
  "hksearow;": "\u2925",
  "hkswarow;": "\u2926",
  "hoarr;": "\u21FF",
  "homtht;": "\u223B",
  "hookleftarrow;": "\u21A9",
  "hookrightarrow;": "\u21AA",
  "Hopf;": "\u210D",
  "hopf;": "\u{1D559}",
  "horbar;": "\u2015",
  "HorizontalLine;": "\u2500",
  "Hscr;": "\u210B",
  "hscr;": "\u{1D4BD}",
  "hslash;": "\u210F",
  "Hstrok;": "\u0126",
  "hstrok;": "\u0127",
  "HumpDownHump;": "\u224E",
  "HumpEqual;": "\u224F",
  "hybull;": "\u2043",
  "hyphen;": "\u2010",
  "Iacute;": "\xCD",
  "Iacute": "\xCD",
  "iacute;": "\xED",
  "iacute": "\xED",
  "ic;": "\u2063",
  "Icirc;": "\xCE",
  "Icirc": "\xCE",
  "icirc;": "\xEE",
  "icirc": "\xEE",
  "Icy;": "\u0418",
  "icy;": "\u0438",
  "Idot;": "\u0130",
  "IEcy;": "\u0415",
  "iecy;": "\u0435",
  "iexcl;": "\xA1",
  "iexcl": "\xA1",
  "iff;": "\u21D4",
  "Ifr;": "\u2111",
  "ifr;": "\u{1D526}",
  "Igrave;": "\xCC",
  "Igrave": "\xCC",
  "igrave;": "\xEC",
  "igrave": "\xEC",
  "ii;": "\u2148",
  "iiiint;": "\u2A0C",
  "iiint;": "\u222D",
  "iinfin;": "\u29DC",
  "iiota;": "\u2129",
  "IJlig;": "\u0132",
  "ijlig;": "\u0133",
  "Im;": "\u2111",
  "Imacr;": "\u012A",
  "imacr;": "\u012B",
  "image;": "\u2111",
  "ImaginaryI;": "\u2148",
  "imagline;": "\u2110",
  "imagpart;": "\u2111",
  "imath;": "\u0131",
  "imof;": "\u22B7",
  "imped;": "\u01B5",
  "Implies;": "\u21D2",
  "in;": "\u2208",
  "incare;": "\u2105",
  "infin;": "\u221E",
  "infintie;": "\u29DD",
  "inodot;": "\u0131",
  "Int;": "\u222C",
  "int;": "\u222B",
  "intcal;": "\u22BA",
  "integers;": "\u2124",
  "Integral;": "\u222B",
  "intercal;": "\u22BA",
  "Intersection;": "\u22C2",
  "intlarhk;": "\u2A17",
  "intprod;": "\u2A3C",
  "InvisibleComma;": "\u2063",
  "InvisibleTimes;": "\u2062",
  "IOcy;": "\u0401",
  "iocy;": "\u0451",
  "Iogon;": "\u012E",
  "iogon;": "\u012F",
  "Iopf;": "\u{1D540}",
  "iopf;": "\u{1D55A}",
  "Iota;": "\u0399",
  "iota;": "\u03B9",
  "iprod;": "\u2A3C",
  "iquest;": "\xBF",
  "iquest": "\xBF",
  "Iscr;": "\u2110",
  "iscr;": "\u{1D4BE}",
  "isin;": "\u2208",
  "isindot;": "\u22F5",
  "isinE;": "\u22F9",
  "isins;": "\u22F4",
  "isinsv;": "\u22F3",
  "isinv;": "\u2208",
  "it;": "\u2062",
  "Itilde;": "\u0128",
  "itilde;": "\u0129",
  "Iukcy;": "\u0406",
  "iukcy;": "\u0456",
  "Iuml;": "\xCF",
  "Iuml": "\xCF",
  "iuml;": "\xEF",
  "iuml": "\xEF",
  "Jcirc;": "\u0134",
  "jcirc;": "\u0135",
  "Jcy;": "\u0419",
  "jcy;": "\u0439",
  "Jfr;": "\u{1D50D}",
  "jfr;": "\u{1D527}",
  "jmath;": "\u0237",
  "Jopf;": "\u{1D541}",
  "jopf;": "\u{1D55B}",
  "Jscr;": "\u{1D4A5}",
  "jscr;": "\u{1D4BF}",
  "Jsercy;": "\u0408",
  "jsercy;": "\u0458",
  "Jukcy;": "\u0404",
  "jukcy;": "\u0454",
  "Kappa;": "\u039A",
  "kappa;": "\u03BA",
  "kappav;": "\u03F0",
  "Kcedil;": "\u0136",
  "kcedil;": "\u0137",
  "Kcy;": "\u041A",
  "kcy;": "\u043A",
  "Kfr;": "\u{1D50E}",
  "kfr;": "\u{1D528}",
  "kgreen;": "\u0138",
  "KHcy;": "\u0425",
  "khcy;": "\u0445",
  "KJcy;": "\u040C",
  "kjcy;": "\u045C",
  "Kopf;": "\u{1D542}",
  "kopf;": "\u{1D55C}",
  "Kscr;": "\u{1D4A6}",
  "kscr;": "\u{1D4C0}",
  "lAarr;": "\u21DA",
  "Lacute;": "\u0139",
  "lacute;": "\u013A",
  "laemptyv;": "\u29B4",
  "lagran;": "\u2112",
  "Lambda;": "\u039B",
  "lambda;": "\u03BB",
  "Lang;": "\u27EA",
  "lang;": "\u27E8",
  "langd;": "\u2991",
  "langle;": "\u27E8",
  "lap;": "\u2A85",
  "Laplacetrf;": "\u2112",
  "laquo;": "\xAB",
  "laquo": "\xAB",
  "Larr;": "\u219E",
  "lArr;": "\u21D0",
  "larr;": "\u2190",
  "larrb;": "\u21E4",
  "larrbfs;": "\u291F",
  "larrfs;": "\u291D",
  "larrhk;": "\u21A9",
  "larrlp;": "\u21AB",
  "larrpl;": "\u2939",
  "larrsim;": "\u2973",
  "larrtl;": "\u21A2",
  "lat;": "\u2AAB",
  "lAtail;": "\u291B",
  "latail;": "\u2919",
  "late;": "\u2AAD",
  "lates;": "\u2AAD\uFE00",
  "lBarr;": "\u290E",
  "lbarr;": "\u290C",
  "lbbrk;": "\u2772",
  "lbrace;": "{",
  "lbrack;": "[",
  "lbrke;": "\u298B",
  "lbrksld;": "\u298F",
  "lbrkslu;": "\u298D",
  "Lcaron;": "\u013D",
  "lcaron;": "\u013E",
  "Lcedil;": "\u013B",
  "lcedil;": "\u013C",
  "lceil;": "\u2308",
  "lcub;": "{",
  "Lcy;": "\u041B",
  "lcy;": "\u043B",
  "ldca;": "\u2936",
  "ldquo;": "\u201C",
  "ldquor;": "\u201E",
  "ldrdhar;": "\u2967",
  "ldrushar;": "\u294B",
  "ldsh;": "\u21B2",
  "lE;": "\u2266",
  "le;": "\u2264",
  "LeftAngleBracket;": "\u27E8",
  "LeftArrow;": "\u2190",
  "Leftarrow;": "\u21D0",
  "leftarrow;": "\u2190",
  "LeftArrowBar;": "\u21E4",
  "LeftArrowRightArrow;": "\u21C6",
  "leftarrowtail;": "\u21A2",
  "LeftCeiling;": "\u2308",
  "LeftDoubleBracket;": "\u27E6",
  "LeftDownTeeVector;": "\u2961",
  "LeftDownVector;": "\u21C3",
  "LeftDownVectorBar;": "\u2959",
  "LeftFloor;": "\u230A",
  "leftharpoondown;": "\u21BD",
  "leftharpoonup;": "\u21BC",
  "leftleftarrows;": "\u21C7",
  "LeftRightArrow;": "\u2194",
  "Leftrightarrow;": "\u21D4",
  "leftrightarrow;": "\u2194",
  "leftrightarrows;": "\u21C6",
  "leftrightharpoons;": "\u21CB",
  "leftrightsquigarrow;": "\u21AD",
  "LeftRightVector;": "\u294E",
  "LeftTee;": "\u22A3",
  "LeftTeeArrow;": "\u21A4",
  "LeftTeeVector;": "\u295A",
  "leftthreetimes;": "\u22CB",
  "LeftTriangle;": "\u22B2",
  "LeftTriangleBar;": "\u29CF",
  "LeftTriangleEqual;": "\u22B4",
  "LeftUpDownVector;": "\u2951",
  "LeftUpTeeVector;": "\u2960",
  "LeftUpVector;": "\u21BF",
  "LeftUpVectorBar;": "\u2958",
  "LeftVector;": "\u21BC",
  "LeftVectorBar;": "\u2952",
  "lEg;": "\u2A8B",
  "leg;": "\u22DA",
  "leq;": "\u2264",
  "leqq;": "\u2266",
  "leqslant;": "\u2A7D",
  "les;": "\u2A7D",
  "lescc;": "\u2AA8",
  "lesdot;": "\u2A7F",
  "lesdoto;": "\u2A81",
  "lesdotor;": "\u2A83",
  "lesg;": "\u22DA\uFE00",
  "lesges;": "\u2A93",
  "lessapprox;": "\u2A85",
  "lessdot;": "\u22D6",
  "lesseqgtr;": "\u22DA",
  "lesseqqgtr;": "\u2A8B",
  "LessEqualGreater;": "\u22DA",
  "LessFullEqual;": "\u2266",
  "LessGreater;": "\u2276",
  "lessgtr;": "\u2276",
  "LessLess;": "\u2AA1",
  "lesssim;": "\u2272",
  "LessSlantEqual;": "\u2A7D",
  "LessTilde;": "\u2272",
  "lfisht;": "\u297C",
  "lfloor;": "\u230A",
  "Lfr;": "\u{1D50F}",
  "lfr;": "\u{1D529}",
  "lg;": "\u2276",
  "lgE;": "\u2A91",
  "lHar;": "\u2962",
  "lhard;": "\u21BD",
  "lharu;": "\u21BC",
  "lharul;": "\u296A",
  "lhblk;": "\u2584",
  "LJcy;": "\u0409",
  "ljcy;": "\u0459",
  "Ll;": "\u22D8",
  "ll;": "\u226A",
  "llarr;": "\u21C7",
  "llcorner;": "\u231E",
  "Lleftarrow;": "\u21DA",
  "llhard;": "\u296B",
  "lltri;": "\u25FA",
  "Lmidot;": "\u013F",
  "lmidot;": "\u0140",
  "lmoust;": "\u23B0",
  "lmoustache;": "\u23B0",
  "lnap;": "\u2A89",
  "lnapprox;": "\u2A89",
  "lnE;": "\u2268",
  "lne;": "\u2A87",
  "lneq;": "\u2A87",
  "lneqq;": "\u2268",
  "lnsim;": "\u22E6",
  "loang;": "\u27EC",
  "loarr;": "\u21FD",
  "lobrk;": "\u27E6",
  "LongLeftArrow;": "\u27F5",
  "Longleftarrow;": "\u27F8",
  "longleftarrow;": "\u27F5",
  "LongLeftRightArrow;": "\u27F7",
  "Longleftrightarrow;": "\u27FA",
  "longleftrightarrow;": "\u27F7",
  "longmapsto;": "\u27FC",
  "LongRightArrow;": "\u27F6",
  "Longrightarrow;": "\u27F9",
  "longrightarrow;": "\u27F6",
  "looparrowleft;": "\u21AB",
  "looparrowright;": "\u21AC",
  "lopar;": "\u2985",
  "Lopf;": "\u{1D543}",
  "lopf;": "\u{1D55D}",
  "loplus;": "\u2A2D",
  "lotimes;": "\u2A34",
  "lowast;": "\u2217",
  "lowbar;": "_",
  "LowerLeftArrow;": "\u2199",
  "LowerRightArrow;": "\u2198",
  "loz;": "\u25CA",
  "lozenge;": "\u25CA",
  "lozf;": "\u29EB",
  "lpar;": "(",
  "lparlt;": "\u2993",
  "lrarr;": "\u21C6",
  "lrcorner;": "\u231F",
  "lrhar;": "\u21CB",
  "lrhard;": "\u296D",
  "lrm;": "\u200E",
  "lrtri;": "\u22BF",
  "lsaquo;": "\u2039",
  "Lscr;": "\u2112",
  "lscr;": "\u{1D4C1}",
  "Lsh;": "\u21B0",
  "lsh;": "\u21B0",
  "lsim;": "\u2272",
  "lsime;": "\u2A8D",
  "lsimg;": "\u2A8F",
  "lsqb;": "[",
  "lsquo;": "\u2018",
  "lsquor;": "\u201A",
  "Lstrok;": "\u0141",
  "lstrok;": "\u0142",
  "LT;": "<",
  "LT": "<",
  "Lt;": "\u226A",
  "lt;": "<",
  "lt": "<",
  "ltcc;": "\u2AA6",
  "ltcir;": "\u2A79",
  "ltdot;": "\u22D6",
  "lthree;": "\u22CB",
  "ltimes;": "\u22C9",
  "ltlarr;": "\u2976",
  "ltquest;": "\u2A7B",
  "ltri;": "\u25C3",
  "ltrie;": "\u22B4",
  "ltrif;": "\u25C2",
  "ltrPar;": "\u2996",
  "lurdshar;": "\u294A",
  "luruhar;": "\u2966",
  "lvertneqq;": "\u2268\uFE00",
  "lvnE;": "\u2268\uFE00",
  "macr;": "\xAF",
  "macr": "\xAF",
  "male;": "\u2642",
  "malt;": "\u2720",
  "maltese;": "\u2720",
  "Map;": "\u2905",
  "map;": "\u21A6",
  "mapsto;": "\u21A6",
  "mapstodown;": "\u21A7",
  "mapstoleft;": "\u21A4",
  "mapstoup;": "\u21A5",
  "marker;": "\u25AE",
  "mcomma;": "\u2A29",
  "Mcy;": "\u041C",
  "mcy;": "\u043C",
  "mdash;": "\u2014",
  "mDDot;": "\u223A",
  "measuredangle;": "\u2221",
  "MediumSpace;": "\u205F",
  "Mellintrf;": "\u2133",
  "Mfr;": "\u{1D510}",
  "mfr;": "\u{1D52A}",
  "mho;": "\u2127",
  "micro;": "\xB5",
  "micro": "\xB5",
  "mid;": "\u2223",
  "midast;": "*",
  "midcir;": "\u2AF0",
  "middot;": "\xB7",
  "middot": "\xB7",
  "minus;": "\u2212",
  "minusb;": "\u229F",
  "minusd;": "\u2238",
  "minusdu;": "\u2A2A",
  "MinusPlus;": "\u2213",
  "mlcp;": "\u2ADB",
  "mldr;": "\u2026",
  "mnplus;": "\u2213",
  "models;": "\u22A7",
  "Mopf;": "\u{1D544}",
  "mopf;": "\u{1D55E}",
  "mp;": "\u2213",
  "Mscr;": "\u2133",
  "mscr;": "\u{1D4C2}",
  "mstpos;": "\u223E",
  "Mu;": "\u039C",
  "mu;": "\u03BC",
  "multimap;": "\u22B8",
  "mumap;": "\u22B8",
  "nabla;": "\u2207",
  "Nacute;": "\u0143",
  "nacute;": "\u0144",
  "nang;": "\u2220\u20D2",
  "nap;": "\u2249",
  "napE;": "\u2A70\u0338",
  "napid;": "\u224B\u0338",
  "napos;": "\u0149",
  "napprox;": "\u2249",
  "natur;": "\u266E",
  "natural;": "\u266E",
  "naturals;": "\u2115",
  "nbsp;": "\xA0",
  "nbsp": "\xA0",
  "nbump;": "\u224E\u0338",
  "nbumpe;": "\u224F\u0338",
  "ncap;": "\u2A43",
  "Ncaron;": "\u0147",
  "ncaron;": "\u0148",
  "Ncedil;": "\u0145",
  "ncedil;": "\u0146",
  "ncong;": "\u2247",
  "ncongdot;": "\u2A6D\u0338",
  "ncup;": "\u2A42",
  "Ncy;": "\u041D",
  "ncy;": "\u043D",
  "ndash;": "\u2013",
  "ne;": "\u2260",
  "nearhk;": "\u2924",
  "neArr;": "\u21D7",
  "nearr;": "\u2197",
  "nearrow;": "\u2197",
  "nedot;": "\u2250\u0338",
  "NegativeMediumSpace;": "\u200B",
  "NegativeThickSpace;": "\u200B",
  "NegativeThinSpace;": "\u200B",
  "NegativeVeryThinSpace;": "\u200B",
  "nequiv;": "\u2262",
  "nesear;": "\u2928",
  "nesim;": "\u2242\u0338",
  "NestedGreaterGreater;": "\u226B",
  "NestedLessLess;": "\u226A",
  "NewLine;": "\n",
  "nexist;": "\u2204",
  "nexists;": "\u2204",
  "Nfr;": "\u{1D511}",
  "nfr;": "\u{1D52B}",
  "ngE;": "\u2267\u0338",
  "nge;": "\u2271",
  "ngeq;": "\u2271",
  "ngeqq;": "\u2267\u0338",
  "ngeqslant;": "\u2A7E\u0338",
  "nges;": "\u2A7E\u0338",
  "nGg;": "\u22D9\u0338",
  "ngsim;": "\u2275",
  "nGt;": "\u226B\u20D2",
  "ngt;": "\u226F",
  "ngtr;": "\u226F",
  "nGtv;": "\u226B\u0338",
  "nhArr;": "\u21CE",
  "nharr;": "\u21AE",
  "nhpar;": "\u2AF2",
  "ni;": "\u220B",
  "nis;": "\u22FC",
  "nisd;": "\u22FA",
  "niv;": "\u220B",
  "NJcy;": "\u040A",
  "njcy;": "\u045A",
  "nlArr;": "\u21CD",
  "nlarr;": "\u219A",
  "nldr;": "\u2025",
  "nlE;": "\u2266\u0338",
  "nle;": "\u2270",
  "nLeftarrow;": "\u21CD",
  "nleftarrow;": "\u219A",
  "nLeftrightarrow;": "\u21CE",
  "nleftrightarrow;": "\u21AE",
  "nleq;": "\u2270",
  "nleqq;": "\u2266\u0338",
  "nleqslant;": "\u2A7D\u0338",
  "nles;": "\u2A7D\u0338",
  "nless;": "\u226E",
  "nLl;": "\u22D8\u0338",
  "nlsim;": "\u2274",
  "nLt;": "\u226A\u20D2",
  "nlt;": "\u226E",
  "nltri;": "\u22EA",
  "nltrie;": "\u22EC",
  "nLtv;": "\u226A\u0338",
  "nmid;": "\u2224",
  "NoBreak;": "\u2060",
  "NonBreakingSpace;": "\xA0",
  "Nopf;": "\u2115",
  "nopf;": "\u{1D55F}",
  "Not;": "\u2AEC",
  "not;": "\xAC",
  "not": "\xAC",
  "NotCongruent;": "\u2262",
  "NotCupCap;": "\u226D",
  "NotDoubleVerticalBar;": "\u2226",
  "NotElement;": "\u2209",
  "NotEqual;": "\u2260",
  "NotEqualTilde;": "\u2242\u0338",
  "NotExists;": "\u2204",
  "NotGreater;": "\u226F",
  "NotGreaterEqual;": "\u2271",
  "NotGreaterFullEqual;": "\u2267\u0338",
  "NotGreaterGreater;": "\u226B\u0338",
  "NotGreaterLess;": "\u2279",
  "NotGreaterSlantEqual;": "\u2A7E\u0338",
  "NotGreaterTilde;": "\u2275",
  "NotHumpDownHump;": "\u224E\u0338",
  "NotHumpEqual;": "\u224F\u0338",
  "notin;": "\u2209",
  "notindot;": "\u22F5\u0338",
  "notinE;": "\u22F9\u0338",
  "notinva;": "\u2209",
  "notinvb;": "\u22F7",
  "notinvc;": "\u22F6",
  "NotLeftTriangle;": "\u22EA",
  "NotLeftTriangleBar;": "\u29CF\u0338",
  "NotLeftTriangleEqual;": "\u22EC",
  "NotLess;": "\u226E",
  "NotLessEqual;": "\u2270",
  "NotLessGreater;": "\u2278",
  "NotLessLess;": "\u226A\u0338",
  "NotLessSlantEqual;": "\u2A7D\u0338",
  "NotLessTilde;": "\u2274",
  "NotNestedGreaterGreater;": "\u2AA2\u0338",
  "NotNestedLessLess;": "\u2AA1\u0338",
  "notni;": "\u220C",
  "notniva;": "\u220C",
  "notnivb;": "\u22FE",
  "notnivc;": "\u22FD",
  "NotPrecedes;": "\u2280",
  "NotPrecedesEqual;": "\u2AAF\u0338",
  "NotPrecedesSlantEqual;": "\u22E0",
  "NotReverseElement;": "\u220C",
  "NotRightTriangle;": "\u22EB",
  "NotRightTriangleBar;": "\u29D0\u0338",
  "NotRightTriangleEqual;": "\u22ED",
  "NotSquareSubset;": "\u228F\u0338",
  "NotSquareSubsetEqual;": "\u22E2",
  "NotSquareSuperset;": "\u2290\u0338",
  "NotSquareSupersetEqual;": "\u22E3",
  "NotSubset;": "\u2282\u20D2",
  "NotSubsetEqual;": "\u2288",
  "NotSucceeds;": "\u2281",
  "NotSucceedsEqual;": "\u2AB0\u0338",
  "NotSucceedsSlantEqual;": "\u22E1",
  "NotSucceedsTilde;": "\u227F\u0338",
  "NotSuperset;": "\u2283\u20D2",
  "NotSupersetEqual;": "\u2289",
  "NotTilde;": "\u2241",
  "NotTildeEqual;": "\u2244",
  "NotTildeFullEqual;": "\u2247",
  "NotTildeTilde;": "\u2249",
  "NotVerticalBar;": "\u2224",
  "npar;": "\u2226",
  "nparallel;": "\u2226",
  "nparsl;": "\u2AFD\u20E5",
  "npart;": "\u2202\u0338",
  "npolint;": "\u2A14",
  "npr;": "\u2280",
  "nprcue;": "\u22E0",
  "npre;": "\u2AAF\u0338",
  "nprec;": "\u2280",
  "npreceq;": "\u2AAF\u0338",
  "nrArr;": "\u21CF",
  "nrarr;": "\u219B",
  "nrarrc;": "\u2933\u0338",
  "nrarrw;": "\u219D\u0338",
  "nRightarrow;": "\u21CF",
  "nrightarrow;": "\u219B",
  "nrtri;": "\u22EB",
  "nrtrie;": "\u22ED",
  "nsc;": "\u2281",
  "nsccue;": "\u22E1",
  "nsce;": "\u2AB0\u0338",
  "Nscr;": "\u{1D4A9}",
  "nscr;": "\u{1D4C3}",
  "nshortmid;": "\u2224",
  "nshortparallel;": "\u2226",
  "nsim;": "\u2241",
  "nsime;": "\u2244",
  "nsimeq;": "\u2244",
  "nsmid;": "\u2224",
  "nspar;": "\u2226",
  "nsqsube;": "\u22E2",
  "nsqsupe;": "\u22E3",
  "nsub;": "\u2284",
  "nsubE;": "\u2AC5\u0338",
  "nsube;": "\u2288",
  "nsubset;": "\u2282\u20D2",
  "nsubseteq;": "\u2288",
  "nsubseteqq;": "\u2AC5\u0338",
  "nsucc;": "\u2281",
  "nsucceq;": "\u2AB0\u0338",
  "nsup;": "\u2285",
  "nsupE;": "\u2AC6\u0338",
  "nsupe;": "\u2289",
  "nsupset;": "\u2283\u20D2",
  "nsupseteq;": "\u2289",
  "nsupseteqq;": "\u2AC6\u0338",
  "ntgl;": "\u2279",
  "Ntilde;": "\xD1",
  "Ntilde": "\xD1",
  "ntilde;": "\xF1",
  "ntilde": "\xF1",
  "ntlg;": "\u2278",
  "ntriangleleft;": "\u22EA",
  "ntrianglelefteq;": "\u22EC",
  "ntriangleright;": "\u22EB",
  "ntrianglerighteq;": "\u22ED",
  "Nu;": "\u039D",
  "nu;": "\u03BD",
  "num;": "#",
  "numero;": "\u2116",
  "numsp;": "\u2007",
  "nvap;": "\u224D\u20D2",
  "nVDash;": "\u22AF",
  "nVdash;": "\u22AE",
  "nvDash;": "\u22AD",
  "nvdash;": "\u22AC",
  "nvge;": "\u2265\u20D2",
  "nvgt;": ">\u20D2",
  "nvHarr;": "\u2904",
  "nvinfin;": "\u29DE",
  "nvlArr;": "\u2902",
  "nvle;": "\u2264\u20D2",
  "nvlt;": "<\u20D2",
  "nvltrie;": "\u22B4\u20D2",
  "nvrArr;": "\u2903",
  "nvrtrie;": "\u22B5\u20D2",
  "nvsim;": "\u223C\u20D2",
  "nwarhk;": "\u2923",
  "nwArr;": "\u21D6",
  "nwarr;": "\u2196",
  "nwarrow;": "\u2196",
  "nwnear;": "\u2927",
  "Oacute;": "\xD3",
  "Oacute": "\xD3",
  "oacute;": "\xF3",
  "oacute": "\xF3",
  "oast;": "\u229B",
  "ocir;": "\u229A",
  "Ocirc;": "\xD4",
  "Ocirc": "\xD4",
  "ocirc;": "\xF4",
  "ocirc": "\xF4",
  "Ocy;": "\u041E",
  "ocy;": "\u043E",
  "odash;": "\u229D",
  "Odblac;": "\u0150",
  "odblac;": "\u0151",
  "odiv;": "\u2A38",
  "odot;": "\u2299",
  "odsold;": "\u29BC",
  "OElig;": "\u0152",
  "oelig;": "\u0153",
  "ofcir;": "\u29BF",
  "Ofr;": "\u{1D512}",
  "ofr;": "\u{1D52C}",
  "ogon;": "\u02DB",
  "Ograve;": "\xD2",
  "Ograve": "\xD2",
  "ograve;": "\xF2",
  "ograve": "\xF2",
  "ogt;": "\u29C1",
  "ohbar;": "\u29B5",
  "ohm;": "\u03A9",
  "oint;": "\u222E",
  "olarr;": "\u21BA",
  "olcir;": "\u29BE",
  "olcross;": "\u29BB",
  "oline;": "\u203E",
  "olt;": "\u29C0",
  "Omacr;": "\u014C",
  "omacr;": "\u014D",
  "Omega;": "\u03A9",
  "omega;": "\u03C9",
  "Omicron;": "\u039F",
  "omicron;": "\u03BF",
  "omid;": "\u29B6",
  "ominus;": "\u2296",
  "Oopf;": "\u{1D546}",
  "oopf;": "\u{1D560}",
  "opar;": "\u29B7",
  "OpenCurlyDoubleQuote;": "\u201C",
  "OpenCurlyQuote;": "\u2018",
  "operp;": "\u29B9",
  "oplus;": "\u2295",
  "Or;": "\u2A54",
  "or;": "\u2228",
  "orarr;": "\u21BB",
  "ord;": "\u2A5D",
  "order;": "\u2134",
  "orderof;": "\u2134",
  "ordf;": "\xAA",
  "ordf": "\xAA",
  "ordm;": "\xBA",
  "ordm": "\xBA",
  "origof;": "\u22B6",
  "oror;": "\u2A56",
  "orslope;": "\u2A57",
  "orv;": "\u2A5B",
  "oS;": "\u24C8",
  "Oscr;": "\u{1D4AA}",
  "oscr;": "\u2134",
  "Oslash;": "\xD8",
  "Oslash": "\xD8",
  "oslash;": "\xF8",
  "oslash": "\xF8",
  "osol;": "\u2298",
  "Otilde;": "\xD5",
  "Otilde": "\xD5",
  "otilde;": "\xF5",
  "otilde": "\xF5",
  "Otimes;": "\u2A37",
  "otimes;": "\u2297",
  "otimesas;": "\u2A36",
  "Ouml;": "\xD6",
  "Ouml": "\xD6",
  "ouml;": "\xF6",
  "ouml": "\xF6",
  "ovbar;": "\u233D",
  "OverBar;": "\u203E",
  "OverBrace;": "\u23DE",
  "OverBracket;": "\u23B4",
  "OverParenthesis;": "\u23DC",
  "par;": "\u2225",
  "para;": "\xB6",
  "para": "\xB6",
  "parallel;": "\u2225",
  "parsim;": "\u2AF3",
  "parsl;": "\u2AFD",
  "part;": "\u2202",
  "PartialD;": "\u2202",
  "Pcy;": "\u041F",
  "pcy;": "\u043F",
  "percnt;": "%",
  "period;": ".",
  "permil;": "\u2030",
  "perp;": "\u22A5",
  "pertenk;": "\u2031",
  "Pfr;": "\u{1D513}",
  "pfr;": "\u{1D52D}",
  "Phi;": "\u03A6",
  "phi;": "\u03C6",
  "phiv;": "\u03D5",
  "phmmat;": "\u2133",
  "phone;": "\u260E",
  "Pi;": "\u03A0",
  "pi;": "\u03C0",
  "pitchfork;": "\u22D4",
  "piv;": "\u03D6",
  "planck;": "\u210F",
  "planckh;": "\u210E",
  "plankv;": "\u210F",
  "plus;": "+",
  "plusacir;": "\u2A23",
  "plusb;": "\u229E",
  "pluscir;": "\u2A22",
  "plusdo;": "\u2214",
  "plusdu;": "\u2A25",
  "pluse;": "\u2A72",
  "PlusMinus;": "\xB1",
  "plusmn;": "\xB1",
  "plusmn": "\xB1",
  "plussim;": "\u2A26",
  "plustwo;": "\u2A27",
  "pm;": "\xB1",
  "Poincareplane;": "\u210C",
  "pointint;": "\u2A15",
  "Popf;": "\u2119",
  "popf;": "\u{1D561}",
  "pound;": "\xA3",
  "pound": "\xA3",
  "Pr;": "\u2ABB",
  "pr;": "\u227A",
  "prap;": "\u2AB7",
  "prcue;": "\u227C",
  "prE;": "\u2AB3",
  "pre;": "\u2AAF",
  "prec;": "\u227A",
  "precapprox;": "\u2AB7",
  "preccurlyeq;": "\u227C",
  "Precedes;": "\u227A",
  "PrecedesEqual;": "\u2AAF",
  "PrecedesSlantEqual;": "\u227C",
  "PrecedesTilde;": "\u227E",
  "preceq;": "\u2AAF",
  "precnapprox;": "\u2AB9",
  "precneqq;": "\u2AB5",
  "precnsim;": "\u22E8",
  "precsim;": "\u227E",
  "Prime;": "\u2033",
  "prime;": "\u2032",
  "primes;": "\u2119",
  "prnap;": "\u2AB9",
  "prnE;": "\u2AB5",
  "prnsim;": "\u22E8",
  "prod;": "\u220F",
  "Product;": "\u220F",
  "profalar;": "\u232E",
  "profline;": "\u2312",
  "profsurf;": "\u2313",
  "prop;": "\u221D",
  "Proportion;": "\u2237",
  "Proportional;": "\u221D",
  "propto;": "\u221D",
  "prsim;": "\u227E",
  "prurel;": "\u22B0",
  "Pscr;": "\u{1D4AB}",
  "pscr;": "\u{1D4C5}",
  "Psi;": "\u03A8",
  "psi;": "\u03C8",
  "puncsp;": "\u2008",
  "Qfr;": "\u{1D514}",
  "qfr;": "\u{1D52E}",
  "qint;": "\u2A0C",
  "Qopf;": "\u211A",
  "qopf;": "\u{1D562}",
  "qprime;": "\u2057",
  "Qscr;": "\u{1D4AC}",
  "qscr;": "\u{1D4C6}",
  "quaternions;": "\u210D",
  "quatint;": "\u2A16",
  "quest;": "?",
  "questeq;": "\u225F",
  "QUOT;": '"',
  "QUOT": '"',
  "quot;": '"',
  "quot": '"',
  "rAarr;": "\u21DB",
  "race;": "\u223D\u0331",
  "Racute;": "\u0154",
  "racute;": "\u0155",
  "radic;": "\u221A",
  "raemptyv;": "\u29B3",
  "Rang;": "\u27EB",
  "rang;": "\u27E9",
  "rangd;": "\u2992",
  "range;": "\u29A5",
  "rangle;": "\u27E9",
  "raquo;": "\xBB",
  "raquo": "\xBB",
  "Rarr;": "\u21A0",
  "rArr;": "\u21D2",
  "rarr;": "\u2192",
  "rarrap;": "\u2975",
  "rarrb;": "\u21E5",
  "rarrbfs;": "\u2920",
  "rarrc;": "\u2933",
  "rarrfs;": "\u291E",
  "rarrhk;": "\u21AA",
  "rarrlp;": "\u21AC",
  "rarrpl;": "\u2945",
  "rarrsim;": "\u2974",
  "Rarrtl;": "\u2916",
  "rarrtl;": "\u21A3",
  "rarrw;": "\u219D",
  "rAtail;": "\u291C",
  "ratail;": "\u291A",
  "ratio;": "\u2236",
  "rationals;": "\u211A",
  "RBarr;": "\u2910",
  "rBarr;": "\u290F",
  "rbarr;": "\u290D",
  "rbbrk;": "\u2773",
  "rbrace;": "}",
  "rbrack;": "]",
  "rbrke;": "\u298C",
  "rbrksld;": "\u298E",
  "rbrkslu;": "\u2990",
  "Rcaron;": "\u0158",
  "rcaron;": "\u0159",
  "Rcedil;": "\u0156",
  "rcedil;": "\u0157",
  "rceil;": "\u2309",
  "rcub;": "}",
  "Rcy;": "\u0420",
  "rcy;": "\u0440",
  "rdca;": "\u2937",
  "rdldhar;": "\u2969",
  "rdquo;": "\u201D",
  "rdquor;": "\u201D",
  "rdsh;": "\u21B3",
  "Re;": "\u211C",
  "real;": "\u211C",
  "realine;": "\u211B",
  "realpart;": "\u211C",
  "reals;": "\u211D",
  "rect;": "\u25AD",
  "REG;": "\xAE",
  "REG": "\xAE",
  "reg;": "\xAE",
  "reg": "\xAE",
  "ReverseElement;": "\u220B",
  "ReverseEquilibrium;": "\u21CB",
  "ReverseUpEquilibrium;": "\u296F",
  "rfisht;": "\u297D",
  "rfloor;": "\u230B",
  "Rfr;": "\u211C",
  "rfr;": "\u{1D52F}",
  "rHar;": "\u2964",
  "rhard;": "\u21C1",
  "rharu;": "\u21C0",
  "rharul;": "\u296C",
  "Rho;": "\u03A1",
  "rho;": "\u03C1",
  "rhov;": "\u03F1",
  "RightAngleBracket;": "\u27E9",
  "RightArrow;": "\u2192",
  "Rightarrow;": "\u21D2",
  "rightarrow;": "\u2192",
  "RightArrowBar;": "\u21E5",
  "RightArrowLeftArrow;": "\u21C4",
  "rightarrowtail;": "\u21A3",
  "RightCeiling;": "\u2309",
  "RightDoubleBracket;": "\u27E7",
  "RightDownTeeVector;": "\u295D",
  "RightDownVector;": "\u21C2",
  "RightDownVectorBar;": "\u2955",
  "RightFloor;": "\u230B",
  "rightharpoondown;": "\u21C1",
  "rightharpoonup;": "\u21C0",
  "rightleftarrows;": "\u21C4",
  "rightleftharpoons;": "\u21CC",
  "rightrightarrows;": "\u21C9",
  "rightsquigarrow;": "\u219D",
  "RightTee;": "\u22A2",
  "RightTeeArrow;": "\u21A6",
  "RightTeeVector;": "\u295B",
  "rightthreetimes;": "\u22CC",
  "RightTriangle;": "\u22B3",
  "RightTriangleBar;": "\u29D0",
  "RightTriangleEqual;": "\u22B5",
  "RightUpDownVector;": "\u294F",
  "RightUpTeeVector;": "\u295C",
  "RightUpVector;": "\u21BE",
  "RightUpVectorBar;": "\u2954",
  "RightVector;": "\u21C0",
  "RightVectorBar;": "\u2953",
  "ring;": "\u02DA",
  "risingdotseq;": "\u2253",
  "rlarr;": "\u21C4",
  "rlhar;": "\u21CC",
  "rlm;": "\u200F",
  "rmoust;": "\u23B1",
  "rmoustache;": "\u23B1",
  "rnmid;": "\u2AEE",
  "roang;": "\u27ED",
  "roarr;": "\u21FE",
  "robrk;": "\u27E7",
  "ropar;": "\u2986",
  "Ropf;": "\u211D",
  "ropf;": "\u{1D563}",
  "roplus;": "\u2A2E",
  "rotimes;": "\u2A35",
  "RoundImplies;": "\u2970",
  "rpar;": ")",
  "rpargt;": "\u2994",
  "rppolint;": "\u2A12",
  "rrarr;": "\u21C9",
  "Rrightarrow;": "\u21DB",
  "rsaquo;": "\u203A",
  "Rscr;": "\u211B",
  "rscr;": "\u{1D4C7}",
  "Rsh;": "\u21B1",
  "rsh;": "\u21B1",
  "rsqb;": "]",
  "rsquo;": "\u2019",
  "rsquor;": "\u2019",
  "rthree;": "\u22CC",
  "rtimes;": "\u22CA",
  "rtri;": "\u25B9",
  "rtrie;": "\u22B5",
  "rtrif;": "\u25B8",
  "rtriltri;": "\u29CE",
  "RuleDelayed;": "\u29F4",
  "ruluhar;": "\u2968",
  "rx;": "\u211E",
  "Sacute;": "\u015A",
  "sacute;": "\u015B",
  "sbquo;": "\u201A",
  "Sc;": "\u2ABC",
  "sc;": "\u227B",
  "scap;": "\u2AB8",
  "Scaron;": "\u0160",
  "scaron;": "\u0161",
  "sccue;": "\u227D",
  "scE;": "\u2AB4",
  "sce;": "\u2AB0",
  "Scedil;": "\u015E",
  "scedil;": "\u015F",
  "Scirc;": "\u015C",
  "scirc;": "\u015D",
  "scnap;": "\u2ABA",
  "scnE;": "\u2AB6",
  "scnsim;": "\u22E9",
  "scpolint;": "\u2A13",
  "scsim;": "\u227F",
  "Scy;": "\u0421",
  "scy;": "\u0441",
  "sdot;": "\u22C5",
  "sdotb;": "\u22A1",
  "sdote;": "\u2A66",
  "searhk;": "\u2925",
  "seArr;": "\u21D8",
  "searr;": "\u2198",
  "searrow;": "\u2198",
  "sect;": "\xA7",
  "sect": "\xA7",
  "semi;": ";",
  "seswar;": "\u2929",
  "setminus;": "\u2216",
  "setmn;": "\u2216",
  "sext;": "\u2736",
  "Sfr;": "\u{1D516}",
  "sfr;": "\u{1D530}",
  "sfrown;": "\u2322",
  "sharp;": "\u266F",
  "SHCHcy;": "\u0429",
  "shchcy;": "\u0449",
  "SHcy;": "\u0428",
  "shcy;": "\u0448",
  "ShortDownArrow;": "\u2193",
  "ShortLeftArrow;": "\u2190",
  "shortmid;": "\u2223",
  "shortparallel;": "\u2225",
  "ShortRightArrow;": "\u2192",
  "ShortUpArrow;": "\u2191",
  "shy;": "\xAD",
  "shy": "\xAD",
  "Sigma;": "\u03A3",
  "sigma;": "\u03C3",
  "sigmaf;": "\u03C2",
  "sigmav;": "\u03C2",
  "sim;": "\u223C",
  "simdot;": "\u2A6A",
  "sime;": "\u2243",
  "simeq;": "\u2243",
  "simg;": "\u2A9E",
  "simgE;": "\u2AA0",
  "siml;": "\u2A9D",
  "simlE;": "\u2A9F",
  "simne;": "\u2246",
  "simplus;": "\u2A24",
  "simrarr;": "\u2972",
  "slarr;": "\u2190",
  "SmallCircle;": "\u2218",
  "smallsetminus;": "\u2216",
  "smashp;": "\u2A33",
  "smeparsl;": "\u29E4",
  "smid;": "\u2223",
  "smile;": "\u2323",
  "smt;": "\u2AAA",
  "smte;": "\u2AAC",
  "smtes;": "\u2AAC\uFE00",
  "SOFTcy;": "\u042C",
  "softcy;": "\u044C",
  "sol;": "/",
  "solb;": "\u29C4",
  "solbar;": "\u233F",
  "Sopf;": "\u{1D54A}",
  "sopf;": "\u{1D564}",
  "spades;": "\u2660",
  "spadesuit;": "\u2660",
  "spar;": "\u2225",
  "sqcap;": "\u2293",
  "sqcaps;": "\u2293\uFE00",
  "sqcup;": "\u2294",
  "sqcups;": "\u2294\uFE00",
  "Sqrt;": "\u221A",
  "sqsub;": "\u228F",
  "sqsube;": "\u2291",
  "sqsubset;": "\u228F",
  "sqsubseteq;": "\u2291",
  "sqsup;": "\u2290",
  "sqsupe;": "\u2292",
  "sqsupset;": "\u2290",
  "sqsupseteq;": "\u2292",
  "squ;": "\u25A1",
  "Square;": "\u25A1",
  "square;": "\u25A1",
  "SquareIntersection;": "\u2293",
  "SquareSubset;": "\u228F",
  "SquareSubsetEqual;": "\u2291",
  "SquareSuperset;": "\u2290",
  "SquareSupersetEqual;": "\u2292",
  "SquareUnion;": "\u2294",
  "squarf;": "\u25AA",
  "squf;": "\u25AA",
  "srarr;": "\u2192",
  "Sscr;": "\u{1D4AE}",
  "sscr;": "\u{1D4C8}",
  "ssetmn;": "\u2216",
  "ssmile;": "\u2323",
  "sstarf;": "\u22C6",
  "Star;": "\u22C6",
  "star;": "\u2606",
  "starf;": "\u2605",
  "straightepsilon;": "\u03F5",
  "straightphi;": "\u03D5",
  "strns;": "\xAF",
  "Sub;": "\u22D0",
  "sub;": "\u2282",
  "subdot;": "\u2ABD",
  "subE;": "\u2AC5",
  "sube;": "\u2286",
  "subedot;": "\u2AC3",
  "submult;": "\u2AC1",
  "subnE;": "\u2ACB",
  "subne;": "\u228A",
  "subplus;": "\u2ABF",
  "subrarr;": "\u2979",
  "Subset;": "\u22D0",
  "subset;": "\u2282",
  "subseteq;": "\u2286",
  "subseteqq;": "\u2AC5",
  "SubsetEqual;": "\u2286",
  "subsetneq;": "\u228A",
  "subsetneqq;": "\u2ACB",
  "subsim;": "\u2AC7",
  "subsub;": "\u2AD5",
  "subsup;": "\u2AD3",
  "succ;": "\u227B",
  "succapprox;": "\u2AB8",
  "succcurlyeq;": "\u227D",
  "Succeeds;": "\u227B",
  "SucceedsEqual;": "\u2AB0",
  "SucceedsSlantEqual;": "\u227D",
  "SucceedsTilde;": "\u227F",
  "succeq;": "\u2AB0",
  "succnapprox;": "\u2ABA",
  "succneqq;": "\u2AB6",
  "succnsim;": "\u22E9",
  "succsim;": "\u227F",
  "SuchThat;": "\u220B",
  "Sum;": "\u2211",
  "sum;": "\u2211",
  "sung;": "\u266A",
  "Sup;": "\u22D1",
  "sup;": "\u2283",
  "sup1;": "\xB9",
  "sup1": "\xB9",
  "sup2;": "\xB2",
  "sup2": "\xB2",
  "sup3;": "\xB3",
  "sup3": "\xB3",
  "supdot;": "\u2ABE",
  "supdsub;": "\u2AD8",
  "supE;": "\u2AC6",
  "supe;": "\u2287",
  "supedot;": "\u2AC4",
  "Superset;": "\u2283",
  "SupersetEqual;": "\u2287",
  "suphsol;": "\u27C9",
  "suphsub;": "\u2AD7",
  "suplarr;": "\u297B",
  "supmult;": "\u2AC2",
  "supnE;": "\u2ACC",
  "supne;": "\u228B",
  "supplus;": "\u2AC0",
  "Supset;": "\u22D1",
  "supset;": "\u2283",
  "supseteq;": "\u2287",
  "supseteqq;": "\u2AC6",
  "supsetneq;": "\u228B",
  "supsetneqq;": "\u2ACC",
  "supsim;": "\u2AC8",
  "supsub;": "\u2AD4",
  "supsup;": "\u2AD6",
  "swarhk;": "\u2926",
  "swArr;": "\u21D9",
  "swarr;": "\u2199",
  "swarrow;": "\u2199",
  "swnwar;": "\u292A",
  "szlig;": "\xDF",
  "szlig": "\xDF",
  "Tab;": "	",
  "target;": "\u2316",
  "Tau;": "\u03A4",
  "tau;": "\u03C4",
  "tbrk;": "\u23B4",
  "Tcaron;": "\u0164",
  "tcaron;": "\u0165",
  "Tcedil;": "\u0162",
  "tcedil;": "\u0163",
  "Tcy;": "\u0422",
  "tcy;": "\u0442",
  "tdot;": "\u20DB",
  "telrec;": "\u2315",
  "Tfr;": "\u{1D517}",
  "tfr;": "\u{1D531}",
  "there4;": "\u2234",
  "Therefore;": "\u2234",
  "therefore;": "\u2234",
  "Theta;": "\u0398",
  "theta;": "\u03B8",
  "thetasym;": "\u03D1",
  "thetav;": "\u03D1",
  "thickapprox;": "\u2248",
  "thicksim;": "\u223C",
  "ThickSpace;": "\u205F\u200A",
  "thinsp;": "\u2009",
  "ThinSpace;": "\u2009",
  "thkap;": "\u2248",
  "thksim;": "\u223C",
  "THORN;": "\xDE",
  "THORN": "\xDE",
  "thorn;": "\xFE",
  "thorn": "\xFE",
  "Tilde;": "\u223C",
  "tilde;": "\u02DC",
  "TildeEqual;": "\u2243",
  "TildeFullEqual;": "\u2245",
  "TildeTilde;": "\u2248",
  "times;": "\xD7",
  "times": "\xD7",
  "timesb;": "\u22A0",
  "timesbar;": "\u2A31",
  "timesd;": "\u2A30",
  "tint;": "\u222D",
  "toea;": "\u2928",
  "top;": "\u22A4",
  "topbot;": "\u2336",
  "topcir;": "\u2AF1",
  "Topf;": "\u{1D54B}",
  "topf;": "\u{1D565}",
  "topfork;": "\u2ADA",
  "tosa;": "\u2929",
  "tprime;": "\u2034",
  "TRADE;": "\u2122",
  "trade;": "\u2122",
  "triangle;": "\u25B5",
  "triangledown;": "\u25BF",
  "triangleleft;": "\u25C3",
  "trianglelefteq;": "\u22B4",
  "triangleq;": "\u225C",
  "triangleright;": "\u25B9",
  "trianglerighteq;": "\u22B5",
  "tridot;": "\u25EC",
  "trie;": "\u225C",
  "triminus;": "\u2A3A",
  "TripleDot;": "\u20DB",
  "triplus;": "\u2A39",
  "trisb;": "\u29CD",
  "tritime;": "\u2A3B",
  "trpezium;": "\u23E2",
  "Tscr;": "\u{1D4AF}",
  "tscr;": "\u{1D4C9}",
  "TScy;": "\u0426",
  "tscy;": "\u0446",
  "TSHcy;": "\u040B",
  "tshcy;": "\u045B",
  "Tstrok;": "\u0166",
  "tstrok;": "\u0167",
  "twixt;": "\u226C",
  "twoheadleftarrow;": "\u219E",
  "twoheadrightarrow;": "\u21A0",
  "Uacute;": "\xDA",
  "Uacute": "\xDA",
  "uacute;": "\xFA",
  "uacute": "\xFA",
  "Uarr;": "\u219F",
  "uArr;": "\u21D1",
  "uarr;": "\u2191",
  "Uarrocir;": "\u2949",
  "Ubrcy;": "\u040E",
  "ubrcy;": "\u045E",
  "Ubreve;": "\u016C",
  "ubreve;": "\u016D",
  "Ucirc;": "\xDB",
  "Ucirc": "\xDB",
  "ucirc;": "\xFB",
  "ucirc": "\xFB",
  "Ucy;": "\u0423",
  "ucy;": "\u0443",
  "udarr;": "\u21C5",
  "Udblac;": "\u0170",
  "udblac;": "\u0171",
  "udhar;": "\u296E",
  "ufisht;": "\u297E",
  "Ufr;": "\u{1D518}",
  "ufr;": "\u{1D532}",
  "Ugrave;": "\xD9",
  "Ugrave": "\xD9",
  "ugrave;": "\xF9",
  "ugrave": "\xF9",
  "uHar;": "\u2963",
  "uharl;": "\u21BF",
  "uharr;": "\u21BE",
  "uhblk;": "\u2580",
  "ulcorn;": "\u231C",
  "ulcorner;": "\u231C",
  "ulcrop;": "\u230F",
  "ultri;": "\u25F8",
  "Umacr;": "\u016A",
  "umacr;": "\u016B",
  "uml;": "\xA8",
  "uml": "\xA8",
  "UnderBar;": "_",
  "UnderBrace;": "\u23DF",
  "UnderBracket;": "\u23B5",
  "UnderParenthesis;": "\u23DD",
  "Union;": "\u22C3",
  "UnionPlus;": "\u228E",
  "Uogon;": "\u0172",
  "uogon;": "\u0173",
  "Uopf;": "\u{1D54C}",
  "uopf;": "\u{1D566}",
  "UpArrow;": "\u2191",
  "Uparrow;": "\u21D1",
  "uparrow;": "\u2191",
  "UpArrowBar;": "\u2912",
  "UpArrowDownArrow;": "\u21C5",
  "UpDownArrow;": "\u2195",
  "Updownarrow;": "\u21D5",
  "updownarrow;": "\u2195",
  "UpEquilibrium;": "\u296E",
  "upharpoonleft;": "\u21BF",
  "upharpoonright;": "\u21BE",
  "uplus;": "\u228E",
  "UpperLeftArrow;": "\u2196",
  "UpperRightArrow;": "\u2197",
  "Upsi;": "\u03D2",
  "upsi;": "\u03C5",
  "upsih;": "\u03D2",
  "Upsilon;": "\u03A5",
  "upsilon;": "\u03C5",
  "UpTee;": "\u22A5",
  "UpTeeArrow;": "\u21A5",
  "upuparrows;": "\u21C8",
  "urcorn;": "\u231D",
  "urcorner;": "\u231D",
  "urcrop;": "\u230E",
  "Uring;": "\u016E",
  "uring;": "\u016F",
  "urtri;": "\u25F9",
  "Uscr;": "\u{1D4B0}",
  "uscr;": "\u{1D4CA}",
  "utdot;": "\u22F0",
  "Utilde;": "\u0168",
  "utilde;": "\u0169",
  "utri;": "\u25B5",
  "utrif;": "\u25B4",
  "uuarr;": "\u21C8",
  "Uuml;": "\xDC",
  "Uuml": "\xDC",
  "uuml;": "\xFC",
  "uuml": "\xFC",
  "uwangle;": "\u29A7",
  "vangrt;": "\u299C",
  "varepsilon;": "\u03F5",
  "varkappa;": "\u03F0",
  "varnothing;": "\u2205",
  "varphi;": "\u03D5",
  "varpi;": "\u03D6",
  "varpropto;": "\u221D",
  "vArr;": "\u21D5",
  "varr;": "\u2195",
  "varrho;": "\u03F1",
  "varsigma;": "\u03C2",
  "varsubsetneq;": "\u228A\uFE00",
  "varsubsetneqq;": "\u2ACB\uFE00",
  "varsupsetneq;": "\u228B\uFE00",
  "varsupsetneqq;": "\u2ACC\uFE00",
  "vartheta;": "\u03D1",
  "vartriangleleft;": "\u22B2",
  "vartriangleright;": "\u22B3",
  "Vbar;": "\u2AEB",
  "vBar;": "\u2AE8",
  "vBarv;": "\u2AE9",
  "Vcy;": "\u0412",
  "vcy;": "\u0432",
  "VDash;": "\u22AB",
  "Vdash;": "\u22A9",
  "vDash;": "\u22A8",
  "vdash;": "\u22A2",
  "Vdashl;": "\u2AE6",
  "Vee;": "\u22C1",
  "vee;": "\u2228",
  "veebar;": "\u22BB",
  "veeeq;": "\u225A",
  "vellip;": "\u22EE",
  "Verbar;": "\u2016",
  "verbar;": "|",
  "Vert;": "\u2016",
  "vert;": "|",
  "VerticalBar;": "\u2223",
  "VerticalLine;": "|",
  "VerticalSeparator;": "\u2758",
  "VerticalTilde;": "\u2240",
  "VeryThinSpace;": "\u200A",
  "Vfr;": "\u{1D519}",
  "vfr;": "\u{1D533}",
  "vltri;": "\u22B2",
  "vnsub;": "\u2282\u20D2",
  "vnsup;": "\u2283\u20D2",
  "Vopf;": "\u{1D54D}",
  "vopf;": "\u{1D567}",
  "vprop;": "\u221D",
  "vrtri;": "\u22B3",
  "Vscr;": "\u{1D4B1}",
  "vscr;": "\u{1D4CB}",
  "vsubnE;": "\u2ACB\uFE00",
  "vsubne;": "\u228A\uFE00",
  "vsupnE;": "\u2ACC\uFE00",
  "vsupne;": "\u228B\uFE00",
  "Vvdash;": "\u22AA",
  "vzigzag;": "\u299A",
  "Wcirc;": "\u0174",
  "wcirc;": "\u0175",
  "wedbar;": "\u2A5F",
  "Wedge;": "\u22C0",
  "wedge;": "\u2227",
  "wedgeq;": "\u2259",
  "weierp;": "\u2118",
  "Wfr;": "\u{1D51A}",
  "wfr;": "\u{1D534}",
  "Wopf;": "\u{1D54E}",
  "wopf;": "\u{1D568}",
  "wp;": "\u2118",
  "wr;": "\u2240",
  "wreath;": "\u2240",
  "Wscr;": "\u{1D4B2}",
  "wscr;": "\u{1D4CC}",
  "xcap;": "\u22C2",
  "xcirc;": "\u25EF",
  "xcup;": "\u22C3",
  "xdtri;": "\u25BD",
  "Xfr;": "\u{1D51B}",
  "xfr;": "\u{1D535}",
  "xhArr;": "\u27FA",
  "xharr;": "\u27F7",
  "Xi;": "\u039E",
  "xi;": "\u03BE",
  "xlArr;": "\u27F8",
  "xlarr;": "\u27F5",
  "xmap;": "\u27FC",
  "xnis;": "\u22FB",
  "xodot;": "\u2A00",
  "Xopf;": "\u{1D54F}",
  "xopf;": "\u{1D569}",
  "xoplus;": "\u2A01",
  "xotime;": "\u2A02",
  "xrArr;": "\u27F9",
  "xrarr;": "\u27F6",
  "Xscr;": "\u{1D4B3}",
  "xscr;": "\u{1D4CD}",
  "xsqcup;": "\u2A06",
  "xuplus;": "\u2A04",
  "xutri;": "\u25B3",
  "xvee;": "\u22C1",
  "xwedge;": "\u22C0",
  "Yacute;": "\xDD",
  "Yacute": "\xDD",
  "yacute;": "\xFD",
  "yacute": "\xFD",
  "YAcy;": "\u042F",
  "yacy;": "\u044F",
  "Ycirc;": "\u0176",
  "ycirc;": "\u0177",
  "Ycy;": "\u042B",
  "ycy;": "\u044B",
  "yen;": "\xA5",
  "yen": "\xA5",
  "Yfr;": "\u{1D51C}",
  "yfr;": "\u{1D536}",
  "YIcy;": "\u0407",
  "yicy;": "\u0457",
  "Yopf;": "\u{1D550}",
  "yopf;": "\u{1D56A}",
  "Yscr;": "\u{1D4B4}",
  "yscr;": "\u{1D4CE}",
  "YUcy;": "\u042E",
  "yucy;": "\u044E",
  "Yuml;": "\u0178",
  "yuml;": "\xFF",
  "yuml": "\xFF",
  "Zacute;": "\u0179",
  "zacute;": "\u017A",
  "Zcaron;": "\u017D",
  "zcaron;": "\u017E",
  "Zcy;": "\u0417",
  "zcy;": "\u0437",
  "Zdot;": "\u017B",
  "zdot;": "\u017C",
  "zeetrf;": "\u2128",
  "ZeroWidthSpace;": "\u200B",
  "Zeta;": "\u0396",
  "zeta;": "\u03B6",
  "Zfr;": "\u2128",
  "zfr;": "\u{1D537}",
  "ZHcy;": "\u0416",
  "zhcy;": "\u0436",
  "zigrarr;": "\u21DD",
  "Zopf;": "\u2124",
  "zopf;": "\u{1D56B}",
  "Zscr;": "\u{1D4B5}",
  "zscr;": "\u{1D4CF}",
  "zwj;": "\u200D",
  "zwnj;": "\u200C"
};

// node_modules/vscode-html-languageservice/lib/esm/utils/strings.js
function startsWith(haystack, needle) {
  if (haystack.length < needle.length) {
    return false;
  }
  for (let i = 0; i < needle.length; i++) {
    if (haystack[i] !== needle[i]) {
      return false;
    }
  }
  return true;
}
function endsWith(haystack, needle) {
  const diff = haystack.length - needle.length;
  if (diff > 0) {
    return haystack.lastIndexOf(needle) === diff;
  } else if (diff === 0) {
    return haystack === needle;
  } else {
    return false;
  }
}
function repeat(value, count) {
  let s = "";
  while (count > 0) {
    if ((count & 1) === 1) {
      s += value;
    }
    value += value;
    count = count >>> 1;
  }
  return s;
}
var _a = "a".charCodeAt(0);
var _z = "z".charCodeAt(0);
var _A = "A".charCodeAt(0);
var _Z = "Z".charCodeAt(0);
var _0 = "0".charCodeAt(0);
var _9 = "9".charCodeAt(0);
function isLetterOrDigit(text, index) {
  const c = text.charCodeAt(index);
  return _a <= c && c <= _z || _A <= c && c <= _Z || _0 <= c && c <= _9;
}

// node_modules/vscode-html-languageservice/lib/esm/utils/object.js
function isDefined(obj) {
  return typeof obj !== "undefined";
}

// node_modules/vscode-html-languageservice/lib/esm/utils/markup.js
function normalizeMarkupContent(input) {
  if (!input) {
    return void 0;
  }
  if (typeof input === "string") {
    return {
      kind: "markdown",
      value: input
    };
  }
  return {
    kind: "markdown",
    value: input.value
  };
}

// node_modules/vscode-html-languageservice/lib/esm/languageFacts/dataProvider.js
var BaselineImages = {
  BASELINE_LIMITED: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCA1NDAgMzAwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogIDxzdHlsZT4KICAgIC5ncmF5LXNoYXBlIHsKICAgICAgZmlsbDogI0M2QzZDNjsgLyogTGlnaHQgbW9kZSAqLwogICAgfQoKICAgIEBtZWRpYSAocHJlZmVycy1jb2xvci1zY2hlbWU6IGRhcmspIHsKICAgICAgLmdyYXktc2hhcGUgewogICAgICAgIGZpbGw6ICM1NjU2NTY7IC8qIERhcmsgbW9kZSAqLwogICAgICB9CiAgICB9CiAgPC9zdHlsZT4KICA8cGF0aCBkPSJNMTUwIDBMMjQwIDkwTDIxMCAxMjBMMTIwIDMwTDE1MCAwWiIgZmlsbD0iI0YwOTQwOSIvPgogIDxwYXRoIGQ9Ik00MjAgMzBMNTQwIDE1MEw0MjAgMjcwTDM5MCAyNDBMNDgwIDE1MEwzOTAgNjBMNDIwIDMwWiIgY2xhc3M9ImdyYXktc2hhcGUiLz4KICA8cGF0aCBkPSJNMzMwIDE4MEwzMDAgMjEwTDM5MCAzMDBMNDIwIDI3MEwzMzAgMTgwWiIgZmlsbD0iI0YwOTQwOSIvPgogIDxwYXRoIGQ9Ik0xMjAgMzBMMTUwIDYwTDYwIDE1MEwxNTAgMjQwTDEyMCAyNzBMMCAxNTBMMTIwIDMwWiIgY2xhc3M9ImdyYXktc2hhcGUiLz4KICA8cGF0aCBkPSJNMzkwIDBMNDIwIDMwTDE1MCAzMDBMMTIwIDI3MEwzOTAgMFoiIGZpbGw9IiNGMDk0MDkiLz4KPC9zdmc+",
  BASELINE_LOW: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCA1NDAgMzAwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogIDxzdHlsZT4KICAgIC5ibHVlLXNoYXBlIHsKICAgICAgZmlsbDogI0E4QzdGQTsgLyogTGlnaHQgbW9kZSAqLwogICAgfQoKICAgIEBtZWRpYSAocHJlZmVycy1jb2xvci1zY2hlbWU6IGRhcmspIHsKICAgICAgLmJsdWUtc2hhcGUgewogICAgICAgIGZpbGw6ICMyRDUwOUU7IC8qIERhcmsgbW9kZSAqLwogICAgICB9CiAgICB9CgogICAgLmRhcmtlci1ibHVlLXNoYXBlIHsKICAgICAgICBmaWxsOiAjMUI2RUYzOwogICAgfQoKICAgIEBtZWRpYSAocHJlZmVycy1jb2xvci1zY2hlbWU6IGRhcmspIHsKICAgICAgICAuZGFya2VyLWJsdWUtc2hhcGUgewogICAgICAgICAgICBmaWxsOiAjNDE4NUZGOwogICAgICAgIH0KICAgIH0KCiAgPC9zdHlsZT4KICA8cGF0aCBkPSJNMTUwIDBMMTgwIDMwTDE1MCA2MEwxMjAgMzBMMTUwIDBaIiBjbGFzcz0iYmx1ZS1zaGFwZSIvPgogIDxwYXRoIGQ9Ik0yMTAgNjBMMjQwIDkwTDIxMCAxMjBMMTgwIDkwTDIxMCA2MFoiIGNsYXNzPSJibHVlLXNoYXBlIi8+CiAgPHBhdGggZD0iTTQ1MCA2MEw0ODAgOTBMNDUwIDEyMEw0MjAgOTBMNDUwIDYwWiIgY2xhc3M9ImJsdWUtc2hhcGUiLz4KICA8cGF0aCBkPSJNNTEwIDEyMEw1NDAgMTUwTDUxMCAxODBMNDgwIDE1MEw1MTAgMTIwWiIgY2xhc3M9ImJsdWUtc2hhcGUiLz4KICA8cGF0aCBkPSJNNDUwIDE4MEw0ODAgMjEwTDQ1MCAyNDBMNDIwIDIxMEw0NTAgMTgwWiIgY2xhc3M9ImJsdWUtc2hhcGUiLz4KICA8cGF0aCBkPSJNMzkwIDI0MEw0MjAgMjcwTDM5MCAzMDBMMzYwIDI3MEwzOTAgMjQwWiIgY2xhc3M9ImJsdWUtc2hhcGUiLz4KICA8cGF0aCBkPSJNMzMwIDE4MEwzNjAgMjEwTDMzMCAyNDBMMzAwIDIxMEwzMzAgMTgwWiIgY2xhc3M9ImJsdWUtc2hhcGUiLz4KICA8cGF0aCBkPSJNOTAgNjBMMTIwIDkwTDkwIDEyMEw2MCA5MEw5MCA2MFoiIGNsYXNzPSJibHVlLXNoYXBlIi8+CiAgPHBhdGggZD0iTTM5MCAwTDQyMCAzMEwxNTAgMzAwTDAgMTUwTDMwIDEyMEwxNTAgMjQwTDM5MCAwWiIgY2xhc3M9ImRhcmtlci1ibHVlLXNoYXBlIi8+Cjwvc3ZnPg==",
  BASELINE_HIGH: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCA1NDAgMzAwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogIDxzdHlsZT4KICAgIC5ncmVlbi1zaGFwZSB7CiAgICAgIGZpbGw6ICNDNEVFRDA7IC8qIExpZ2h0IG1vZGUgKi8KICAgIH0KCiAgICBAbWVkaWEgKHByZWZlcnMtY29sb3Itc2NoZW1lOiBkYXJrKSB7CiAgICAgIC5ncmVlbi1zaGFwZSB7CiAgICAgICAgZmlsbDogIzEyNTIyNTsgLyogRGFyayBtb2RlICovCiAgICAgIH0KICAgIH0KICA8L3N0eWxlPgogIDxwYXRoIGQ9Ik00MjAgMzBMMzkwIDYwTDQ4MCAxNTBMMzkwIDI0MEwzMzAgMTgwTDMwMCAyMTBMMzkwIDMwMEw1NDAgMTUwTDQyMCAzMFoiIGNsYXNzPSJncmVlbi1zaGFwZSIvPgogIDxwYXRoIGQ9Ik0xNTAgMEwzMCAxMjBMNjAgMTUwTDE1MCA2MEwyMTAgMTIwTDI0MCA5MEwxNTAgMFoiIGNsYXNzPSJncmVlbi1zaGFwZSIvPgogIDxwYXRoIGQ9Ik0zOTAgMEw0MjAgMzBMMTUwIDMwMEwwIDE1MEwzMCAxMjBMMTUwIDI0MEwzOTAgMFoiIGZpbGw9IiMxRUE0NDYiLz4KPC9zdmc+"
};
function getEntryBaselineImage(status) {
  if (!status) {
    return "";
  }
  let baselineImg;
  switch (status?.baseline) {
    case "low":
      baselineImg = BaselineImages.BASELINE_LOW;
      break;
    case "high":
      baselineImg = BaselineImages.BASELINE_HIGH;
      break;
    default:
      baselineImg = BaselineImages.BASELINE_LIMITED;
  }
  return `![Baseline icon](${baselineImg})`;
}
function getEntryBaselineStatus(status, browsers) {
  if (!status) {
    return "";
  }
  if (status.baseline === false) {
    const missingBrowsers = getMissingBaselineBrowsers(browsers);
    let status2 = `Limited availability across major browsers`;
    if (missingBrowsers) {
      status2 += ` (Not fully implemented in ${missingBrowsers})`;
    }
    return status2;
  }
  const baselineYear = status.baseline_low_date?.split("-")[0];
  return `${status.baseline === "low" ? "Newly" : "Widely"} available across major browsers (Baseline since ${baselineYear})`;
}
var browserNames = {
  "C": {
    name: "Chrome",
    platform: "desktop"
  },
  "CA": {
    name: "Chrome",
    platform: "Android"
  },
  "E": {
    name: "Edge",
    platform: "desktop"
  },
  "FF": {
    name: "Firefox",
    platform: "desktop"
  },
  "FFA": {
    name: "Firefox",
    platform: "Android"
  },
  "S": {
    name: "Safari",
    platform: "macOS"
  },
  "SM": {
    name: "Safari",
    platform: "iOS"
  }
};
var shortCompatPattern = /(E|FFA|FF|SM|S|CA|C|IE|O)([\d|\.]+)?/;
var missingBaselineBrowserFormatter = new Intl.ListFormat("en", {
  style: "long",
  type: "disjunction"
});
function getMissingBaselineBrowsers(browsers) {
  if (!browsers) {
    return "";
  }
  const missingBrowsers = new Map(Object.entries(browserNames));
  for (const shortCompatString of browsers) {
    const match = shortCompatPattern.exec(shortCompatString);
    if (!match) {
      continue;
    }
    const browser = match[1];
    missingBrowsers.delete(browser);
  }
  return missingBaselineBrowserFormatter.format(Object.values(Array.from(missingBrowsers.entries()).reduce((browsers2, [browserId, browser]) => {
    if (browser.name in browsers2 || browserId === "E") {
      browsers2[browser.name] = browser.name;
      return browsers2;
    }
    browsers2[browser.name] = `${browser.name} on ${browser.platform}`;
    return browsers2;
  }, {})));
}
var HTMLDataProvider = class {
  isApplicable() {
    return true;
  }
  /**
   * Currently, unversioned data uses the V1 implementation
   * In the future when the provider handles multiple versions of HTML custom data,
   * use the latest implementation for unversioned data
   */
  constructor(id, customData) {
    this.id = id;
    this._tags = [];
    this._tagMap = {};
    this._valueSetMap = {};
    this._tags = customData.tags || [];
    this._globalAttributes = customData.globalAttributes || [];
    this._tags.forEach((t2) => {
      this._tagMap[t2.name.toLowerCase()] = t2;
    });
    if (customData.valueSets) {
      customData.valueSets.forEach((vs) => {
        this._valueSetMap[vs.name] = vs.values;
      });
    }
  }
  getId() {
    return this.id;
  }
  provideTags() {
    return this._tags;
  }
  provideAttributes(tag) {
    const attributes = [];
    const processAttribute = (a) => {
      attributes.push(a);
    };
    const tagEntry = this._tagMap[tag.toLowerCase()];
    if (tagEntry) {
      tagEntry.attributes.forEach(processAttribute);
    }
    this._globalAttributes.forEach(processAttribute);
    return attributes;
  }
  provideValues(tag, attribute) {
    const values = [];
    attribute = attribute.toLowerCase();
    const processAttributes = (attributes) => {
      attributes.forEach((a) => {
        if (a.name.toLowerCase() === attribute) {
          if (a.values) {
            a.values.forEach((v) => {
              values.push(v);
            });
          }
          if (a.valueSet) {
            if (this._valueSetMap[a.valueSet]) {
              this._valueSetMap[a.valueSet].forEach((v) => {
                values.push(v);
              });
            }
          }
        }
      });
    };
    const tagEntry = this._tagMap[tag.toLowerCase()];
    if (tagEntry) {
      processAttributes(tagEntry.attributes);
    }
    processAttributes(this._globalAttributes);
    return values;
  }
};
function generateDocumentation(item, settings = {}, doesSupportMarkdown) {
  const result = {
    kind: doesSupportMarkdown ? "markdown" : "plaintext",
    value: ""
  };
  if (item.description && settings.documentation !== false) {
    const normalizedDescription = normalizeMarkupContent(item.description);
    if (normalizedDescription) {
      result.value += normalizedDescription.value;
    }
  }
  if (item.status && settings.documentation !== false) {
    if (result.value.length) {
      result.value += `

`;
    }
    const baselineStatus = getEntryBaselineStatus(item.status, item.browsers);
    if (doesSupportMarkdown) {
      result.value += `${getEntryBaselineImage(item.status)} _${baselineStatus}_`;
    } else {
      result.value += baselineStatus;
    }
  }
  if (item.references && item.references.length > 0 && settings.references !== false) {
    if (result.value.length) {
      result.value += `

`;
    }
    if (doesSupportMarkdown) {
      result.value += item.references.map((r) => {
        return `[${r.name}](${r.url})`;
      }).join(" | ");
    } else {
      result.value += item.references.map((r) => {
        return `${r.name}: ${r.url}`;
      }).join("\n");
    }
  }
  if (result.value === "") {
    return void 0;
  }
  return result;
}

// node_modules/vscode-html-languageservice/lib/esm/services/pathCompletion.js
var PathCompletionParticipant = class {
  constructor(dataManager, readDirectory) {
    this.dataManager = dataManager;
    this.readDirectory = readDirectory;
    this.atributeCompletions = [];
  }
  onHtmlAttributeValue(context) {
    if (this.dataManager.isPathAttribute(context.tag, context.attribute)) {
      this.atributeCompletions.push(context);
    }
  }
  async computeCompletions(document, documentContext) {
    const result = { items: [], isIncomplete: false };
    for (const attributeCompletion of this.atributeCompletions) {
      const fullValue = stripQuotes(document.getText(attributeCompletion.range));
      if (isCompletablePath(fullValue)) {
        if (fullValue === "." || fullValue === "..") {
          result.isIncomplete = true;
        } else {
          const replaceRange = pathToReplaceRange(attributeCompletion.value, fullValue, attributeCompletion.range);
          const suggestions = await this.providePathSuggestions(attributeCompletion.value, replaceRange, document, documentContext, attributeCompletion);
          for (const item of suggestions) {
            result.items.push(item);
          }
        }
      }
    }
    return result;
  }
  async providePathSuggestions(valueBeforeCursor, replaceRange, document, documentContext, context) {
    const valueBeforeLastSlash = valueBeforeCursor.substring(0, valueBeforeCursor.lastIndexOf("/") + 1);
    let parentDir = documentContext.resolveReference(valueBeforeLastSlash || ".", document.uri);
    if (parentDir) {
      try {
        const result = [];
        const infos = await this.readDirectory(parentDir);
        const extensionFilter = this.getExtensionFilter(context);
        for (const [name, type] of infos) {
          if (name.charCodeAt(0) !== CharCode_dot) {
            const item = createCompletionItem(name, type === FileType.Directory, replaceRange);
            if (extensionFilter) {
              if (type === FileType.Directory) {
                result.push(item);
              } else {
                const matchesFilter = extensionFilter.extensions.some((ext) => name.toLowerCase().endsWith(ext));
                if (matchesFilter) {
                  item.sortText = "0_" + name;
                  result.push(item);
                } else if (!extensionFilter.exclusive) {
                  item.sortText = "1_" + name;
                  result.push(item);
                }
              }
            } else {
              result.push(item);
            }
          }
        }
        return result;
      } catch (e) {
      }
    }
    return [];
  }
  /**
   * Determines which file extensions to filter/prioritize based on the HTML tag and attributes
   */
  getExtensionFilter(context) {
    if (!context) {
      return void 0;
    }
    if (context.tag === "link" && context.attribute === "href" && context.attributes) {
      const rel = context.attributes["rel"];
      if (rel === "stylesheet" || rel === '"stylesheet"' || rel === "'stylesheet'") {
        return { extensions: [".css", ".scss", ".sass", ".less"], exclusive: false };
      }
      if (rel === "icon" || rel === '"icon"' || rel === "'icon'" || rel === "apple-touch-icon" || rel === '"apple-touch-icon"' || rel === "'apple-touch-icon'") {
        return { extensions: [".ico", ".png", ".svg", ".jpg", ".jpeg", ".gif", ".webp"], exclusive: false };
      }
    }
    if (context.tag === "script" && context.attribute === "src") {
      return { extensions: [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"], exclusive: false };
    }
    if (context.tag === "img" && context.attribute === "src") {
      return { extensions: [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"], exclusive: false };
    }
    if (context.tag === "video" && context.attribute === "src") {
      return { extensions: [".mp4", ".webm", ".ogg", ".mov", ".avi"], exclusive: false };
    }
    if (context.tag === "audio" && context.attribute === "src") {
      return { extensions: [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"], exclusive: false };
    }
    return void 0;
  }
};
var CharCode_dot = ".".charCodeAt(0);
function stripQuotes(fullValue) {
  if (startsWith(fullValue, `'`) || startsWith(fullValue, `"`)) {
    return fullValue.slice(1, -1);
  } else {
    return fullValue;
  }
}
function isCompletablePath(value) {
  if (startsWith(value, "http") || startsWith(value, "https") || startsWith(value, "//")) {
    return false;
  }
  return true;
}
function pathToReplaceRange(valueBeforeCursor, fullValue, range) {
  let replaceRange;
  const lastIndexOfSlash = valueBeforeCursor.lastIndexOf("/");
  if (lastIndexOfSlash === -1) {
    replaceRange = shiftRange(range, 1, -1);
  } else {
    const valueAfterLastSlash = fullValue.slice(lastIndexOfSlash + 1);
    const startPos = shiftPosition(range.end, -1 - valueAfterLastSlash.length);
    const whitespaceIndex = valueAfterLastSlash.indexOf(" ");
    let endPos;
    if (whitespaceIndex !== -1) {
      endPos = shiftPosition(startPos, whitespaceIndex);
    } else {
      endPos = shiftPosition(range.end, -1);
    }
    replaceRange = Range.create(startPos, endPos);
  }
  return replaceRange;
}
function createCompletionItem(p, isDir, replaceRange) {
  if (isDir) {
    p = p + "/";
    return {
      label: p,
      kind: CompletionItemKind.Folder,
      textEdit: TextEdit.replace(replaceRange, p),
      command: {
        title: "Suggest",
        command: "editor.action.triggerSuggest"
      }
    };
  } else {
    return {
      label: p,
      kind: CompletionItemKind.File,
      textEdit: TextEdit.replace(replaceRange, p)
    };
  }
}
function shiftPosition(pos, offset) {
  return Position.create(pos.line, pos.character + offset);
}
function shiftRange(range, startOffset, endOffset) {
  const start = shiftPosition(range.start, startOffset);
  const end = shiftPosition(range.end, endOffset);
  return Range.create(start, end);
}

// node_modules/vscode-html-languageservice/lib/esm/services/htmlCompletion.js
var HTMLCompletion = class {
  constructor(lsOptions, dataManager) {
    this.lsOptions = lsOptions;
    this.dataManager = dataManager;
    this.completionParticipants = [];
  }
  setCompletionParticipants(registeredCompletionParticipants) {
    this.completionParticipants = registeredCompletionParticipants || [];
  }
  async doComplete2(document, position, htmlDocument, documentContext, settings) {
    if (!this.lsOptions.fileSystemProvider || !this.lsOptions.fileSystemProvider.readDirectory) {
      return this.doComplete(document, position, htmlDocument, settings);
    }
    const participant = new PathCompletionParticipant(this.dataManager, this.lsOptions.fileSystemProvider.readDirectory);
    const contributedParticipants = this.completionParticipants;
    this.completionParticipants = [participant].concat(contributedParticipants);
    const result = this.doComplete(document, position, htmlDocument, settings);
    try {
      const pathCompletionResult = await participant.computeCompletions(document, documentContext);
      return {
        isIncomplete: result.isIncomplete || pathCompletionResult.isIncomplete,
        items: pathCompletionResult.items.concat(result.items)
      };
    } finally {
      this.completionParticipants = contributedParticipants;
    }
  }
  doComplete(document, position, htmlDocument, settings) {
    const result = this._doComplete(document, position, htmlDocument, settings);
    return this.convertCompletionList(result);
  }
  _doComplete(document, position, htmlDocument, settings) {
    const result = {
      isIncomplete: false,
      items: []
    };
    const completionParticipants = this.completionParticipants;
    const dataProviders = this.dataManager.getDataProviders().filter((p) => p.isApplicable(document.languageId) && (!settings || settings[p.getId()] !== false));
    const doesSupportMarkdown = this.doesSupportMarkdown();
    const text = document.getText();
    const offset = document.offsetAt(position);
    const node = htmlDocument.findNodeBefore(offset);
    if (!node) {
      return result;
    }
    const scanner = createScanner(text, node.start);
    let currentTag = "";
    let currentAttributeName;
    let voidElements;
    function getReplaceRange(replaceStart, replaceEnd = offset) {
      if (replaceStart > offset) {
        replaceStart = offset;
      }
      return { start: document.positionAt(replaceStart), end: document.positionAt(replaceEnd) };
    }
    function collectOpenTagSuggestions(afterOpenBracket, tagNameEnd) {
      const range = getReplaceRange(afterOpenBracket, tagNameEnd);
      dataProviders.forEach((provider) => {
        provider.provideTags().forEach((tag) => {
          result.items.push({
            label: tag.name,
            kind: CompletionItemKind.Property,
            documentation: generateDocumentation(tag, void 0, doesSupportMarkdown),
            textEdit: TextEdit.replace(range, tag.name),
            insertTextFormat: InsertTextFormat.PlainText
          });
        });
      });
      return result;
    }
    function getLineIndent(offset2) {
      let start = offset2;
      while (start > 0) {
        const ch = text.charAt(start - 1);
        if ("\n\r".indexOf(ch) >= 0) {
          return text.substring(start, offset2);
        }
        if (!isWhiteSpace(ch)) {
          return null;
        }
        start--;
      }
      return text.substring(0, offset2);
    }
    function collectCloseTagSuggestions(afterOpenBracket, inOpenTag, tagNameEnd = offset) {
      if (settings && settings.hideEndTagSuggestions) {
        return result;
      }
      const range = getReplaceRange(afterOpenBracket, tagNameEnd);
      const closeTag = isFollowedBy(text, tagNameEnd, ScannerState.WithinEndTag, TokenType.EndTagClose) ? "" : ">";
      let curr = node;
      if (inOpenTag) {
        curr = curr.parent;
      }
      while (curr) {
        const tag = curr.tag;
        if (tag && (!curr.closed || curr.endTagStart && curr.endTagStart > offset)) {
          const item = {
            label: "/" + tag,
            kind: CompletionItemKind.Property,
            filterText: "/" + tag,
            textEdit: TextEdit.replace(range, "/" + tag + closeTag),
            insertTextFormat: InsertTextFormat.PlainText
          };
          const startIndent = getLineIndent(curr.start);
          const endIndent = getLineIndent(afterOpenBracket - 1);
          if (startIndent !== null && endIndent !== null && startIndent !== endIndent) {
            const insertText = startIndent + "</" + tag + closeTag;
            item.textEdit = TextEdit.replace(getReplaceRange(afterOpenBracket - 1 - endIndent.length), insertText);
            item.filterText = endIndent + "</" + tag;
          }
          result.items.push(item);
          return result;
        }
        curr = curr.parent;
      }
      if (inOpenTag) {
        return result;
      }
      dataProviders.forEach((provider) => {
        provider.provideTags().forEach((tag) => {
          result.items.push({
            label: "/" + tag.name,
            kind: CompletionItemKind.Property,
            documentation: generateDocumentation(tag, void 0, doesSupportMarkdown),
            filterText: "/" + tag.name + closeTag,
            textEdit: TextEdit.replace(range, "/" + tag.name + closeTag),
            insertTextFormat: InsertTextFormat.PlainText
          });
        });
      });
      return result;
    }
    const collectAutoCloseTagSuggestion = (tagCloseEnd, tag) => {
      if (settings && settings.hideAutoCompleteProposals) {
        return result;
      }
      voidElements ?? (voidElements = this.dataManager.getVoidElements(dataProviders));
      if (!this.dataManager.isVoidElement(tag, voidElements)) {
        const pos = document.positionAt(tagCloseEnd);
        result.items.push({
          label: "</" + tag + ">",
          kind: CompletionItemKind.Property,
          filterText: "</" + tag + ">",
          textEdit: TextEdit.insert(pos, "$0</" + tag + ">"),
          insertTextFormat: InsertTextFormat.Snippet
        });
      }
      return result;
    };
    function collectTagSuggestions(tagStart, tagEnd) {
      collectOpenTagSuggestions(tagStart, tagEnd);
      collectCloseTagSuggestions(tagStart, true, tagEnd);
      return result;
    }
    function getExistingAttributes() {
      const existingAttributes = /* @__PURE__ */ Object.create(null);
      node.attributeNames.forEach((attribute) => {
        existingAttributes[attribute] = true;
      });
      return existingAttributes;
    }
    function collectAttributeNameSuggestions(nameStart, nameEnd = offset) {
      let replaceEnd = offset;
      while (replaceEnd < nameEnd && text[replaceEnd] !== "<") {
        replaceEnd++;
      }
      const currentAttribute = text.substring(nameStart, nameEnd);
      const range = getReplaceRange(nameStart, replaceEnd);
      let value = "";
      if (!isFollowedBy(text, nameEnd, ScannerState.AfterAttributeName, TokenType.DelimiterAssign)) {
        const defaultValue = settings?.attributeDefaultValue ?? "doublequotes";
        if (defaultValue === "empty") {
          value = "=$1";
        } else if (defaultValue === "singlequotes") {
          value = "='$1'";
        } else {
          value = '="$1"';
        }
      }
      const seenAttributes = getExistingAttributes();
      seenAttributes[currentAttribute] = false;
      dataProviders.forEach((provider) => {
        provider.provideAttributes(currentTag).forEach((attr) => {
          if (seenAttributes[attr.name]) {
            return;
          }
          seenAttributes[attr.name] = true;
          let codeSnippet = attr.name;
          let command;
          if (attr.valueSet !== "v" && value.length) {
            codeSnippet = codeSnippet + value;
            if (attr.valueSet || attr.name === "style") {
              command = {
                title: "Suggest",
                command: "editor.action.triggerSuggest"
              };
            }
          }
          result.items.push({
            label: attr.name,
            kind: attr.valueSet === "handler" ? CompletionItemKind.Function : CompletionItemKind.Value,
            documentation: generateDocumentation(attr, void 0, doesSupportMarkdown),
            textEdit: TextEdit.replace(range, codeSnippet),
            insertTextFormat: InsertTextFormat.Snippet,
            command
          });
        });
      });
      collectDataAttributesSuggestions(range, seenAttributes);
      return result;
    }
    function collectDataAttributesSuggestions(range, seenAttributes) {
      const dataAttr = "data-";
      const dataAttributes = {};
      dataAttributes[dataAttr] = `${dataAttr}$1="$2"`;
      function addNodeDataAttributes(node2) {
        node2.attributeNames.forEach((attr) => {
          if (startsWith(attr, dataAttr) && !dataAttributes[attr] && !seenAttributes[attr]) {
            dataAttributes[attr] = attr + '="$1"';
          }
        });
        node2.children.forEach((child) => addNodeDataAttributes(child));
      }
      if (htmlDocument) {
        htmlDocument.roots.forEach((root) => addNodeDataAttributes(root));
      }
      Object.keys(dataAttributes).forEach((attr) => result.items.push({
        label: attr,
        kind: CompletionItemKind.Value,
        textEdit: TextEdit.replace(range, dataAttributes[attr]),
        insertTextFormat: InsertTextFormat.Snippet
      }));
    }
    function collectAttributeValueSuggestions(valueStart, valueEnd = offset) {
      let range;
      let addQuotes;
      let valuePrefix;
      if (offset > valueStart && offset <= valueEnd && isQuote(text[valueStart])) {
        const valueContentStart = valueStart + 1;
        let valueContentEnd = valueEnd;
        if (valueEnd > valueStart && text[valueEnd - 1] === text[valueStart]) {
          valueContentEnd--;
        }
        const wsBefore = getWordStart(text, offset, valueContentStart);
        const wsAfter = getWordEnd(text, offset, valueContentEnd);
        range = getReplaceRange(wsBefore, wsAfter);
        valuePrefix = offset >= valueContentStart && offset <= valueContentEnd ? text.substring(valueContentStart, offset) : "";
        addQuotes = false;
      } else {
        range = getReplaceRange(valueStart, valueEnd);
        valuePrefix = text.substring(valueStart, offset);
        addQuotes = true;
      }
      if (completionParticipants.length > 0) {
        const tag = currentTag.toLowerCase();
        const attribute = currentAttributeName.toLowerCase();
        const fullRange = getReplaceRange(valueStart, valueEnd);
        for (const participant of completionParticipants) {
          if (participant.onHtmlAttributeValue) {
            participant.onHtmlAttributeValue({ document, position, tag, attribute, value: valuePrefix, range: fullRange, attributes: node.attributes });
          }
        }
      }
      dataProviders.forEach((provider) => {
        provider.provideValues(currentTag, currentAttributeName).forEach((value) => {
          const insertText = addQuotes ? '"' + value.name + '"' : value.name;
          result.items.push({
            label: value.name,
            filterText: insertText,
            kind: CompletionItemKind.Unit,
            documentation: generateDocumentation(value, void 0, doesSupportMarkdown),
            textEdit: TextEdit.replace(range, insertText),
            insertTextFormat: InsertTextFormat.PlainText
          });
        });
      });
      collectCharacterEntityProposals();
      return result;
    }
    function scanNextForEndPos(nextToken) {
      if (offset === scanner.getTokenEnd()) {
        token = scanner.scan();
        if (token === nextToken && scanner.getTokenOffset() === offset) {
          return scanner.getTokenEnd();
        }
      }
      return offset;
    }
    function collectInsideContent() {
      for (const participant of completionParticipants) {
        if (participant.onHtmlContent) {
          participant.onHtmlContent({ document, position });
        }
      }
      return collectCharacterEntityProposals();
    }
    function collectCharacterEntityProposals() {
      let k = offset - 1;
      let characterStart = position.character;
      while (k >= 0 && isLetterOrDigit(text, k)) {
        k--;
        characterStart--;
      }
      if (k >= 0 && text[k] === "&") {
        const range = Range.create(Position.create(position.line, characterStart - 1), position);
        for (const entity in entities) {
          if (endsWith(entity, ";")) {
            const label = "&" + entity;
            result.items.push({
              label,
              kind: CompletionItemKind.Keyword,
              documentation: t("Character entity representing '{0}'", entities[entity]),
              textEdit: TextEdit.replace(range, label),
              insertTextFormat: InsertTextFormat.PlainText
            });
          }
        }
      }
      return result;
    }
    function suggestDoctype(replaceStart, replaceEnd) {
      const range = getReplaceRange(replaceStart, replaceEnd);
      result.items.push({
        label: "!DOCTYPE",
        kind: CompletionItemKind.Property,
        documentation: "A preamble for an HTML document.",
        textEdit: TextEdit.replace(range, "!DOCTYPE html>"),
        insertTextFormat: InsertTextFormat.PlainText
      });
    }
    let token = scanner.scan();
    while (token !== TokenType.EOS && scanner.getTokenOffset() <= offset) {
      switch (token) {
        case TokenType.StartTagOpen:
          if (scanner.getTokenEnd() === offset) {
            const endPos = scanNextForEndPos(TokenType.StartTag);
            if (position.line === 0) {
              suggestDoctype(offset, endPos);
            }
            return collectTagSuggestions(offset, endPos);
          }
          break;
        case TokenType.StartTag:
          if (scanner.getTokenOffset() <= offset && offset <= scanner.getTokenEnd()) {
            return collectOpenTagSuggestions(scanner.getTokenOffset(), scanner.getTokenEnd());
          }
          currentTag = scanner.getTokenText();
          break;
        case TokenType.AttributeName:
          if (scanner.getTokenOffset() <= offset && offset <= scanner.getTokenEnd()) {
            return collectAttributeNameSuggestions(scanner.getTokenOffset(), scanner.getTokenEnd());
          }
          currentAttributeName = scanner.getTokenText();
          break;
        case TokenType.DelimiterAssign:
          if (scanner.getTokenEnd() === offset) {
            const endPos = scanNextForEndPos(TokenType.AttributeValue);
            return collectAttributeValueSuggestions(offset, endPos);
          }
          break;
        case TokenType.AttributeValue:
          if (scanner.getTokenOffset() <= offset && offset <= scanner.getTokenEnd()) {
            return collectAttributeValueSuggestions(scanner.getTokenOffset(), scanner.getTokenEnd());
          }
          break;
        case TokenType.Whitespace:
          if (offset <= scanner.getTokenEnd()) {
            switch (scanner.getScannerState()) {
              case ScannerState.AfterOpeningStartTag:
                const startPos = scanner.getTokenOffset();
                const endTagPos = scanNextForEndPos(TokenType.StartTag);
                return collectTagSuggestions(startPos, endTagPos);
              case ScannerState.WithinTag:
              case ScannerState.AfterAttributeName:
                return collectAttributeNameSuggestions(scanner.getTokenEnd());
              case ScannerState.BeforeAttributeValue:
                return collectAttributeValueSuggestions(scanner.getTokenEnd());
              case ScannerState.AfterOpeningEndTag:
                return collectCloseTagSuggestions(scanner.getTokenOffset() - 1, false);
              case ScannerState.WithinContent:
                return collectInsideContent();
            }
          }
          break;
        case TokenType.EndTagOpen:
          if (offset <= scanner.getTokenEnd()) {
            const afterOpenBracket = scanner.getTokenOffset() + 1;
            const endOffset = scanNextForEndPos(TokenType.EndTag);
            return collectCloseTagSuggestions(afterOpenBracket, false, endOffset);
          }
          break;
        case TokenType.EndTag:
          if (offset <= scanner.getTokenEnd()) {
            let start = scanner.getTokenOffset() - 1;
            while (start >= 0) {
              const ch = text.charAt(start);
              if (ch === "/") {
                return collectCloseTagSuggestions(start, false, scanner.getTokenEnd());
              } else if (!isWhiteSpace(ch)) {
                break;
              }
              start--;
            }
          }
          break;
        case TokenType.StartTagClose:
          if (offset <= scanner.getTokenEnd()) {
            if (currentTag) {
              return collectAutoCloseTagSuggestion(scanner.getTokenEnd(), currentTag);
            }
          }
          break;
        case TokenType.Content:
          if (offset <= scanner.getTokenEnd()) {
            return collectInsideContent();
          }
          break;
        default:
          if (offset <= scanner.getTokenEnd()) {
            return result;
          }
          break;
      }
      token = scanner.scan();
    }
    return result;
  }
  doQuoteComplete(document, position, htmlDocument, settings) {
    const offset = document.offsetAt(position);
    if (offset <= 0) {
      return null;
    }
    const defaultValue = settings?.attributeDefaultValue ?? "doublequotes";
    if (defaultValue === "empty") {
      return null;
    }
    const char = document.getText().charAt(offset - 1);
    if (char !== "=") {
      return null;
    }
    const value = defaultValue === "doublequotes" ? '"$1"' : "'$1'";
    const node = htmlDocument.findNodeBefore(offset);
    if (node && node.attributes && node.start < offset && (!node.endTagStart || node.endTagStart > offset)) {
      const scanner = createScanner(document.getText(), node.start);
      let token = scanner.scan();
      while (token !== TokenType.EOS && scanner.getTokenEnd() <= offset) {
        if (token === TokenType.AttributeName && scanner.getTokenEnd() === offset - 1) {
          token = scanner.scan();
          if (token !== TokenType.DelimiterAssign) {
            return null;
          }
          token = scanner.scan();
          if (token === TokenType.Unknown || token === TokenType.AttributeValue) {
            return null;
          }
          return value;
        }
        token = scanner.scan();
      }
    }
    return null;
  }
  doTagComplete(document, position, htmlDocument) {
    const offset = document.offsetAt(position);
    if (offset <= 0) {
      return null;
    }
    const char = document.getText().charAt(offset - 1);
    if (char === ">") {
      const node = htmlDocument.findNodeBefore(offset);
      if (node && node.tag && node.start < offset && (!node.endTagStart || node.endTagStart > offset)) {
        const voidElements = this.dataManager.getVoidElements(document.languageId);
        if (!this.dataManager.isVoidElement(node.tag, voidElements)) {
          const scanner = createScanner(document.getText(), node.start);
          let token = scanner.scan();
          while (token !== TokenType.EOS && scanner.getTokenEnd() <= offset) {
            if (token === TokenType.StartTagClose && scanner.getTokenEnd() === offset) {
              return `$0</${node.tag}>`;
            }
            token = scanner.scan();
          }
        }
      }
    } else if (char === "/") {
      let node = htmlDocument.findNodeBefore(offset);
      while (node && node.closed && !(node.endTagStart && node.endTagStart > offset)) {
        node = node.parent;
      }
      if (node && node.tag) {
        const scanner = createScanner(document.getText(), node.start);
        let token = scanner.scan();
        while (token !== TokenType.EOS && scanner.getTokenEnd() <= offset) {
          if (token === TokenType.EndTagOpen && scanner.getTokenEnd() === offset) {
            if (document.getText().charAt(offset) !== ">") {
              return `${node.tag}>`;
            } else {
              return node.tag;
            }
          }
          token = scanner.scan();
        }
      }
    }
    return null;
  }
  convertCompletionList(list) {
    if (!this.doesSupportMarkdown()) {
      list.items.forEach((item) => {
        if (item.documentation && typeof item.documentation !== "string") {
          item.documentation = {
            kind: "plaintext",
            value: item.documentation.value
          };
        }
      });
    }
    return list;
  }
  doesSupportMarkdown() {
    if (!isDefined(this.supportsMarkdown)) {
      if (!isDefined(this.lsOptions.clientCapabilities)) {
        this.supportsMarkdown = true;
        return this.supportsMarkdown;
      }
      const documentationFormat = this.lsOptions.clientCapabilities.textDocument?.completion?.completionItem?.documentationFormat;
      this.supportsMarkdown = Array.isArray(documentationFormat) && documentationFormat.indexOf(MarkupKind.Markdown) !== -1;
    }
    return this.supportsMarkdown;
  }
};
function isQuote(s) {
  return /^["']*$/.test(s);
}
function isWhiteSpace(s) {
  return /^\s*$/.test(s);
}
function isFollowedBy(s, offset, intialState, expectedToken) {
  const scanner = createScanner(s, offset, intialState);
  let token = scanner.scan();
  while (token === TokenType.Whitespace) {
    token = scanner.scan();
  }
  return token === expectedToken;
}
function getWordStart(s, offset, limit) {
  while (offset > limit && !isWhiteSpace(s[offset - 1])) {
    offset--;
  }
  return offset;
}
function getWordEnd(s, offset, limit) {
  while (offset < limit && !isWhiteSpace(s[offset])) {
    offset++;
  }
  return offset;
}

// node_modules/vscode-html-languageservice/lib/esm/services/htmlHover.js
var HTMLHover = class {
  constructor(lsOptions, dataManager) {
    this.lsOptions = lsOptions;
    this.dataManager = dataManager;
  }
  doHover(document, position, htmlDocument, options) {
    const convertContents = this.convertContents.bind(this);
    const doesSupportMarkdown = this.doesSupportMarkdown();
    const offset = document.offsetAt(position);
    const node = htmlDocument.findNodeAt(offset);
    const text = document.getText();
    if (!node || !node.tag) {
      return null;
    }
    const dataProviders = this.dataManager.getDataProviders().filter((p) => p.isApplicable(document.languageId));
    function getTagHover(currTag, range, open) {
      for (const provider of dataProviders) {
        let hover = null;
        provider.provideTags().forEach((tag) => {
          if (tag.name.toLowerCase() === currTag.toLowerCase()) {
            let markupContent = generateDocumentation(tag, options, doesSupportMarkdown);
            if (!markupContent) {
              markupContent = {
                kind: doesSupportMarkdown ? "markdown" : "plaintext",
                value: ""
              };
            }
            hover = { contents: markupContent, range };
          }
        });
        if (hover) {
          hover.contents = convertContents(hover.contents);
          return hover;
        }
      }
      return null;
    }
    function getAttrHover(currTag, currAttr, range) {
      for (const provider of dataProviders) {
        let hover = null;
        provider.provideAttributes(currTag).forEach((attr) => {
          if (currAttr === attr.name && attr.description) {
            const contentsDoc = generateDocumentation(attr, options, doesSupportMarkdown);
            if (contentsDoc) {
              hover = { contents: contentsDoc, range };
            } else {
              hover = null;
            }
          }
        });
        if (hover) {
          hover.contents = convertContents(hover.contents);
          return hover;
        }
      }
      return null;
    }
    function getAttrValueHover(currTag, currAttr, currAttrValue, range) {
      for (const provider of dataProviders) {
        let hover = null;
        provider.provideValues(currTag, currAttr).forEach((attrValue) => {
          if (currAttrValue === attrValue.name && attrValue.description) {
            const contentsDoc = generateDocumentation(attrValue, options, doesSupportMarkdown);
            if (contentsDoc) {
              hover = { contents: contentsDoc, range };
            } else {
              hover = null;
            }
          }
        });
        if (hover) {
          hover.contents = convertContents(hover.contents);
          return hover;
        }
      }
      return null;
    }
    function getEntityHover(text2, range) {
      let currEntity = filterEntity(text2);
      for (const entity in entities) {
        let hover = null;
        const label = "&" + entity;
        if (currEntity === label) {
          let code = entities[entity].charCodeAt(0).toString(16).toUpperCase();
          let hex = "U+";
          if (code.length < 4) {
            const zeroes = 4 - code.length;
            let k = 0;
            while (k < zeroes) {
              hex += "0";
              k += 1;
            }
          }
          hex += code;
          const contentsDoc = t("Character entity representing '{0}', unicode equivalent '{1}'", entities[entity], hex);
          if (contentsDoc) {
            hover = { contents: contentsDoc, range };
          } else {
            hover = null;
          }
        }
        if (hover) {
          hover.contents = convertContents(hover.contents);
          return hover;
        }
      }
      return null;
    }
    function getTagNameRange2(tokenType, startOffset) {
      const scanner = createScanner(document.getText(), startOffset);
      let token = scanner.scan();
      while (token !== TokenType.EOS && (scanner.getTokenEnd() < offset || scanner.getTokenEnd() === offset && token !== tokenType)) {
        token = scanner.scan();
      }
      if (token === tokenType && offset <= scanner.getTokenEnd()) {
        return { start: document.positionAt(scanner.getTokenOffset()), end: document.positionAt(scanner.getTokenEnd()) };
      }
      return null;
    }
    function getEntityRange() {
      let k = offset - 1;
      let characterStart = position.character;
      while (k >= 0 && isLetterOrDigit(text, k)) {
        k--;
        characterStart--;
      }
      let n = k + 1;
      let characterEnd = characterStart;
      while (isLetterOrDigit(text, n)) {
        n++;
        characterEnd++;
      }
      if (k >= 0 && text[k] === "&") {
        let range = null;
        if (text[n] === ";") {
          range = Range.create(Position.create(position.line, characterStart), Position.create(position.line, characterEnd + 1));
        } else {
          range = Range.create(Position.create(position.line, characterStart), Position.create(position.line, characterEnd));
        }
        return range;
      }
      return null;
    }
    function filterEntity(text2) {
      let k = offset - 1;
      let newText = "&";
      while (k >= 0 && isLetterOrDigit(text2, k)) {
        k--;
      }
      k = k + 1;
      while (isLetterOrDigit(text2, k)) {
        newText += text2[k];
        k += 1;
      }
      newText += ";";
      return newText;
    }
    if (node.endTagStart && offset >= node.endTagStart) {
      const tagRange2 = getTagNameRange2(TokenType.EndTag, node.endTagStart);
      if (tagRange2) {
        return getTagHover(node.tag, tagRange2, false);
      }
      return null;
    }
    const tagRange = getTagNameRange2(TokenType.StartTag, node.start);
    if (tagRange) {
      return getTagHover(node.tag, tagRange, true);
    }
    const attrRange = getTagNameRange2(TokenType.AttributeName, node.start);
    if (attrRange) {
      const tag = node.tag;
      const attr = document.getText(attrRange);
      return getAttrHover(tag, attr, attrRange);
    }
    const entityRange = getEntityRange();
    if (entityRange) {
      return getEntityHover(text, entityRange);
    }
    function scanAttrAndAttrValue(nodeStart, attrValueStart) {
      const scanner = createScanner(document.getText(), nodeStart);
      let token = scanner.scan();
      let prevAttr = void 0;
      while (token !== TokenType.EOS && scanner.getTokenEnd() <= attrValueStart) {
        token = scanner.scan();
        if (token === TokenType.AttributeName) {
          prevAttr = scanner.getTokenText();
        }
      }
      return prevAttr;
    }
    const attrValueRange = getTagNameRange2(TokenType.AttributeValue, node.start);
    if (attrValueRange) {
      const tag = node.tag;
      const attrValue = trimQuotes(document.getText(attrValueRange));
      const matchAttr = scanAttrAndAttrValue(node.start, document.offsetAt(attrValueRange.start));
      if (matchAttr) {
        return getAttrValueHover(tag, matchAttr, attrValue, attrValueRange);
      }
    }
    return null;
  }
  convertContents(contents) {
    if (!this.doesSupportMarkdown()) {
      if (typeof contents === "string") {
        return contents;
      } else if ("kind" in contents) {
        return {
          kind: "plaintext",
          value: contents.value
        };
      } else if (Array.isArray(contents)) {
        contents.map((c) => {
          return typeof c === "string" ? c : c.value;
        });
      } else {
        return contents.value;
      }
    }
    return contents;
  }
  doesSupportMarkdown() {
    if (!isDefined(this.supportsMarkdown)) {
      if (!isDefined(this.lsOptions.clientCapabilities)) {
        this.supportsMarkdown = true;
        return this.supportsMarkdown;
      }
      const contentFormat = this.lsOptions.clientCapabilities?.textDocument?.hover?.contentFormat;
      this.supportsMarkdown = Array.isArray(contentFormat) && contentFormat.indexOf(MarkupKind.Markdown) !== -1;
    }
    return this.supportsMarkdown;
  }
};
function trimQuotes(s) {
  if (s.length <= 1) {
    return s.replace(/['"]/, "");
  }
  if (s[0] === `'` || s[0] === `"`) {
    s = s.slice(1);
  }
  if (s[s.length - 1] === `'` || s[s.length - 1] === `"`) {
    s = s.slice(0, -1);
  }
  return s;
}

// node_modules/vscode-html-languageservice/lib/esm/beautify/beautify.js
function js_beautify(js_source_text, options) {
  return js_source_text;
}

// node_modules/vscode-html-languageservice/lib/esm/beautify/beautify-css.js
var legacy_beautify_css;
(function() {
  "use strict";
  var __webpack_modules__ = [
    ,
    ,
    /* 2 */
    /***/
    (function(module) {
      function OutputLine(parent) {
        this.__parent = parent;
        this.__character_count = 0;
        this.__indent_count = -1;
        this.__alignment_count = 0;
        this.__wrap_point_index = 0;
        this.__wrap_point_character_count = 0;
        this.__wrap_point_indent_count = -1;
        this.__wrap_point_alignment_count = 0;
        this.__items = [];
      }
      OutputLine.prototype.clone_empty = function() {
        var line = new OutputLine(this.__parent);
        line.set_indent(this.__indent_count, this.__alignment_count);
        return line;
      };
      OutputLine.prototype.item = function(index) {
        if (index < 0) {
          return this.__items[this.__items.length + index];
        } else {
          return this.__items[index];
        }
      };
      OutputLine.prototype.has_match = function(pattern) {
        for (var lastCheckedOutput = this.__items.length - 1; lastCheckedOutput >= 0; lastCheckedOutput--) {
          if (this.__items[lastCheckedOutput].match(pattern)) {
            return true;
          }
        }
        return false;
      };
      OutputLine.prototype.set_indent = function(indent, alignment) {
        if (this.is_empty()) {
          this.__indent_count = indent || 0;
          this.__alignment_count = alignment || 0;
          this.__character_count = this.__parent.get_indent_size(this.__indent_count, this.__alignment_count);
        }
      };
      OutputLine.prototype._set_wrap_point = function() {
        if (this.__parent.wrap_line_length) {
          this.__wrap_point_index = this.__items.length;
          this.__wrap_point_character_count = this.__character_count;
          this.__wrap_point_indent_count = this.__parent.next_line.__indent_count;
          this.__wrap_point_alignment_count = this.__parent.next_line.__alignment_count;
        }
      };
      OutputLine.prototype._should_wrap = function() {
        return this.__wrap_point_index && this.__character_count > this.__parent.wrap_line_length && this.__wrap_point_character_count > this.__parent.next_line.__character_count;
      };
      OutputLine.prototype._allow_wrap = function() {
        if (this._should_wrap()) {
          this.__parent.add_new_line();
          var next = this.__parent.current_line;
          next.set_indent(this.__wrap_point_indent_count, this.__wrap_point_alignment_count);
          next.__items = this.__items.slice(this.__wrap_point_index);
          this.__items = this.__items.slice(0, this.__wrap_point_index);
          next.__character_count += this.__character_count - this.__wrap_point_character_count;
          this.__character_count = this.__wrap_point_character_count;
          if (next.__items[0] === " ") {
            next.__items.splice(0, 1);
            next.__character_count -= 1;
          }
          return true;
        }
        return false;
      };
      OutputLine.prototype.is_empty = function() {
        return this.__items.length === 0;
      };
      OutputLine.prototype.last = function() {
        if (!this.is_empty()) {
          return this.__items[this.__items.length - 1];
        } else {
          return null;
        }
      };
      OutputLine.prototype.push = function(item) {
        this.__items.push(item);
        var last_newline_index = item.lastIndexOf("\n");
        if (last_newline_index !== -1) {
          this.__character_count = item.length - last_newline_index;
        } else {
          this.__character_count += item.length;
        }
      };
      OutputLine.prototype.pop = function() {
        var item = null;
        if (!this.is_empty()) {
          item = this.__items.pop();
          this.__character_count -= item.length;
        }
        return item;
      };
      OutputLine.prototype._remove_indent = function() {
        if (this.__indent_count > 0) {
          this.__indent_count -= 1;
          this.__character_count -= this.__parent.indent_size;
        }
      };
      OutputLine.prototype._remove_wrap_indent = function() {
        if (this.__wrap_point_indent_count > 0) {
          this.__wrap_point_indent_count -= 1;
        }
      };
      OutputLine.prototype.trim = function() {
        while (this.last() === " ") {
          this.__items.pop();
          this.__character_count -= 1;
        }
      };
      OutputLine.prototype.toString = function() {
        var result = "";
        if (this.is_empty()) {
          if (this.__parent.indent_empty_lines) {
            result = this.__parent.get_indent_string(this.__indent_count);
          }
        } else {
          result = this.__parent.get_indent_string(this.__indent_count, this.__alignment_count);
          result += this.__items.join("");
        }
        return result;
      };
      function IndentStringCache(options, baseIndentString) {
        this.__cache = [""];
        this.__indent_size = options.indent_size;
        this.__indent_string = options.indent_char;
        if (!options.indent_with_tabs) {
          this.__indent_string = new Array(options.indent_size + 1).join(options.indent_char);
        }
        baseIndentString = baseIndentString || "";
        if (options.indent_level > 0) {
          baseIndentString = new Array(options.indent_level + 1).join(this.__indent_string);
        }
        this.__base_string = baseIndentString;
        this.__base_string_length = baseIndentString.length;
      }
      IndentStringCache.prototype.get_indent_size = function(indent, column) {
        var result = this.__base_string_length;
        column = column || 0;
        if (indent < 0) {
          result = 0;
        }
        result += indent * this.__indent_size;
        result += column;
        return result;
      };
      IndentStringCache.prototype.get_indent_string = function(indent_level, column) {
        var result = this.__base_string;
        column = column || 0;
        if (indent_level < 0) {
          indent_level = 0;
          result = "";
        }
        column += indent_level * this.__indent_size;
        this.__ensure_cache(column);
        result += this.__cache[column];
        return result;
      };
      IndentStringCache.prototype.__ensure_cache = function(column) {
        while (column >= this.__cache.length) {
          this.__add_column();
        }
      };
      IndentStringCache.prototype.__add_column = function() {
        var column = this.__cache.length;
        var indent = 0;
        var result = "";
        if (this.__indent_size && column >= this.__indent_size) {
          indent = Math.floor(column / this.__indent_size);
          column -= indent * this.__indent_size;
          result = new Array(indent + 1).join(this.__indent_string);
        }
        if (column) {
          result += new Array(column + 1).join(" ");
        }
        this.__cache.push(result);
      };
      function Output(options, baseIndentString) {
        this.__indent_cache = new IndentStringCache(options, baseIndentString);
        this.raw = false;
        this._end_with_newline = options.end_with_newline;
        this.indent_size = options.indent_size;
        this.wrap_line_length = options.wrap_line_length;
        this.indent_empty_lines = options.indent_empty_lines;
        this.__lines = [];
        this.previous_line = null;
        this.current_line = null;
        this.next_line = new OutputLine(this);
        this.space_before_token = false;
        this.non_breaking_space = false;
        this.previous_token_wrapped = false;
        this.__add_outputline();
      }
      Output.prototype.__add_outputline = function() {
        this.previous_line = this.current_line;
        this.current_line = this.next_line.clone_empty();
        this.__lines.push(this.current_line);
      };
      Output.prototype.get_line_number = function() {
        return this.__lines.length;
      };
      Output.prototype.get_indent_string = function(indent, column) {
        return this.__indent_cache.get_indent_string(indent, column);
      };
      Output.prototype.get_indent_size = function(indent, column) {
        return this.__indent_cache.get_indent_size(indent, column);
      };
      Output.prototype.is_empty = function() {
        return !this.previous_line && this.current_line.is_empty();
      };
      Output.prototype.add_new_line = function(force_newline) {
        if (this.is_empty() || !force_newline && this.just_added_newline()) {
          return false;
        }
        if (!this.raw) {
          this.__add_outputline();
        }
        return true;
      };
      Output.prototype.get_code = function(eol) {
        this.trim(true);
        var last_item = this.current_line.pop();
        if (last_item) {
          if (last_item[last_item.length - 1] === "\n") {
            last_item = last_item.replace(/\n+$/g, "");
          }
          this.current_line.push(last_item);
        }
        if (this._end_with_newline) {
          this.__add_outputline();
        }
        var sweet_code = this.__lines.join("\n");
        if (eol !== "\n") {
          sweet_code = sweet_code.replace(/[\n]/g, eol);
        }
        return sweet_code;
      };
      Output.prototype.set_wrap_point = function() {
        this.current_line._set_wrap_point();
      };
      Output.prototype.set_indent = function(indent, alignment) {
        indent = indent || 0;
        alignment = alignment || 0;
        this.next_line.set_indent(indent, alignment);
        if (this.__lines.length > 1) {
          this.current_line.set_indent(indent, alignment);
          return true;
        }
        this.current_line.set_indent();
        return false;
      };
      Output.prototype.add_raw_token = function(token) {
        for (var x = 0; x < token.newlines; x++) {
          this.__add_outputline();
        }
        this.current_line.set_indent(-1);
        this.current_line.push(token.whitespace_before);
        this.current_line.push(token.text);
        this.space_before_token = false;
        this.non_breaking_space = false;
        this.previous_token_wrapped = false;
      };
      Output.prototype.add_token = function(printable_token) {
        this.__add_space_before_token();
        this.current_line.push(printable_token);
        this.space_before_token = false;
        this.non_breaking_space = false;
        this.previous_token_wrapped = this.current_line._allow_wrap();
      };
      Output.prototype.__add_space_before_token = function() {
        if (this.space_before_token && !this.just_added_newline()) {
          if (!this.non_breaking_space) {
            this.set_wrap_point();
          }
          this.current_line.push(" ");
        }
      };
      Output.prototype.remove_indent = function(index) {
        var output_length = this.__lines.length;
        while (index < output_length) {
          this.__lines[index]._remove_indent();
          index++;
        }
        this.current_line._remove_wrap_indent();
      };
      Output.prototype.trim = function(eat_newlines) {
        eat_newlines = eat_newlines === void 0 ? false : eat_newlines;
        this.current_line.trim();
        while (eat_newlines && this.__lines.length > 1 && this.current_line.is_empty()) {
          this.__lines.pop();
          this.current_line = this.__lines[this.__lines.length - 1];
          this.current_line.trim();
        }
        this.previous_line = this.__lines.length > 1 ? this.__lines[this.__lines.length - 2] : null;
      };
      Output.prototype.just_added_newline = function() {
        return this.current_line.is_empty();
      };
      Output.prototype.just_added_blankline = function() {
        return this.is_empty() || this.current_line.is_empty() && this.previous_line.is_empty();
      };
      Output.prototype.ensure_empty_line_above = function(starts_with, ends_with) {
        var index = this.__lines.length - 2;
        while (index >= 0) {
          var potentialEmptyLine = this.__lines[index];
          if (potentialEmptyLine.is_empty()) {
            break;
          } else if (potentialEmptyLine.item(0).indexOf(starts_with) !== 0 && potentialEmptyLine.item(-1) !== ends_with) {
            this.__lines.splice(index + 1, 0, new OutputLine(this));
            this.previous_line = this.__lines[this.__lines.length - 2];
            break;
          }
          index--;
        }
      };
      module.exports.Output = Output;
    }),
    ,
    ,
    ,
    /* 6 */
    /***/
    (function(module) {
      function Options(options, merge_child_field) {
        this.raw_options = _mergeOpts(options, merge_child_field);
        this.disabled = this._get_boolean("disabled");
        this.eol = this._get_characters("eol", "auto");
        this.end_with_newline = this._get_boolean("end_with_newline");
        this.indent_size = this._get_number("indent_size", 4);
        this.indent_char = this._get_characters("indent_char", " ");
        this.indent_level = this._get_number("indent_level");
        this.preserve_newlines = this._get_boolean("preserve_newlines", true);
        this.max_preserve_newlines = this._get_number("max_preserve_newlines", 32786);
        if (!this.preserve_newlines) {
          this.max_preserve_newlines = 0;
        }
        this.indent_with_tabs = this._get_boolean("indent_with_tabs", this.indent_char === "	");
        if (this.indent_with_tabs) {
          this.indent_char = "	";
          if (this.indent_size === 1) {
            this.indent_size = 4;
          }
        }
        this.wrap_line_length = this._get_number("wrap_line_length", this._get_number("max_char"));
        this.indent_empty_lines = this._get_boolean("indent_empty_lines");
        this.templating = this._get_selection_list("templating", ["auto", "none", "angular", "django", "erb", "handlebars", "php", "smarty"], ["auto"]);
      }
      Options.prototype._get_array = function(name, default_value) {
        var option_value = this.raw_options[name];
        var result = default_value || [];
        if (typeof option_value === "object") {
          if (option_value !== null && typeof option_value.concat === "function") {
            result = option_value.concat();
          }
        } else if (typeof option_value === "string") {
          result = option_value.split(/[^a-zA-Z0-9_\/\-]+/);
        }
        return result;
      };
      Options.prototype._get_boolean = function(name, default_value) {
        var option_value = this.raw_options[name];
        var result = option_value === void 0 ? !!default_value : !!option_value;
        return result;
      };
      Options.prototype._get_characters = function(name, default_value) {
        var option_value = this.raw_options[name];
        var result = default_value || "";
        if (typeof option_value === "string") {
          result = option_value.replace(/\\r/, "\r").replace(/\\n/, "\n").replace(/\\t/, "	");
        }
        return result;
      };
      Options.prototype._get_number = function(name, default_value) {
        var option_value = this.raw_options[name];
        default_value = parseInt(default_value, 10);
        if (isNaN(default_value)) {
          default_value = 0;
        }
        var result = parseInt(option_value, 10);
        if (isNaN(result)) {
          result = default_value;
        }
        return result;
      };
      Options.prototype._get_selection = function(name, selection_list, default_value) {
        var result = this._get_selection_list(name, selection_list, default_value);
        if (result.length !== 1) {
          throw new Error(
            "Invalid Option Value: The option '" + name + "' can only be one of the following values:\n" + selection_list + "\nYou passed in: '" + this.raw_options[name] + "'"
          );
        }
        return result[0];
      };
      Options.prototype._get_selection_list = function(name, selection_list, default_value) {
        if (!selection_list || selection_list.length === 0) {
          throw new Error("Selection list cannot be empty.");
        }
        default_value = default_value || [selection_list[0]];
        if (!this._is_valid_selection(default_value, selection_list)) {
          throw new Error("Invalid Default Value!");
        }
        var result = this._get_array(name, default_value);
        if (!this._is_valid_selection(result, selection_list)) {
          throw new Error(
            "Invalid Option Value: The option '" + name + "' can contain only the following values:\n" + selection_list + "\nYou passed in: '" + this.raw_options[name] + "'"
          );
        }
        return result;
      };
      Options.prototype._is_valid_selection = function(result, selection_list) {
        return result.length && selection_list.length && !result.some(function(item) {
          return selection_list.indexOf(item) === -1;
        });
      };
      function _mergeOpts(allOptions, childFieldName) {
        var finalOpts = {};
        allOptions = _normalizeOpts(allOptions);
        var name;
        for (name in allOptions) {
          if (name !== childFieldName) {
            finalOpts[name] = allOptions[name];
          }
        }
        if (childFieldName && allOptions[childFieldName]) {
          for (name in allOptions[childFieldName]) {
            finalOpts[name] = allOptions[childFieldName][name];
          }
        }
        return finalOpts;
      }
      function _normalizeOpts(options) {
        var convertedOpts = {};
        var key;
        for (key in options) {
          var newKey = key.replace(/-/g, "_");
          convertedOpts[newKey] = options[key];
        }
        return convertedOpts;
      }
      module.exports.Options = Options;
      module.exports.normalizeOpts = _normalizeOpts;
      module.exports.mergeOpts = _mergeOpts;
    }),
    ,
    /* 8 */
    /***/
    (function(module) {
      var regexp_has_sticky = RegExp.prototype.hasOwnProperty("sticky");
      function InputScanner(input_string) {
        this.__input = input_string || "";
        this.__input_length = this.__input.length;
        this.__position = 0;
      }
      InputScanner.prototype.restart = function() {
        this.__position = 0;
      };
      InputScanner.prototype.back = function() {
        if (this.__position > 0) {
          this.__position -= 1;
        }
      };
      InputScanner.prototype.hasNext = function() {
        return this.__position < this.__input_length;
      };
      InputScanner.prototype.next = function() {
        var val = null;
        if (this.hasNext()) {
          val = this.__input.charAt(this.__position);
          this.__position += 1;
        }
        return val;
      };
      InputScanner.prototype.peek = function(index) {
        var val = null;
        index = index || 0;
        index += this.__position;
        if (index >= 0 && index < this.__input_length) {
          val = this.__input.charAt(index);
        }
        return val;
      };
      InputScanner.prototype.__match = function(pattern, index) {
        pattern.lastIndex = index;
        var pattern_match = pattern.exec(this.__input);
        if (pattern_match && !(regexp_has_sticky && pattern.sticky)) {
          if (pattern_match.index !== index) {
            pattern_match = null;
          }
        }
        return pattern_match;
      };
      InputScanner.prototype.test = function(pattern, index) {
        index = index || 0;
        index += this.__position;
        if (index >= 0 && index < this.__input_length) {
          return !!this.__match(pattern, index);
        } else {
          return false;
        }
      };
      InputScanner.prototype.testChar = function(pattern, index) {
        var val = this.peek(index);
        pattern.lastIndex = 0;
        return val !== null && pattern.test(val);
      };
      InputScanner.prototype.match = function(pattern) {
        var pattern_match = this.__match(pattern, this.__position);
        if (pattern_match) {
          this.__position += pattern_match[0].length;
        } else {
          pattern_match = null;
        }
        return pattern_match;
      };
      InputScanner.prototype.read = function(starting_pattern, until_pattern, until_after) {
        var val = "";
        var match;
        if (starting_pattern) {
          match = this.match(starting_pattern);
          if (match) {
            val += match[0];
          }
        }
        if (until_pattern && (match || !starting_pattern)) {
          val += this.readUntil(until_pattern, until_after);
        }
        return val;
      };
      InputScanner.prototype.readUntil = function(pattern, until_after) {
        var val = "";
        var match_index = this.__position;
        pattern.lastIndex = this.__position;
        var pattern_match = pattern.exec(this.__input);
        if (pattern_match) {
          match_index = pattern_match.index;
          if (until_after) {
            match_index += pattern_match[0].length;
          }
        } else {
          match_index = this.__input_length;
        }
        val = this.__input.substring(this.__position, match_index);
        this.__position = match_index;
        return val;
      };
      InputScanner.prototype.readUntilAfter = function(pattern) {
        return this.readUntil(pattern, true);
      };
      InputScanner.prototype.get_regexp = function(pattern, match_from) {
        var result = null;
        var flags = "g";
        if (match_from && regexp_has_sticky) {
          flags = "y";
        }
        if (typeof pattern === "string" && pattern !== "") {
          result = new RegExp(pattern, flags);
        } else if (pattern) {
          result = new RegExp(pattern.source, flags);
        }
        return result;
      };
      InputScanner.prototype.get_literal_regexp = function(literal_string) {
        return RegExp(literal_string.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"));
      };
      InputScanner.prototype.peekUntilAfter = function(pattern) {
        var start = this.__position;
        var val = this.readUntilAfter(pattern);
        this.__position = start;
        return val;
      };
      InputScanner.prototype.lookBack = function(testVal) {
        var start = this.__position - 1;
        return start >= testVal.length && this.__input.substring(start - testVal.length, start).toLowerCase() === testVal;
      };
      module.exports.InputScanner = InputScanner;
    }),
    ,
    ,
    ,
    ,
    /* 13 */
    /***/
    (function(module) {
      function Directives(start_block_pattern, end_block_pattern) {
        start_block_pattern = typeof start_block_pattern === "string" ? start_block_pattern : start_block_pattern.source;
        end_block_pattern = typeof end_block_pattern === "string" ? end_block_pattern : end_block_pattern.source;
        this.__directives_block_pattern = new RegExp(start_block_pattern + / beautify( \w+[:]\w+)+ /.source + end_block_pattern, "g");
        this.__directive_pattern = / (\w+)[:](\w+)/g;
        this.__directives_end_ignore_pattern = new RegExp(start_block_pattern + /\sbeautify\signore:end\s/.source + end_block_pattern, "g");
      }
      Directives.prototype.get_directives = function(text) {
        if (!text.match(this.__directives_block_pattern)) {
          return null;
        }
        var directives = {};
        this.__directive_pattern.lastIndex = 0;
        var directive_match = this.__directive_pattern.exec(text);
        while (directive_match) {
          directives[directive_match[1]] = directive_match[2];
          directive_match = this.__directive_pattern.exec(text);
        }
        return directives;
      };
      Directives.prototype.readIgnored = function(input) {
        return input.readUntilAfter(this.__directives_end_ignore_pattern);
      };
      module.exports.Directives = Directives;
    }),
    ,
    /* 15 */
    /***/
    (function(module, __unused_webpack_exports, __webpack_require__2) {
      var Beautifier = __webpack_require__2(16).Beautifier, Options = __webpack_require__2(17).Options;
      function css_beautify2(source_text, options) {
        var beautifier = new Beautifier(source_text, options);
        return beautifier.beautify();
      }
      module.exports = css_beautify2;
      module.exports.defaultOptions = function() {
        return new Options();
      };
    }),
    /* 16 */
    /***/
    (function(module, __unused_webpack_exports, __webpack_require__2) {
      var Options = __webpack_require__2(17).Options;
      var Output = __webpack_require__2(2).Output;
      var InputScanner = __webpack_require__2(8).InputScanner;
      var Directives = __webpack_require__2(13).Directives;
      var directives_core = new Directives(/\/\*/, /\*\//);
      var lineBreak = /\r\n|[\r\n]/;
      var allLineBreaks = /\r\n|[\r\n]/g;
      var whitespaceChar = /\s/;
      var whitespacePattern = /(?:\s|\n)+/g;
      var block_comment_pattern = /\/\*(?:[\s\S]*?)((?:\*\/)|$)/g;
      var comment_pattern = /\/\/(?:[^\n\r\u2028\u2029]*)/g;
      function Beautifier(source_text, options) {
        this._source_text = source_text || "";
        this._options = new Options(options);
        this._ch = null;
        this._input = null;
        this.NESTED_AT_RULE = {
          "page": true,
          "font-face": true,
          "keyframes": true,
          // also in CONDITIONAL_GROUP_RULE below
          "media": true,
          "supports": true,
          "document": true
        };
        this.CONDITIONAL_GROUP_RULE = {
          "media": true,
          "supports": true,
          "document": true
        };
        this.NON_SEMICOLON_NEWLINE_PROPERTY = [
          "grid-template-areas",
          "grid-template"
        ];
      }
      Beautifier.prototype.eatString = function(endChars) {
        var result = "";
        this._ch = this._input.next();
        while (this._ch) {
          result += this._ch;
          if (this._ch === "\\") {
            result += this._input.next();
          } else if (endChars.indexOf(this._ch) !== -1 || this._ch === "\n") {
            break;
          }
          this._ch = this._input.next();
        }
        return result;
      };
      Beautifier.prototype.eatWhitespace = function(allowAtLeastOneNewLine) {
        var result = whitespaceChar.test(this._input.peek());
        var newline_count = 0;
        while (whitespaceChar.test(this._input.peek())) {
          this._ch = this._input.next();
          if (allowAtLeastOneNewLine && this._ch === "\n") {
            if (newline_count === 0 || newline_count < this._options.max_preserve_newlines) {
              newline_count++;
              this._output.add_new_line(true);
            }
          }
        }
        return result;
      };
      Beautifier.prototype.foundNestedPseudoClass = function() {
        var openParen = 0;
        var i = 1;
        var ch = this._input.peek(i);
        while (ch) {
          if (ch === "{") {
            return true;
          } else if (ch === "(") {
            openParen += 1;
          } else if (ch === ")") {
            if (openParen === 0) {
              return false;
            }
            openParen -= 1;
          } else if (ch === ";" || ch === "}") {
            return false;
          }
          i++;
          ch = this._input.peek(i);
        }
        return false;
      };
      Beautifier.prototype.print_string = function(output_string) {
        this._output.set_indent(this._indentLevel);
        this._output.non_breaking_space = true;
        this._output.add_token(output_string);
      };
      Beautifier.prototype.preserveSingleSpace = function(isAfterSpace) {
        if (isAfterSpace) {
          this._output.space_before_token = true;
        }
      };
      Beautifier.prototype.indent = function() {
        this._indentLevel++;
      };
      Beautifier.prototype.outdent = function() {
        if (this._indentLevel > 0) {
          this._indentLevel--;
        }
      };
      Beautifier.prototype.beautify = function() {
        if (this._options.disabled) {
          return this._source_text;
        }
        var source_text = this._source_text;
        var eol = this._options.eol;
        if (eol === "auto") {
          eol = "\n";
          if (source_text && lineBreak.test(source_text || "")) {
            eol = source_text.match(lineBreak)[0];
          }
        }
        source_text = source_text.replace(allLineBreaks, "\n");
        var baseIndentString = source_text.match(/^[\t ]*/)[0];
        this._output = new Output(this._options, baseIndentString);
        this._input = new InputScanner(source_text);
        this._indentLevel = 0;
        this._nestedLevel = 0;
        this._ch = null;
        var parenLevel = 0;
        var insideRule = false;
        var insidePropertyValue = false;
        var enteringConditionalGroup = false;
        var insideNonNestedAtRule = false;
        var insideScssMap = false;
        var topCharacter = this._ch;
        var insideNonSemiColonValues = false;
        var whitespace;
        var isAfterSpace;
        var previous_ch;
        while (true) {
          whitespace = this._input.read(whitespacePattern);
          isAfterSpace = whitespace !== "";
          previous_ch = topCharacter;
          this._ch = this._input.next();
          if (this._ch === "\\" && this._input.hasNext()) {
            this._ch += this._input.next();
          }
          topCharacter = this._ch;
          if (!this._ch) {
            break;
          } else if (this._ch === "/" && this._input.peek() === "*") {
            this._output.add_new_line();
            this._input.back();
            var comment = this._input.read(block_comment_pattern);
            var directives = directives_core.get_directives(comment);
            if (directives && directives.ignore === "start") {
              comment += directives_core.readIgnored(this._input);
            }
            this.print_string(comment);
            this.eatWhitespace(true);
            this._output.add_new_line();
          } else if (this._ch === "/" && this._input.peek() === "/") {
            this._output.space_before_token = true;
            this._input.back();
            this.print_string(this._input.read(comment_pattern));
            this.eatWhitespace(true);
          } else if (this._ch === "$") {
            this.preserveSingleSpace(isAfterSpace);
            this.print_string(this._ch);
            var variable = this._input.peekUntilAfter(/[: ,;{}()[\]\/='"]/g);
            if (variable.match(/[ :]$/)) {
              variable = this.eatString(": ").replace(/\s+$/, "");
              this.print_string(variable);
              this._output.space_before_token = true;
            }
            if (parenLevel === 0 && variable.indexOf(":") !== -1) {
              insidePropertyValue = true;
              this.indent();
            }
          } else if (this._ch === "@") {
            this.preserveSingleSpace(isAfterSpace);
            if (this._input.peek() === "{") {
              this.print_string(this._ch + this.eatString("}"));
            } else {
              this.print_string(this._ch);
              var variableOrRule = this._input.peekUntilAfter(/[: ,;{}()[\]\/='"]/g);
              if (variableOrRule.match(/[ :]$/)) {
                variableOrRule = this.eatString(": ").replace(/\s+$/, "");
                this.print_string(variableOrRule);
                this._output.space_before_token = true;
              }
              if (parenLevel === 0 && variableOrRule.indexOf(":") !== -1) {
                insidePropertyValue = true;
                this.indent();
              } else if (variableOrRule in this.NESTED_AT_RULE) {
                this._nestedLevel += 1;
                if (variableOrRule in this.CONDITIONAL_GROUP_RULE) {
                  enteringConditionalGroup = true;
                }
              } else if (parenLevel === 0 && !insidePropertyValue) {
                insideNonNestedAtRule = true;
              }
            }
          } else if (this._ch === "#" && this._input.peek() === "{") {
            this.preserveSingleSpace(isAfterSpace);
            this.print_string(this._ch + this.eatString("}"));
          } else if (this._ch === "{") {
            if (insidePropertyValue) {
              insidePropertyValue = false;
              this.outdent();
            }
            insideNonNestedAtRule = false;
            if (enteringConditionalGroup) {
              enteringConditionalGroup = false;
              insideRule = this._indentLevel >= this._nestedLevel;
            } else {
              insideRule = this._indentLevel >= this._nestedLevel - 1;
            }
            if (this._options.newline_between_rules && insideRule) {
              if (this._output.previous_line && this._output.previous_line.item(-1) !== "{") {
                this._output.ensure_empty_line_above("/", ",");
              }
            }
            this._output.space_before_token = true;
            if (this._options.brace_style === "expand") {
              this._output.add_new_line();
              this.print_string(this._ch);
              this.indent();
              this._output.set_indent(this._indentLevel);
            } else {
              if (previous_ch === "(") {
                this._output.space_before_token = false;
              } else if (previous_ch !== ",") {
                this.indent();
              }
              this.print_string(this._ch);
            }
            this.eatWhitespace(true);
            this._output.add_new_line();
          } else if (this._ch === "}") {
            this.outdent();
            this._output.add_new_line();
            if (previous_ch === "{") {
              this._output.trim(true);
            }
            if (insidePropertyValue) {
              this.outdent();
              insidePropertyValue = false;
            }
            this.print_string(this._ch);
            insideRule = false;
            if (this._nestedLevel) {
              this._nestedLevel--;
            }
            this.eatWhitespace(true);
            this._output.add_new_line();
            if (this._options.newline_between_rules && !this._output.just_added_blankline()) {
              if (this._input.peek() !== "}") {
                this._output.add_new_line(true);
              }
            }
            if (this._input.peek() === ")") {
              this._output.trim(true);
              if (this._options.brace_style === "expand") {
                this._output.add_new_line(true);
              }
            }
          } else if (this._ch === ":") {
            for (var i = 0; i < this.NON_SEMICOLON_NEWLINE_PROPERTY.length; i++) {
              if (this._input.lookBack(this.NON_SEMICOLON_NEWLINE_PROPERTY[i])) {
                insideNonSemiColonValues = true;
                break;
              }
            }
            if ((insideRule || enteringConditionalGroup) && !(this._input.lookBack("&") || this.foundNestedPseudoClass()) && !this._input.lookBack("(") && !insideNonNestedAtRule && parenLevel === 0) {
              this.print_string(":");
              if (!insidePropertyValue) {
                insidePropertyValue = true;
                this._output.space_before_token = true;
                this.eatWhitespace(true);
                this.indent();
              }
            } else {
              if (this._input.lookBack(" ")) {
                this._output.space_before_token = true;
              }
              if (this._input.peek() === ":") {
                this._ch = this._input.next();
                this.print_string("::");
              } else {
                this.print_string(":");
              }
            }
          } else if (this._ch === '"' || this._ch === "'") {
            var preserveQuoteSpace = previous_ch === '"' || previous_ch === "'";
            this.preserveSingleSpace(preserveQuoteSpace || isAfterSpace);
            this.print_string(this._ch + this.eatString(this._ch));
            this.eatWhitespace(true);
          } else if (this._ch === ";") {
            insideNonSemiColonValues = false;
            if (parenLevel === 0) {
              if (insidePropertyValue) {
                this.outdent();
                insidePropertyValue = false;
              }
              insideNonNestedAtRule = false;
              this.print_string(this._ch);
              this.eatWhitespace(true);
              if (this._input.peek() !== "/") {
                this._output.add_new_line();
              }
            } else {
              this.print_string(this._ch);
              this.eatWhitespace(true);
              this._output.space_before_token = true;
            }
          } else if (this._ch === "(") {
            if (this._input.lookBack("url")) {
              this.print_string(this._ch);
              this.eatWhitespace();
              parenLevel++;
              this.indent();
              this._ch = this._input.next();
              if (this._ch === ")" || this._ch === '"' || this._ch === "'") {
                this._input.back();
              } else if (this._ch) {
                this.print_string(this._ch + this.eatString(")"));
                if (parenLevel) {
                  parenLevel--;
                  this.outdent();
                }
              }
            } else {
              var space_needed = false;
              if (this._input.lookBack("with")) {
                space_needed = true;
              }
              this.preserveSingleSpace(isAfterSpace || space_needed);
              this.print_string(this._ch);
              if (insidePropertyValue && previous_ch === "$" && this._options.selector_separator_newline) {
                this._output.add_new_line();
                insideScssMap = true;
              } else {
                this.eatWhitespace();
                parenLevel++;
                this.indent();
              }
            }
          } else if (this._ch === ")") {
            if (parenLevel) {
              parenLevel--;
              this.outdent();
            }
            if (insideScssMap && this._input.peek() === ";" && this._options.selector_separator_newline) {
              insideScssMap = false;
              this.outdent();
              this._output.add_new_line();
            }
            this.print_string(this._ch);
          } else if (this._ch === ",") {
            this.print_string(this._ch);
            this.eatWhitespace(true);
            if (this._options.selector_separator_newline && (!insidePropertyValue || insideScssMap) && parenLevel === 0 && !insideNonNestedAtRule) {
              this._output.add_new_line();
            } else {
              this._output.space_before_token = true;
            }
          } else if ((this._ch === ">" || this._ch === "+" || this._ch === "~") && !insidePropertyValue && parenLevel === 0) {
            if (this._options.space_around_combinator) {
              this._output.space_before_token = true;
              this.print_string(this._ch);
              this._output.space_before_token = true;
            } else {
              this.print_string(this._ch);
              this.eatWhitespace();
              if (this._ch && whitespaceChar.test(this._ch)) {
                this._ch = "";
              }
            }
          } else if (this._ch === "]") {
            this.print_string(this._ch);
          } else if (this._ch === "[") {
            this.preserveSingleSpace(isAfterSpace);
            this.print_string(this._ch);
          } else if (this._ch === "=") {
            this.eatWhitespace();
            this.print_string("=");
            if (whitespaceChar.test(this._ch)) {
              this._ch = "";
            }
          } else if (this._ch === "!" && !this._input.lookBack("\\")) {
            this._output.space_before_token = true;
            this.print_string(this._ch);
          } else {
            var preserveAfterSpace = previous_ch === '"' || previous_ch === "'";
            this.preserveSingleSpace(preserveAfterSpace || isAfterSpace);
            this.print_string(this._ch);
            if (!this._output.just_added_newline() && this._input.peek() === "\n" && insideNonSemiColonValues) {
              this._output.add_new_line();
            }
          }
        }
        var sweetCode = this._output.get_code(eol);
        return sweetCode;
      };
      module.exports.Beautifier = Beautifier;
    }),
    /* 17 */
    /***/
    (function(module, __unused_webpack_exports, __webpack_require__2) {
      var BaseOptions = __webpack_require__2(6).Options;
      function Options(options) {
        BaseOptions.call(this, options, "css");
        this.selector_separator_newline = this._get_boolean("selector_separator_newline", true);
        this.newline_between_rules = this._get_boolean("newline_between_rules", true);
        var space_around_selector_separator = this._get_boolean("space_around_selector_separator");
        this.space_around_combinator = this._get_boolean("space_around_combinator") || space_around_selector_separator;
        var brace_style_split = this._get_selection_list("brace_style", ["collapse", "expand", "end-expand", "none", "preserve-inline"]);
        this.brace_style = "collapse";
        for (var bs = 0; bs < brace_style_split.length; bs++) {
          if (brace_style_split[bs] !== "expand") {
            this.brace_style = "collapse";
          } else {
            this.brace_style = brace_style_split[bs];
          }
        }
      }
      Options.prototype = new BaseOptions();
      module.exports.Options = Options;
    })
    /******/
  ];
  var __webpack_module_cache__ = {};
  function __webpack_require__(moduleId) {
    var cachedModule = __webpack_module_cache__[moduleId];
    if (cachedModule !== void 0) {
      return cachedModule.exports;
    }
    var module = __webpack_module_cache__[moduleId] = {
      /******/
      // no module.id needed
      /******/
      // no module.loaded needed
      /******/
      exports: {}
      /******/
    };
    __webpack_modules__[moduleId](module, module.exports, __webpack_require__);
    return module.exports;
  }
  var __webpack_exports__ = __webpack_require__(15);
  legacy_beautify_css = __webpack_exports__;
})();
var css_beautify = legacy_beautify_css;

// node_modules/vscode-html-languageservice/lib/esm/beautify/beautify-html.js
var legacy_beautify_html;
(function() {
  "use strict";
  var __webpack_modules__ = [
    ,
    ,
    /* 2 */
    /***/
    (function(module) {
      function OutputLine(parent) {
        this.__parent = parent;
        this.__character_count = 0;
        this.__indent_count = -1;
        this.__alignment_count = 0;
        this.__wrap_point_index = 0;
        this.__wrap_point_character_count = 0;
        this.__wrap_point_indent_count = -1;
        this.__wrap_point_alignment_count = 0;
        this.__items = [];
      }
      OutputLine.prototype.clone_empty = function() {
        var line = new OutputLine(this.__parent);
        line.set_indent(this.__indent_count, this.__alignment_count);
        return line;
      };
      OutputLine.prototype.item = function(index) {
        if (index < 0) {
          return this.__items[this.__items.length + index];
        } else {
          return this.__items[index];
        }
      };
      OutputLine.prototype.has_match = function(pattern) {
        for (var lastCheckedOutput = this.__items.length - 1; lastCheckedOutput >= 0; lastCheckedOutput--) {
          if (this.__items[lastCheckedOutput].match(pattern)) {
            return true;
          }
        }
        return false;
      };
      OutputLine.prototype.set_indent = function(indent, alignment) {
        if (this.is_empty()) {
          this.__indent_count = indent || 0;
          this.__alignment_count = alignment || 0;
          this.__character_count = this.__parent.get_indent_size(this.__indent_count, this.__alignment_count);
        }
      };
      OutputLine.prototype._set_wrap_point = function() {
        if (this.__parent.wrap_line_length) {
          this.__wrap_point_index = this.__items.length;
          this.__wrap_point_character_count = this.__character_count;
          this.__wrap_point_indent_count = this.__parent.next_line.__indent_count;
          this.__wrap_point_alignment_count = this.__parent.next_line.__alignment_count;
        }
      };
      OutputLine.prototype._should_wrap = function() {
        return this.__wrap_point_index && this.__character_count > this.__parent.wrap_line_length && this.__wrap_point_character_count > this.__parent.next_line.__character_count;
      };
      OutputLine.prototype._allow_wrap = function() {
        if (this._should_wrap()) {
          this.__parent.add_new_line();
          var next = this.__parent.current_line;
          next.set_indent(this.__wrap_point_indent_count, this.__wrap_point_alignment_count);
          next.__items = this.__items.slice(this.__wrap_point_index);
          this.__items = this.__items.slice(0, this.__wrap_point_index);
          next.__character_count += this.__character_count - this.__wrap_point_character_count;
          this.__character_count = this.__wrap_point_character_count;
          if (next.__items[0] === " ") {
            next.__items.splice(0, 1);
            next.__character_count -= 1;
          }
          return true;
        }
        return false;
      };
      OutputLine.prototype.is_empty = function() {
        return this.__items.length === 0;
      };
      OutputLine.prototype.last = function() {
        if (!this.is_empty()) {
          return this.__items[this.__items.length - 1];
        } else {
          return null;
        }
      };
      OutputLine.prototype.push = function(item) {
        this.__items.push(item);
        var last_newline_index = item.lastIndexOf("\n");
        if (last_newline_index !== -1) {
          this.__character_count = item.length - last_newline_index;
        } else {
          this.__character_count += item.length;
        }
      };
      OutputLine.prototype.pop = function() {
        var item = null;
        if (!this.is_empty()) {
          item = this.__items.pop();
          this.__character_count -= item.length;
        }
        return item;
      };
      OutputLine.prototype._remove_indent = function() {
        if (this.__indent_count > 0) {
          this.__indent_count -= 1;
          this.__character_count -= this.__parent.indent_size;
        }
      };
      OutputLine.prototype._remove_wrap_indent = function() {
        if (this.__wrap_point_indent_count > 0) {
          this.__wrap_point_indent_count -= 1;
        }
      };
      OutputLine.prototype.trim = function() {
        while (this.last() === " ") {
          this.__items.pop();
          this.__character_count -= 1;
        }
      };
      OutputLine.prototype.toString = function() {
        var result = "";
        if (this.is_empty()) {
          if (this.__parent.indent_empty_lines) {
            result = this.__parent.get_indent_string(this.__indent_count);
          }
        } else {
          result = this.__parent.get_indent_string(this.__indent_count, this.__alignment_count);
          result += this.__items.join("");
        }
        return result;
      };
      function IndentStringCache(options, baseIndentString) {
        this.__cache = [""];
        this.__indent_size = options.indent_size;
        this.__indent_string = options.indent_char;
        if (!options.indent_with_tabs) {
          this.__indent_string = new Array(options.indent_size + 1).join(options.indent_char);
        }
        baseIndentString = baseIndentString || "";
        if (options.indent_level > 0) {
          baseIndentString = new Array(options.indent_level + 1).join(this.__indent_string);
        }
        this.__base_string = baseIndentString;
        this.__base_string_length = baseIndentString.length;
      }
      IndentStringCache.prototype.get_indent_size = function(indent, column) {
        var result = this.__base_string_length;
        column = column || 0;
        if (indent < 0) {
          result = 0;
        }
        result += indent * this.__indent_size;
        result += column;
        return result;
      };
      IndentStringCache.prototype.get_indent_string = function(indent_level, column) {
        var result = this.__base_string;
        column = column || 0;
        if (indent_level < 0) {
          indent_level = 0;
          result = "";
        }
        column += indent_level * this.__indent_size;
        this.__ensure_cache(column);
        result += this.__cache[column];
        return result;
      };
      IndentStringCache.prototype.__ensure_cache = function(column) {
        while (column >= this.__cache.length) {
          this.__add_column();
        }
      };
      IndentStringCache.prototype.__add_column = function() {
        var column = this.__cache.length;
        var indent = 0;
        var result = "";
        if (this.__indent_size && column >= this.__indent_size) {
          indent = Math.floor(column / this.__indent_size);
          column -= indent * this.__indent_size;
          result = new Array(indent + 1).join(this.__indent_string);
        }
        if (column) {
          result += new Array(column + 1).join(" ");
        }
        this.__cache.push(result);
      };
      function Output(options, baseIndentString) {
        this.__indent_cache = new IndentStringCache(options, baseIndentString);
        this.raw = false;
        this._end_with_newline = options.end_with_newline;
        this.indent_size = options.indent_size;
        this.wrap_line_length = options.wrap_line_length;
        this.indent_empty_lines = options.indent_empty_lines;
        this.__lines = [];
        this.previous_line = null;
        this.current_line = null;
        this.next_line = new OutputLine(this);
        this.space_before_token = false;
        this.non_breaking_space = false;
        this.previous_token_wrapped = false;
        this.__add_outputline();
      }
      Output.prototype.__add_outputline = function() {
        this.previous_line = this.current_line;
        this.current_line = this.next_line.clone_empty();
        this.__lines.push(this.current_line);
      };
      Output.prototype.get_line_number = function() {
        return this.__lines.length;
      };
      Output.prototype.get_indent_string = function(indent, column) {
        return this.__indent_cache.get_indent_string(indent, column);
      };
      Output.prototype.get_indent_size = function(indent, column) {
        return this.__indent_cache.get_indent_size(indent, column);
      };
      Output.prototype.is_empty = function() {
        return !this.previous_line && this.current_line.is_empty();
      };
      Output.prototype.add_new_line = function(force_newline) {
        if (this.is_empty() || !force_newline && this.just_added_newline()) {
          return false;
        }
        if (!this.raw) {
          this.__add_outputline();
        }
        return true;
      };
      Output.prototype.get_code = function(eol) {
        this.trim(true);
        var last_item = this.current_line.pop();
        if (last_item) {
          if (last_item[last_item.length - 1] === "\n") {
            last_item = last_item.replace(/\n+$/g, "");
          }
          this.current_line.push(last_item);
        }
        if (this._end_with_newline) {
          this.__add_outputline();
        }
        var sweet_code = this.__lines.join("\n");
        if (eol !== "\n") {
          sweet_code = sweet_code.replace(/[\n]/g, eol);
        }
        return sweet_code;
      };
      Output.prototype.set_wrap_point = function() {
        this.current_line._set_wrap_point();
      };
      Output.prototype.set_indent = function(indent, alignment) {
        indent = indent || 0;
        alignment = alignment || 0;
        this.next_line.set_indent(indent, alignment);
        if (this.__lines.length > 1) {
          this.current_line.set_indent(indent, alignment);
          return true;
        }
        this.current_line.set_indent();
        return false;
      };
      Output.prototype.add_raw_token = function(token) {
        for (var x = 0; x < token.newlines; x++) {
          this.__add_outputline();
        }
        this.current_line.set_indent(-1);
        this.current_line.push(token.whitespace_before);
        this.current_line.push(token.text);
        this.space_before_token = false;
        this.non_breaking_space = false;
        this.previous_token_wrapped = false;
      };
      Output.prototype.add_token = function(printable_token) {
        this.__add_space_before_token();
        this.current_line.push(printable_token);
        this.space_before_token = false;
        this.non_breaking_space = false;
        this.previous_token_wrapped = this.current_line._allow_wrap();
      };
      Output.prototype.__add_space_before_token = function() {
        if (this.space_before_token && !this.just_added_newline()) {
          if (!this.non_breaking_space) {
            this.set_wrap_point();
          }
          this.current_line.push(" ");
        }
      };
      Output.prototype.remove_indent = function(index) {
        var output_length = this.__lines.length;
        while (index < output_length) {
          this.__lines[index]._remove_indent();
          index++;
        }
        this.current_line._remove_wrap_indent();
      };
      Output.prototype.trim = function(eat_newlines) {
        eat_newlines = eat_newlines === void 0 ? false : eat_newlines;
        this.current_line.trim();
        while (eat_newlines && this.__lines.length > 1 && this.current_line.is_empty()) {
          this.__lines.pop();
          this.current_line = this.__lines[this.__lines.length - 1];
          this.current_line.trim();
        }
        this.previous_line = this.__lines.length > 1 ? this.__lines[this.__lines.length - 2] : null;
      };
      Output.prototype.just_added_newline = function() {
        return this.current_line.is_empty();
      };
      Output.prototype.just_added_blankline = function() {
        return this.is_empty() || this.current_line.is_empty() && this.previous_line.is_empty();
      };
      Output.prototype.ensure_empty_line_above = function(starts_with, ends_with) {
        var index = this.__lines.length - 2;
        while (index >= 0) {
          var potentialEmptyLine = this.__lines[index];
          if (potentialEmptyLine.is_empty()) {
            break;
          } else if (potentialEmptyLine.item(0).indexOf(starts_with) !== 0 && potentialEmptyLine.item(-1) !== ends_with) {
            this.__lines.splice(index + 1, 0, new OutputLine(this));
            this.previous_line = this.__lines[this.__lines.length - 2];
            break;
          }
          index--;
        }
      };
      module.exports.Output = Output;
    }),
    /* 3 */
    /***/
    (function(module) {
      function Token(type, text, newlines, whitespace_before) {
        this.type = type;
        this.text = text;
        this.comments_before = null;
        this.newlines = newlines || 0;
        this.whitespace_before = whitespace_before || "";
        this.parent = null;
        this.next = null;
        this.previous = null;
        this.opened = null;
        this.closed = null;
        this.directives = null;
      }
      module.exports.Token = Token;
    }),
    ,
    ,
    /* 6 */
    /***/
    (function(module) {
      function Options(options, merge_child_field) {
        this.raw_options = _mergeOpts(options, merge_child_field);
        this.disabled = this._get_boolean("disabled");
        this.eol = this._get_characters("eol", "auto");
        this.end_with_newline = this._get_boolean("end_with_newline");
        this.indent_size = this._get_number("indent_size", 4);
        this.indent_char = this._get_characters("indent_char", " ");
        this.indent_level = this._get_number("indent_level");
        this.preserve_newlines = this._get_boolean("preserve_newlines", true);
        this.max_preserve_newlines = this._get_number("max_preserve_newlines", 32786);
        if (!this.preserve_newlines) {
          this.max_preserve_newlines = 0;
        }
        this.indent_with_tabs = this._get_boolean("indent_with_tabs", this.indent_char === "	");
        if (this.indent_with_tabs) {
          this.indent_char = "	";
          if (this.indent_size === 1) {
            this.indent_size = 4;
          }
        }
        this.wrap_line_length = this._get_number("wrap_line_length", this._get_number("max_char"));
        this.indent_empty_lines = this._get_boolean("indent_empty_lines");
        this.templating = this._get_selection_list("templating", ["auto", "none", "angular", "django", "erb", "handlebars", "php", "smarty"], ["auto"]);
      }
      Options.prototype._get_array = function(name, default_value) {
        var option_value = this.raw_options[name];
        var result = default_value || [];
        if (typeof option_value === "object") {
          if (option_value !== null && typeof option_value.concat === "function") {
            result = option_value.concat();
          }
        } else if (typeof option_value === "string") {
          result = option_value.split(/[^a-zA-Z0-9_\/\-]+/);
        }
        return result;
      };
      Options.prototype._get_boolean = function(name, default_value) {
        var option_value = this.raw_options[name];
        var result = option_value === void 0 ? !!default_value : !!option_value;
        return result;
      };
      Options.prototype._get_characters = function(name, default_value) {
        var option_value = this.raw_options[name];
        var result = default_value || "";
        if (typeof option_value === "string") {
          result = option_value.replace(/\\r/, "\r").replace(/\\n/, "\n").replace(/\\t/, "	");
        }
        return result;
      };
      Options.prototype._get_number = function(name, default_value) {
        var option_value = this.raw_options[name];
        default_value = parseInt(default_value, 10);
        if (isNaN(default_value)) {
          default_value = 0;
        }
        var result = parseInt(option_value, 10);
        if (isNaN(result)) {
          result = default_value;
        }
        return result;
      };
      Options.prototype._get_selection = function(name, selection_list, default_value) {
        var result = this._get_selection_list(name, selection_list, default_value);
        if (result.length !== 1) {
          throw new Error(
            "Invalid Option Value: The option '" + name + "' can only be one of the following values:\n" + selection_list + "\nYou passed in: '" + this.raw_options[name] + "'"
          );
        }
        return result[0];
      };
      Options.prototype._get_selection_list = function(name, selection_list, default_value) {
        if (!selection_list || selection_list.length === 0) {
          throw new Error("Selection list cannot be empty.");
        }
        default_value = default_value || [selection_list[0]];
        if (!this._is_valid_selection(default_value, selection_list)) {
          throw new Error("Invalid Default Value!");
        }
        var result = this._get_array(name, default_value);
        if (!this._is_valid_selection(result, selection_list)) {
          throw new Error(
            "Invalid Option Value: The option '" + name + "' can contain only the following values:\n" + selection_list + "\nYou passed in: '" + this.raw_options[name] + "'"
          );
        }
        return result;
      };
      Options.prototype._is_valid_selection = function(result, selection_list) {
        return result.length && selection_list.length && !result.some(function(item) {
          return selection_list.indexOf(item) === -1;
        });
      };
      function _mergeOpts(allOptions, childFieldName) {
        var finalOpts = {};
        allOptions = _normalizeOpts(allOptions);
        var name;
        for (name in allOptions) {
          if (name !== childFieldName) {
            finalOpts[name] = allOptions[name];
          }
        }
        if (childFieldName && allOptions[childFieldName]) {
          for (name in allOptions[childFieldName]) {
            finalOpts[name] = allOptions[childFieldName][name];
          }
        }
        return finalOpts;
      }
      function _normalizeOpts(options) {
        var convertedOpts = {};
        var key;
        for (key in options) {
          var newKey = key.replace(/-/g, "_");
          convertedOpts[newKey] = options[key];
        }
        return convertedOpts;
      }
      module.exports.Options = Options;
      module.exports.normalizeOpts = _normalizeOpts;
      module.exports.mergeOpts = _mergeOpts;
    }),
    ,
    /* 8 */
    /***/
    (function(module) {
      var regexp_has_sticky = RegExp.prototype.hasOwnProperty("sticky");
      function InputScanner(input_string) {
        this.__input = input_string || "";
        this.__input_length = this.__input.length;
        this.__position = 0;
      }
      InputScanner.prototype.restart = function() {
        this.__position = 0;
      };
      InputScanner.prototype.back = function() {
        if (this.__position > 0) {
          this.__position -= 1;
        }
      };
      InputScanner.prototype.hasNext = function() {
        return this.__position < this.__input_length;
      };
      InputScanner.prototype.next = function() {
        var val = null;
        if (this.hasNext()) {
          val = this.__input.charAt(this.__position);
          this.__position += 1;
        }
        return val;
      };
      InputScanner.prototype.peek = function(index) {
        var val = null;
        index = index || 0;
        index += this.__position;
        if (index >= 0 && index < this.__input_length) {
          val = this.__input.charAt(index);
        }
        return val;
      };
      InputScanner.prototype.__match = function(pattern, index) {
        pattern.lastIndex = index;
        var pattern_match = pattern.exec(this.__input);
        if (pattern_match && !(regexp_has_sticky && pattern.sticky)) {
          if (pattern_match.index !== index) {
            pattern_match = null;
          }
        }
        return pattern_match;
      };
      InputScanner.prototype.test = function(pattern, index) {
        index = index || 0;
        index += this.__position;
        if (index >= 0 && index < this.__input_length) {
          return !!this.__match(pattern, index);
        } else {
          return false;
        }
      };
      InputScanner.prototype.testChar = function(pattern, index) {
        var val = this.peek(index);
        pattern.lastIndex = 0;
        return val !== null && pattern.test(val);
      };
      InputScanner.prototype.match = function(pattern) {
        var pattern_match = this.__match(pattern, this.__position);
        if (pattern_match) {
          this.__position += pattern_match[0].length;
        } else {
          pattern_match = null;
        }
        return pattern_match;
      };
      InputScanner.prototype.read = function(starting_pattern, until_pattern, until_after) {
        var val = "";
        var match;
        if (starting_pattern) {
          match = this.match(starting_pattern);
          if (match) {
            val += match[0];
          }
        }
        if (until_pattern && (match || !starting_pattern)) {
          val += this.readUntil(until_pattern, until_after);
        }
        return val;
      };
      InputScanner.prototype.readUntil = function(pattern, until_after) {
        var val = "";
        var match_index = this.__position;
        pattern.lastIndex = this.__position;
        var pattern_match = pattern.exec(this.__input);
        if (pattern_match) {
          match_index = pattern_match.index;
          if (until_after) {
            match_index += pattern_match[0].length;
          }
        } else {
          match_index = this.__input_length;
        }
        val = this.__input.substring(this.__position, match_index);
        this.__position = match_index;
        return val;
      };
      InputScanner.prototype.readUntilAfter = function(pattern) {
        return this.readUntil(pattern, true);
      };
      InputScanner.prototype.get_regexp = function(pattern, match_from) {
        var result = null;
        var flags = "g";
        if (match_from && regexp_has_sticky) {
          flags = "y";
        }
        if (typeof pattern === "string" && pattern !== "") {
          result = new RegExp(pattern, flags);
        } else if (pattern) {
          result = new RegExp(pattern.source, flags);
        }
        return result;
      };
      InputScanner.prototype.get_literal_regexp = function(literal_string) {
        return RegExp(literal_string.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"));
      };
      InputScanner.prototype.peekUntilAfter = function(pattern) {
        var start = this.__position;
        var val = this.readUntilAfter(pattern);
        this.__position = start;
        return val;
      };
      InputScanner.prototype.lookBack = function(testVal) {
        var start = this.__position - 1;
        return start >= testVal.length && this.__input.substring(start - testVal.length, start).toLowerCase() === testVal;
      };
      module.exports.InputScanner = InputScanner;
    }),
    /* 9 */
    /***/
    (function(module, __unused_webpack_exports, __webpack_require__2) {
      var InputScanner = __webpack_require__2(8).InputScanner;
      var Token = __webpack_require__2(3).Token;
      var TokenStream = __webpack_require__2(10).TokenStream;
      var WhitespacePattern = __webpack_require__2(11).WhitespacePattern;
      var TOKEN = {
        START: "TK_START",
        RAW: "TK_RAW",
        EOF: "TK_EOF"
      };
      var Tokenizer = function(input_string, options) {
        this._input = new InputScanner(input_string);
        this._options = options || {};
        this.__tokens = null;
        this._patterns = {};
        this._patterns.whitespace = new WhitespacePattern(this._input);
      };
      Tokenizer.prototype.tokenize = function() {
        this._input.restart();
        this.__tokens = new TokenStream();
        this._reset();
        var current;
        var previous = new Token(TOKEN.START, "");
        var open_token = null;
        var open_stack = [];
        var comments = new TokenStream();
        while (previous.type !== TOKEN.EOF) {
          current = this._get_next_token(previous, open_token);
          while (this._is_comment(current)) {
            comments.add(current);
            current = this._get_next_token(previous, open_token);
          }
          if (!comments.isEmpty()) {
            current.comments_before = comments;
            comments = new TokenStream();
          }
          current.parent = open_token;
          if (this._is_opening(current)) {
            open_stack.push(open_token);
            open_token = current;
          } else if (open_token && this._is_closing(current, open_token)) {
            current.opened = open_token;
            open_token.closed = current;
            open_token = open_stack.pop();
            current.parent = open_token;
          }
          current.previous = previous;
          previous.next = current;
          this.__tokens.add(current);
          previous = current;
        }
        return this.__tokens;
      };
      Tokenizer.prototype._is_first_token = function() {
        return this.__tokens.isEmpty();
      };
      Tokenizer.prototype._reset = function() {
      };
      Tokenizer.prototype._get_next_token = function(previous_token, open_token) {
        this._readWhitespace();
        var resulting_string = this._input.read(/.+/g);
        if (resulting_string) {
          return this._create_token(TOKEN.RAW, resulting_string);
        } else {
          return this._create_token(TOKEN.EOF, "");
        }
      };
      Tokenizer.prototype._is_comment = function(current_token) {
        return false;
      };
      Tokenizer.prototype._is_opening = function(current_token) {
        return false;
      };
      Tokenizer.prototype._is_closing = function(current_token, open_token) {
        return false;
      };
      Tokenizer.prototype._create_token = function(type, text) {
        var token = new Token(
          type,
          text,
          this._patterns.whitespace.newline_count,
          this._patterns.whitespace.whitespace_before_token
        );
        return token;
      };
      Tokenizer.prototype._readWhitespace = function() {
        return this._patterns.whitespace.read();
      };
      module.exports.Tokenizer = Tokenizer;
      module.exports.TOKEN = TOKEN;
    }),
    /* 10 */
    /***/
    (function(module) {
      function TokenStream(parent_token) {
        this.__tokens = [];
        this.__tokens_length = this.__tokens.length;
        this.__position = 0;
        this.__parent_token = parent_token;
      }
      TokenStream.prototype.restart = function() {
        this.__position = 0;
      };
      TokenStream.prototype.isEmpty = function() {
        return this.__tokens_length === 0;
      };
      TokenStream.prototype.hasNext = function() {
        return this.__position < this.__tokens_length;
      };
      TokenStream.prototype.next = function() {
        var val = null;
        if (this.hasNext()) {
          val = this.__tokens[this.__position];
          this.__position += 1;
        }
        return val;
      };
      TokenStream.prototype.peek = function(index) {
        var val = null;
        index = index || 0;
        index += this.__position;
        if (index >= 0 && index < this.__tokens_length) {
          val = this.__tokens[index];
        }
        return val;
      };
      TokenStream.prototype.add = function(token) {
        if (this.__parent_token) {
          token.parent = this.__parent_token;
        }
        this.__tokens.push(token);
        this.__tokens_length += 1;
      };
      module.exports.TokenStream = TokenStream;
    }),
    /* 11 */
    /***/
    (function(module, __unused_webpack_exports, __webpack_require__2) {
      var Pattern = __webpack_require__2(12).Pattern;
      function WhitespacePattern(input_scanner, parent) {
        Pattern.call(this, input_scanner, parent);
        if (parent) {
          this._line_regexp = this._input.get_regexp(parent._line_regexp);
        } else {
          this.__set_whitespace_patterns("", "");
        }
        this.newline_count = 0;
        this.whitespace_before_token = "";
      }
      WhitespacePattern.prototype = new Pattern();
      WhitespacePattern.prototype.__set_whitespace_patterns = function(whitespace_chars, newline_chars) {
        whitespace_chars += "\\t ";
        newline_chars += "\\n\\r";
        this._match_pattern = this._input.get_regexp(
          "[" + whitespace_chars + newline_chars + "]+",
          true
        );
        this._newline_regexp = this._input.get_regexp(
          "\\r\\n|[" + newline_chars + "]"
        );
      };
      WhitespacePattern.prototype.read = function() {
        this.newline_count = 0;
        this.whitespace_before_token = "";
        var resulting_string = this._input.read(this._match_pattern);
        if (resulting_string === " ") {
          this.whitespace_before_token = " ";
        } else if (resulting_string) {
          var matches = this.__split(this._newline_regexp, resulting_string);
          this.newline_count = matches.length - 1;
          this.whitespace_before_token = matches[this.newline_count];
        }
        return resulting_string;
      };
      WhitespacePattern.prototype.matching = function(whitespace_chars, newline_chars) {
        var result = this._create();
        result.__set_whitespace_patterns(whitespace_chars, newline_chars);
        result._update();
        return result;
      };
      WhitespacePattern.prototype._create = function() {
        return new WhitespacePattern(this._input, this);
      };
      WhitespacePattern.prototype.__split = function(regexp, input_string) {
        regexp.lastIndex = 0;
        var start_index = 0;
        var result = [];
        var next_match = regexp.exec(input_string);
        while (next_match) {
          result.push(input_string.substring(start_index, next_match.index));
          start_index = next_match.index + next_match[0].length;
          next_match = regexp.exec(input_string);
        }
        if (start_index < input_string.length) {
          result.push(input_string.substring(start_index, input_string.length));
        } else {
          result.push("");
        }
        return result;
      };
      module.exports.WhitespacePattern = WhitespacePattern;
    }),
    /* 12 */
    /***/
    (function(module) {
      function Pattern(input_scanner, parent) {
        this._input = input_scanner;
        this._starting_pattern = null;
        this._match_pattern = null;
        this._until_pattern = null;
        this._until_after = false;
        if (parent) {
          this._starting_pattern = this._input.get_regexp(parent._starting_pattern, true);
          this._match_pattern = this._input.get_regexp(parent._match_pattern, true);
          this._until_pattern = this._input.get_regexp(parent._until_pattern);
          this._until_after = parent._until_after;
        }
      }
      Pattern.prototype.read = function() {
        var result = this._input.read(this._starting_pattern);
        if (!this._starting_pattern || result) {
          result += this._input.read(this._match_pattern, this._until_pattern, this._until_after);
        }
        return result;
      };
      Pattern.prototype.read_match = function() {
        return this._input.match(this._match_pattern);
      };
      Pattern.prototype.until_after = function(pattern) {
        var result = this._create();
        result._until_after = true;
        result._until_pattern = this._input.get_regexp(pattern);
        result._update();
        return result;
      };
      Pattern.prototype.until = function(pattern) {
        var result = this._create();
        result._until_after = false;
        result._until_pattern = this._input.get_regexp(pattern);
        result._update();
        return result;
      };
      Pattern.prototype.starting_with = function(pattern) {
        var result = this._create();
        result._starting_pattern = this._input.get_regexp(pattern, true);
        result._update();
        return result;
      };
      Pattern.prototype.matching = function(pattern) {
        var result = this._create();
        result._match_pattern = this._input.get_regexp(pattern, true);
        result._update();
        return result;
      };
      Pattern.prototype._create = function() {
        return new Pattern(this._input, this);
      };
      Pattern.prototype._update = function() {
      };
      module.exports.Pattern = Pattern;
    }),
    /* 13 */
    /***/
    (function(module) {
      function Directives(start_block_pattern, end_block_pattern) {
        start_block_pattern = typeof start_block_pattern === "string" ? start_block_pattern : start_block_pattern.source;
        end_block_pattern = typeof end_block_pattern === "string" ? end_block_pattern : end_block_pattern.source;
        this.__directives_block_pattern = new RegExp(start_block_pattern + / beautify( \w+[:]\w+)+ /.source + end_block_pattern, "g");
        this.__directive_pattern = / (\w+)[:](\w+)/g;
        this.__directives_end_ignore_pattern = new RegExp(start_block_pattern + /\sbeautify\signore:end\s/.source + end_block_pattern, "g");
      }
      Directives.prototype.get_directives = function(text) {
        if (!text.match(this.__directives_block_pattern)) {
          return null;
        }
        var directives = {};
        this.__directive_pattern.lastIndex = 0;
        var directive_match = this.__directive_pattern.exec(text);
        while (directive_match) {
          directives[directive_match[1]] = directive_match[2];
          directive_match = this.__directive_pattern.exec(text);
        }
        return directives;
      };
      Directives.prototype.readIgnored = function(input) {
        return input.readUntilAfter(this.__directives_end_ignore_pattern);
      };
      module.exports.Directives = Directives;
    }),
    /* 14 */
    /***/
    (function(module, __unused_webpack_exports, __webpack_require__2) {
      var Pattern = __webpack_require__2(12).Pattern;
      var template_names = {
        django: false,
        erb: false,
        handlebars: false,
        php: false,
        smarty: false,
        angular: false
      };
      function TemplatablePattern(input_scanner, parent) {
        Pattern.call(this, input_scanner, parent);
        this.__template_pattern = null;
        this._disabled = Object.assign({}, template_names);
        this._excluded = Object.assign({}, template_names);
        if (parent) {
          this.__template_pattern = this._input.get_regexp(parent.__template_pattern);
          this._excluded = Object.assign(this._excluded, parent._excluded);
          this._disabled = Object.assign(this._disabled, parent._disabled);
        }
        var pattern = new Pattern(input_scanner);
        this.__patterns = {
          handlebars_comment: pattern.starting_with(/{{!--/).until_after(/--}}/),
          handlebars_unescaped: pattern.starting_with(/{{{/).until_after(/}}}/),
          handlebars: pattern.starting_with(/{{/).until_after(/}}/),
          php: pattern.starting_with(/<\?(?:[= ]|php)/).until_after(/\?>/),
          erb: pattern.starting_with(/<%[^%]/).until_after(/[^%]%>/),
          // django coflicts with handlebars a bit.
          django: pattern.starting_with(/{%/).until_after(/%}/),
          django_value: pattern.starting_with(/{{/).until_after(/}}/),
          django_comment: pattern.starting_with(/{#/).until_after(/#}/),
          smarty: pattern.starting_with(/{(?=[^}{\s\n])/).until_after(/[^\s\n]}/),
          smarty_comment: pattern.starting_with(/{\*/).until_after(/\*}/),
          smarty_literal: pattern.starting_with(/{literal}/).until_after(/{\/literal}/)
        };
      }
      TemplatablePattern.prototype = new Pattern();
      TemplatablePattern.prototype._create = function() {
        return new TemplatablePattern(this._input, this);
      };
      TemplatablePattern.prototype._update = function() {
        this.__set_templated_pattern();
      };
      TemplatablePattern.prototype.disable = function(language) {
        var result = this._create();
        result._disabled[language] = true;
        result._update();
        return result;
      };
      TemplatablePattern.prototype.read_options = function(options) {
        var result = this._create();
        for (var language in template_names) {
          result._disabled[language] = options.templating.indexOf(language) === -1;
        }
        result._update();
        return result;
      };
      TemplatablePattern.prototype.exclude = function(language) {
        var result = this._create();
        result._excluded[language] = true;
        result._update();
        return result;
      };
      TemplatablePattern.prototype.read = function() {
        var result = "";
        if (this._match_pattern) {
          result = this._input.read(this._starting_pattern);
        } else {
          result = this._input.read(this._starting_pattern, this.__template_pattern);
        }
        var next = this._read_template();
        while (next) {
          if (this._match_pattern) {
            next += this._input.read(this._match_pattern);
          } else {
            next += this._input.readUntil(this.__template_pattern);
          }
          result += next;
          next = this._read_template();
        }
        if (this._until_after) {
          result += this._input.readUntilAfter(this._until_pattern);
        }
        return result;
      };
      TemplatablePattern.prototype.__set_templated_pattern = function() {
        var items = [];
        if (!this._disabled.php) {
          items.push(this.__patterns.php._starting_pattern.source);
        }
        if (!this._disabled.handlebars) {
          items.push(this.__patterns.handlebars._starting_pattern.source);
        }
        if (!this._disabled.angular) {
          items.push(this.__patterns.handlebars._starting_pattern.source);
        }
        if (!this._disabled.erb) {
          items.push(this.__patterns.erb._starting_pattern.source);
        }
        if (!this._disabled.django) {
          items.push(this.__patterns.django._starting_pattern.source);
          items.push(this.__patterns.django_value._starting_pattern.source);
          items.push(this.__patterns.django_comment._starting_pattern.source);
        }
        if (!this._disabled.smarty) {
          items.push(this.__patterns.smarty._starting_pattern.source);
        }
        if (this._until_pattern) {
          items.push(this._until_pattern.source);
        }
        this.__template_pattern = this._input.get_regexp("(?:" + items.join("|") + ")");
      };
      TemplatablePattern.prototype._read_template = function() {
        var resulting_string = "";
        var c = this._input.peek();
        if (c === "<") {
          var peek1 = this._input.peek(1);
          if (!this._disabled.php && !this._excluded.php && peek1 === "?") {
            resulting_string = resulting_string || this.__patterns.php.read();
          }
          if (!this._disabled.erb && !this._excluded.erb && peek1 === "%") {
            resulting_string = resulting_string || this.__patterns.erb.read();
          }
        } else if (c === "{") {
          if (!this._disabled.handlebars && !this._excluded.handlebars) {
            resulting_string = resulting_string || this.__patterns.handlebars_comment.read();
            resulting_string = resulting_string || this.__patterns.handlebars_unescaped.read();
            resulting_string = resulting_string || this.__patterns.handlebars.read();
          }
          if (!this._disabled.django) {
            if (!this._excluded.django && !this._excluded.handlebars) {
              resulting_string = resulting_string || this.__patterns.django_value.read();
            }
            if (!this._excluded.django) {
              resulting_string = resulting_string || this.__patterns.django_comment.read();
              resulting_string = resulting_string || this.__patterns.django.read();
            }
          }
          if (!this._disabled.smarty) {
            if (this._disabled.django && this._disabled.handlebars) {
              resulting_string = resulting_string || this.__patterns.smarty_comment.read();
              resulting_string = resulting_string || this.__patterns.smarty_literal.read();
              resulting_string = resulting_string || this.__patterns.smarty.read();
            }
          }
        }
        return resulting_string;
      };
      module.exports.TemplatablePattern = TemplatablePattern;
    }),
    ,
    ,
    ,
    /* 18 */
    /***/
    (function(module, __unused_webpack_exports, __webpack_require__2) {
      var Beautifier = __webpack_require__2(19).Beautifier, Options = __webpack_require__2(20).Options;
      function style_html(html_source, options, js_beautify2, css_beautify2) {
        var beautifier = new Beautifier(html_source, options, js_beautify2, css_beautify2);
        return beautifier.beautify();
      }
      module.exports = style_html;
      module.exports.defaultOptions = function() {
        return new Options();
      };
    }),
    /* 19 */
    /***/
    (function(module, __unused_webpack_exports, __webpack_require__2) {
      var Options = __webpack_require__2(20).Options;
      var Output = __webpack_require__2(2).Output;
      var Tokenizer = __webpack_require__2(21).Tokenizer;
      var TOKEN = __webpack_require__2(21).TOKEN;
      var lineBreak = /\r\n|[\r\n]/;
      var allLineBreaks = /\r\n|[\r\n]/g;
      var Printer = function(options, base_indent_string) {
        this.indent_level = 0;
        this.alignment_size = 0;
        this.max_preserve_newlines = options.max_preserve_newlines;
        this.preserve_newlines = options.preserve_newlines;
        this._output = new Output(options, base_indent_string);
      };
      Printer.prototype.current_line_has_match = function(pattern) {
        return this._output.current_line.has_match(pattern);
      };
      Printer.prototype.set_space_before_token = function(value, non_breaking) {
        this._output.space_before_token = value;
        this._output.non_breaking_space = non_breaking;
      };
      Printer.prototype.set_wrap_point = function() {
        this._output.set_indent(this.indent_level, this.alignment_size);
        this._output.set_wrap_point();
      };
      Printer.prototype.add_raw_token = function(token) {
        this._output.add_raw_token(token);
      };
      Printer.prototype.print_preserved_newlines = function(raw_token) {
        var newlines = 0;
        if (raw_token.type !== TOKEN.TEXT && raw_token.previous.type !== TOKEN.TEXT) {
          newlines = raw_token.newlines ? 1 : 0;
        }
        if (this.preserve_newlines) {
          newlines = raw_token.newlines < this.max_preserve_newlines + 1 ? raw_token.newlines : this.max_preserve_newlines + 1;
        }
        for (var n = 0; n < newlines; n++) {
          this.print_newline(n > 0);
        }
        return newlines !== 0;
      };
      Printer.prototype.traverse_whitespace = function(raw_token) {
        if (raw_token.whitespace_before || raw_token.newlines) {
          if (!this.print_preserved_newlines(raw_token)) {
            this._output.space_before_token = true;
          }
          return true;
        }
        return false;
      };
      Printer.prototype.previous_token_wrapped = function() {
        return this._output.previous_token_wrapped;
      };
      Printer.prototype.print_newline = function(force) {
        this._output.add_new_line(force);
      };
      Printer.prototype.print_token = function(token) {
        if (token.text) {
          this._output.set_indent(this.indent_level, this.alignment_size);
          this._output.add_token(token.text);
        }
      };
      Printer.prototype.indent = function() {
        this.indent_level++;
      };
      Printer.prototype.deindent = function() {
        if (this.indent_level > 0) {
          this.indent_level--;
          this._output.set_indent(this.indent_level, this.alignment_size);
        }
      };
      Printer.prototype.get_full_indent = function(level) {
        level = this.indent_level + (level || 0);
        if (level < 1) {
          return "";
        }
        return this._output.get_indent_string(level);
      };
      var get_type_attribute = function(start_token) {
        var result = null;
        var raw_token = start_token.next;
        while (raw_token.type !== TOKEN.EOF && start_token.closed !== raw_token) {
          if (raw_token.type === TOKEN.ATTRIBUTE && raw_token.text === "type") {
            if (raw_token.next && raw_token.next.type === TOKEN.EQUALS && raw_token.next.next && raw_token.next.next.type === TOKEN.VALUE) {
              result = raw_token.next.next.text;
            }
            break;
          }
          raw_token = raw_token.next;
        }
        return result;
      };
      var get_custom_beautifier_name = function(tag_check, raw_token) {
        var typeAttribute = null;
        var result = null;
        if (!raw_token.closed) {
          return null;
        }
        if (tag_check === "script") {
          typeAttribute = "text/javascript";
        } else if (tag_check === "style") {
          typeAttribute = "text/css";
        }
        typeAttribute = get_type_attribute(raw_token) || typeAttribute;
        if (typeAttribute.search("text/css") > -1) {
          result = "css";
        } else if (typeAttribute.search(/module|((text|application|dojo)\/(x-)?(javascript|ecmascript|jscript|livescript|(ld\+)?json|method|aspect))/) > -1) {
          result = "javascript";
        } else if (typeAttribute.search(/(text|application|dojo)\/(x-)?(html)/) > -1) {
          result = "html";
        } else if (typeAttribute.search(/test\/null/) > -1) {
          result = "null";
        }
        return result;
      };
      function in_array(what, arr) {
        return arr.indexOf(what) !== -1;
      }
      function TagFrame(parent, parser_token, indent_level) {
        this.parent = parent || null;
        this.tag = parser_token ? parser_token.tag_name : "";
        this.indent_level = indent_level || 0;
        this.parser_token = parser_token || null;
      }
      function TagStack(printer) {
        this._printer = printer;
        this._current_frame = null;
      }
      TagStack.prototype.get_parser_token = function() {
        return this._current_frame ? this._current_frame.parser_token : null;
      };
      TagStack.prototype.record_tag = function(parser_token) {
        var new_frame = new TagFrame(this._current_frame, parser_token, this._printer.indent_level);
        this._current_frame = new_frame;
      };
      TagStack.prototype._try_pop_frame = function(frame) {
        var parser_token = null;
        if (frame) {
          parser_token = frame.parser_token;
          this._printer.indent_level = frame.indent_level;
          this._current_frame = frame.parent;
        }
        return parser_token;
      };
      TagStack.prototype._get_frame = function(tag_list, stop_list) {
        var frame = this._current_frame;
        while (frame) {
          if (tag_list.indexOf(frame.tag) !== -1) {
            break;
          } else if (stop_list && stop_list.indexOf(frame.tag) !== -1) {
            frame = null;
            break;
          }
          frame = frame.parent;
        }
        return frame;
      };
      TagStack.prototype.try_pop = function(tag, stop_list) {
        var frame = this._get_frame([tag], stop_list);
        return this._try_pop_frame(frame);
      };
      TagStack.prototype.indent_to_tag = function(tag_list) {
        var frame = this._get_frame(tag_list);
        if (frame) {
          this._printer.indent_level = frame.indent_level;
        }
      };
      function Beautifier(source_text, options, js_beautify2, css_beautify2) {
        this._source_text = source_text || "";
        options = options || {};
        this._js_beautify = js_beautify2;
        this._css_beautify = css_beautify2;
        this._tag_stack = null;
        var optionHtml = new Options(options, "html");
        this._options = optionHtml;
        this._is_wrap_attributes_force = this._options.wrap_attributes.substr(0, "force".length) === "force";
        this._is_wrap_attributes_force_expand_multiline = this._options.wrap_attributes === "force-expand-multiline";
        this._is_wrap_attributes_force_aligned = this._options.wrap_attributes === "force-aligned";
        this._is_wrap_attributes_aligned_multiple = this._options.wrap_attributes === "aligned-multiple";
        this._is_wrap_attributes_preserve = this._options.wrap_attributes.substr(0, "preserve".length) === "preserve";
        this._is_wrap_attributes_preserve_aligned = this._options.wrap_attributes === "preserve-aligned";
      }
      Beautifier.prototype.beautify = function() {
        if (this._options.disabled) {
          return this._source_text;
        }
        var source_text = this._source_text;
        var eol = this._options.eol;
        if (this._options.eol === "auto") {
          eol = "\n";
          if (source_text && lineBreak.test(source_text)) {
            eol = source_text.match(lineBreak)[0];
          }
        }
        source_text = source_text.replace(allLineBreaks, "\n");
        var baseIndentString = source_text.match(/^[\t ]*/)[0];
        var last_token = {
          text: "",
          type: ""
        };
        var last_tag_token = new TagOpenParserToken(this._options);
        var printer = new Printer(this._options, baseIndentString);
        var tokens = new Tokenizer(source_text, this._options).tokenize();
        this._tag_stack = new TagStack(printer);
        var parser_token = null;
        var raw_token = tokens.next();
        while (raw_token.type !== TOKEN.EOF) {
          if (raw_token.type === TOKEN.TAG_OPEN || raw_token.type === TOKEN.COMMENT) {
            parser_token = this._handle_tag_open(printer, raw_token, last_tag_token, last_token, tokens);
            last_tag_token = parser_token;
          } else if (raw_token.type === TOKEN.ATTRIBUTE || raw_token.type === TOKEN.EQUALS || raw_token.type === TOKEN.VALUE || raw_token.type === TOKEN.TEXT && !last_tag_token.tag_complete) {
            parser_token = this._handle_inside_tag(printer, raw_token, last_tag_token, last_token);
          } else if (raw_token.type === TOKEN.TAG_CLOSE) {
            parser_token = this._handle_tag_close(printer, raw_token, last_tag_token);
          } else if (raw_token.type === TOKEN.TEXT) {
            parser_token = this._handle_text(printer, raw_token, last_tag_token);
          } else if (raw_token.type === TOKEN.CONTROL_FLOW_OPEN) {
            parser_token = this._handle_control_flow_open(printer, raw_token);
          } else if (raw_token.type === TOKEN.CONTROL_FLOW_CLOSE) {
            parser_token = this._handle_control_flow_close(printer, raw_token);
          } else {
            printer.add_raw_token(raw_token);
          }
          last_token = parser_token;
          raw_token = tokens.next();
        }
        var sweet_code = printer._output.get_code(eol);
        return sweet_code;
      };
      Beautifier.prototype._handle_control_flow_open = function(printer, raw_token) {
        var parser_token = {
          text: raw_token.text,
          type: raw_token.type
        };
        printer.set_space_before_token(raw_token.newlines || raw_token.whitespace_before !== "", true);
        if (raw_token.newlines) {
          printer.print_preserved_newlines(raw_token);
        } else {
          printer.set_space_before_token(raw_token.newlines || raw_token.whitespace_before !== "", true);
        }
        printer.print_token(raw_token);
        printer.indent();
        return parser_token;
      };
      Beautifier.prototype._handle_control_flow_close = function(printer, raw_token) {
        var parser_token = {
          text: raw_token.text,
          type: raw_token.type
        };
        printer.deindent();
        if (raw_token.newlines) {
          printer.print_preserved_newlines(raw_token);
        } else {
          printer.set_space_before_token(raw_token.newlines || raw_token.whitespace_before !== "", true);
        }
        printer.print_token(raw_token);
        return parser_token;
      };
      Beautifier.prototype._handle_tag_close = function(printer, raw_token, last_tag_token) {
        var parser_token = {
          text: raw_token.text,
          type: raw_token.type
        };
        printer.alignment_size = 0;
        last_tag_token.tag_complete = true;
        printer.set_space_before_token(raw_token.newlines || raw_token.whitespace_before !== "", true);
        if (last_tag_token.is_unformatted) {
          printer.add_raw_token(raw_token);
        } else {
          if (last_tag_token.tag_start_char === "<") {
            printer.set_space_before_token(raw_token.text[0] === "/", true);
            if (this._is_wrap_attributes_force_expand_multiline && last_tag_token.has_wrapped_attrs) {
              printer.print_newline(false);
            }
          }
          printer.print_token(raw_token);
        }
        if (last_tag_token.indent_content && !(last_tag_token.is_unformatted || last_tag_token.is_content_unformatted)) {
          printer.indent();
          last_tag_token.indent_content = false;
        }
        if (!last_tag_token.is_inline_element && !(last_tag_token.is_unformatted || last_tag_token.is_content_unformatted)) {
          printer.set_wrap_point();
        }
        return parser_token;
      };
      Beautifier.prototype._handle_inside_tag = function(printer, raw_token, last_tag_token, last_token) {
        var wrapped = last_tag_token.has_wrapped_attrs;
        var parser_token = {
          text: raw_token.text,
          type: raw_token.type
        };
        printer.set_space_before_token(raw_token.newlines || raw_token.whitespace_before !== "", true);
        if (last_tag_token.is_unformatted) {
          printer.add_raw_token(raw_token);
        } else if (last_tag_token.tag_start_char === "{" && raw_token.type === TOKEN.TEXT) {
          if (printer.print_preserved_newlines(raw_token)) {
            raw_token.newlines = 0;
            printer.add_raw_token(raw_token);
          } else {
            printer.print_token(raw_token);
          }
        } else {
          if (raw_token.type === TOKEN.ATTRIBUTE) {
            printer.set_space_before_token(true);
          } else if (raw_token.type === TOKEN.EQUALS) {
            printer.set_space_before_token(false);
          } else if (raw_token.type === TOKEN.VALUE && raw_token.previous.type === TOKEN.EQUALS) {
            printer.set_space_before_token(false);
          }
          if (raw_token.type === TOKEN.ATTRIBUTE && last_tag_token.tag_start_char === "<") {
            if (this._is_wrap_attributes_preserve || this._is_wrap_attributes_preserve_aligned) {
              printer.traverse_whitespace(raw_token);
              wrapped = wrapped || raw_token.newlines !== 0;
            }
            if (this._is_wrap_attributes_force && last_tag_token.attr_count >= this._options.wrap_attributes_min_attrs && (last_token.type !== TOKEN.TAG_OPEN || // ie. second attribute and beyond
            this._is_wrap_attributes_force_expand_multiline)) {
              printer.print_newline(false);
              wrapped = true;
            }
          }
          printer.print_token(raw_token);
          wrapped = wrapped || printer.previous_token_wrapped();
          last_tag_token.has_wrapped_attrs = wrapped;
        }
        return parser_token;
      };
      Beautifier.prototype._handle_text = function(printer, raw_token, last_tag_token) {
        var parser_token = {
          text: raw_token.text,
          type: "TK_CONTENT"
        };
        if (last_tag_token.custom_beautifier_name) {
          this._print_custom_beatifier_text(printer, raw_token, last_tag_token);
        } else if (last_tag_token.is_unformatted || last_tag_token.is_content_unformatted) {
          printer.add_raw_token(raw_token);
        } else {
          printer.traverse_whitespace(raw_token);
          printer.print_token(raw_token);
        }
        return parser_token;
      };
      Beautifier.prototype._print_custom_beatifier_text = function(printer, raw_token, last_tag_token) {
        var local = this;
        if (raw_token.text !== "") {
          var text = raw_token.text, _beautifier, script_indent_level = 1, pre = "", post = "";
          if (last_tag_token.custom_beautifier_name === "javascript" && typeof this._js_beautify === "function") {
            _beautifier = this._js_beautify;
          } else if (last_tag_token.custom_beautifier_name === "css" && typeof this._css_beautify === "function") {
            _beautifier = this._css_beautify;
          } else if (last_tag_token.custom_beautifier_name === "html") {
            _beautifier = function(html_source, options) {
              var beautifier = new Beautifier(html_source, options, local._js_beautify, local._css_beautify);
              return beautifier.beautify();
            };
          }
          if (this._options.indent_scripts === "keep") {
            script_indent_level = 0;
          } else if (this._options.indent_scripts === "separate") {
            script_indent_level = -printer.indent_level;
          }
          var indentation = printer.get_full_indent(script_indent_level);
          text = text.replace(/\n[ \t]*$/, "");
          if (last_tag_token.custom_beautifier_name !== "html" && text[0] === "<" && text.match(/^(<!--|<!\[CDATA\[)/)) {
            var matched = /^(<!--[^\n]*|<!\[CDATA\[)(\n?)([ \t\n]*)([\s\S]*)(-->|]]>)$/.exec(text);
            if (!matched) {
              printer.add_raw_token(raw_token);
              return;
            }
            pre = indentation + matched[1] + "\n";
            text = matched[4];
            if (matched[5]) {
              post = indentation + matched[5];
            }
            text = text.replace(/\n[ \t]*$/, "");
            if (matched[2] || matched[3].indexOf("\n") !== -1) {
              matched = matched[3].match(/[ \t]+$/);
              if (matched) {
                raw_token.whitespace_before = matched[0];
              }
            }
          }
          if (text) {
            if (_beautifier) {
              var Child_options = function() {
                this.eol = "\n";
              };
              Child_options.prototype = this._options.raw_options;
              var child_options = new Child_options();
              text = _beautifier(indentation + text, child_options);
            } else {
              var white = raw_token.whitespace_before;
              if (white) {
                text = text.replace(new RegExp("\n(" + white + ")?", "g"), "\n");
              }
              text = indentation + text.replace(/\n/g, "\n" + indentation);
            }
          }
          if (pre) {
            if (!text) {
              text = pre + post;
            } else {
              text = pre + text + "\n" + post;
            }
          }
          printer.print_newline(false);
          if (text) {
            raw_token.text = text;
            raw_token.whitespace_before = "";
            raw_token.newlines = 0;
            printer.add_raw_token(raw_token);
            printer.print_newline(true);
          }
        }
      };
      Beautifier.prototype._handle_tag_open = function(printer, raw_token, last_tag_token, last_token, tokens) {
        var parser_token = this._get_tag_open_token(raw_token);
        if ((last_tag_token.is_unformatted || last_tag_token.is_content_unformatted) && !last_tag_token.is_empty_element && raw_token.type === TOKEN.TAG_OPEN && !parser_token.is_start_tag) {
          printer.add_raw_token(raw_token);
          parser_token.start_tag_token = this._tag_stack.try_pop(parser_token.tag_name);
        } else {
          printer.traverse_whitespace(raw_token);
          this._set_tag_position(printer, raw_token, parser_token, last_tag_token, last_token);
          if (!parser_token.is_inline_element) {
            printer.set_wrap_point();
          }
          printer.print_token(raw_token);
        }
        if (parser_token.is_start_tag && this._is_wrap_attributes_force) {
          var peek_index = 0;
          var peek_token;
          do {
            peek_token = tokens.peek(peek_index);
            if (peek_token.type === TOKEN.ATTRIBUTE) {
              parser_token.attr_count += 1;
            }
            peek_index += 1;
          } while (peek_token.type !== TOKEN.EOF && peek_token.type !== TOKEN.TAG_CLOSE);
        }
        if (this._is_wrap_attributes_force_aligned || this._is_wrap_attributes_aligned_multiple || this._is_wrap_attributes_preserve_aligned) {
          parser_token.alignment_size = raw_token.text.length + 1;
        }
        if (!parser_token.tag_complete && !parser_token.is_unformatted) {
          printer.alignment_size = parser_token.alignment_size;
        }
        return parser_token;
      };
      var TagOpenParserToken = function(options, parent, raw_token) {
        this.parent = parent || null;
        this.text = "";
        this.type = "TK_TAG_OPEN";
        this.tag_name = "";
        this.is_inline_element = false;
        this.is_unformatted = false;
        this.is_content_unformatted = false;
        this.is_empty_element = false;
        this.is_start_tag = false;
        this.is_end_tag = false;
        this.indent_content = false;
        this.multiline_content = false;
        this.custom_beautifier_name = null;
        this.start_tag_token = null;
        this.attr_count = 0;
        this.has_wrapped_attrs = false;
        this.alignment_size = 0;
        this.tag_complete = false;
        this.tag_start_char = "";
        this.tag_check = "";
        if (!raw_token) {
          this.tag_complete = true;
        } else {
          var tag_check_match;
          this.tag_start_char = raw_token.text[0];
          this.text = raw_token.text;
          if (this.tag_start_char === "<") {
            tag_check_match = raw_token.text.match(/^<([^\s>]*)/);
            this.tag_check = tag_check_match ? tag_check_match[1] : "";
          } else {
            tag_check_match = raw_token.text.match(/^{{~?(?:[\^]|#\*?)?([^\s}]+)/);
            this.tag_check = tag_check_match ? tag_check_match[1] : "";
            if ((raw_token.text.startsWith("{{#>") || raw_token.text.startsWith("{{~#>")) && this.tag_check[0] === ">") {
              if (this.tag_check === ">" && raw_token.next !== null) {
                this.tag_check = raw_token.next.text.split(" ")[0];
              } else {
                this.tag_check = raw_token.text.split(">")[1];
              }
            }
          }
          this.tag_check = this.tag_check.toLowerCase();
          if (raw_token.type === TOKEN.COMMENT) {
            this.tag_complete = true;
          }
          this.is_start_tag = this.tag_check.charAt(0) !== "/";
          this.tag_name = !this.is_start_tag ? this.tag_check.substr(1) : this.tag_check;
          this.is_end_tag = !this.is_start_tag || raw_token.closed && raw_token.closed.text === "/>";
          var handlebar_starts = 2;
          if (this.tag_start_char === "{" && this.text.length >= 3) {
            if (this.text.charAt(2) === "~") {
              handlebar_starts = 3;
            }
          }
          this.is_end_tag = this.is_end_tag || this.tag_start_char === "{" && (!options.indent_handlebars || this.text.length < 3 || /[^#\^]/.test(this.text.charAt(handlebar_starts)));
        }
      };
      Beautifier.prototype._get_tag_open_token = function(raw_token) {
        var parser_token = new TagOpenParserToken(this._options, this._tag_stack.get_parser_token(), raw_token);
        parser_token.alignment_size = this._options.wrap_attributes_indent_size;
        parser_token.is_end_tag = parser_token.is_end_tag || in_array(parser_token.tag_check, this._options.void_elements);
        parser_token.is_empty_element = parser_token.tag_complete || parser_token.is_start_tag && parser_token.is_end_tag;
        parser_token.is_unformatted = !parser_token.tag_complete && in_array(parser_token.tag_check, this._options.unformatted);
        parser_token.is_content_unformatted = !parser_token.is_empty_element && in_array(parser_token.tag_check, this._options.content_unformatted);
        parser_token.is_inline_element = in_array(parser_token.tag_name, this._options.inline) || this._options.inline_custom_elements && parser_token.tag_name.includes("-") || parser_token.tag_start_char === "{";
        return parser_token;
      };
      Beautifier.prototype._set_tag_position = function(printer, raw_token, parser_token, last_tag_token, last_token) {
        if (!parser_token.is_empty_element) {
          if (parser_token.is_end_tag) {
            parser_token.start_tag_token = this._tag_stack.try_pop(parser_token.tag_name);
          } else {
            if (this._do_optional_end_element(parser_token)) {
              if (!parser_token.is_inline_element) {
                printer.print_newline(false);
              }
            }
            this._tag_stack.record_tag(parser_token);
            if ((parser_token.tag_name === "script" || parser_token.tag_name === "style") && !(parser_token.is_unformatted || parser_token.is_content_unformatted)) {
              parser_token.custom_beautifier_name = get_custom_beautifier_name(parser_token.tag_check, raw_token);
            }
          }
        }
        if (in_array(parser_token.tag_check, this._options.extra_liners)) {
          printer.print_newline(false);
          if (!printer._output.just_added_blankline()) {
            printer.print_newline(true);
          }
        }
        if (parser_token.is_empty_element) {
          if (parser_token.tag_start_char === "{" && parser_token.tag_check === "else") {
            this._tag_stack.indent_to_tag(["if", "unless", "each"]);
            parser_token.indent_content = true;
            var foundIfOnCurrentLine = printer.current_line_has_match(/{{#if/);
            if (!foundIfOnCurrentLine) {
              printer.print_newline(false);
            }
          }
          if (parser_token.tag_name === "!--" && last_token.type === TOKEN.TAG_CLOSE && last_tag_token.is_end_tag && parser_token.text.indexOf("\n") === -1) {
          } else {
            if (!(parser_token.is_inline_element || parser_token.is_unformatted)) {
              printer.print_newline(false);
            }
            this._calcluate_parent_multiline(printer, parser_token);
          }
        } else if (parser_token.is_end_tag) {
          var do_end_expand = false;
          do_end_expand = parser_token.start_tag_token && parser_token.start_tag_token.multiline_content;
          do_end_expand = do_end_expand || !parser_token.is_inline_element && !(last_tag_token.is_inline_element || last_tag_token.is_unformatted) && !(last_token.type === TOKEN.TAG_CLOSE && parser_token.start_tag_token === last_tag_token) && last_token.type !== "TK_CONTENT";
          if (parser_token.is_content_unformatted || parser_token.is_unformatted) {
            do_end_expand = false;
          }
          if (do_end_expand) {
            printer.print_newline(false);
          }
        } else {
          parser_token.indent_content = !parser_token.custom_beautifier_name;
          if (parser_token.tag_start_char === "<") {
            if (parser_token.tag_name === "html") {
              parser_token.indent_content = this._options.indent_inner_html;
            } else if (parser_token.tag_name === "head") {
              parser_token.indent_content = this._options.indent_head_inner_html;
            } else if (parser_token.tag_name === "body") {
              parser_token.indent_content = this._options.indent_body_inner_html;
            }
          }
          if (!(parser_token.is_inline_element || parser_token.is_unformatted) && (last_token.type !== "TK_CONTENT" || parser_token.is_content_unformatted)) {
            printer.print_newline(false);
          }
          this._calcluate_parent_multiline(printer, parser_token);
        }
      };
      Beautifier.prototype._calcluate_parent_multiline = function(printer, parser_token) {
        if (parser_token.parent && printer._output.just_added_newline() && !((parser_token.is_inline_element || parser_token.is_unformatted) && parser_token.parent.is_inline_element)) {
          parser_token.parent.multiline_content = true;
        }
      };
      var p_closers = ["address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "menu", "nav", "ol", "p", "pre", "section", "table", "ul"];
      var p_parent_excludes = ["a", "audio", "del", "ins", "map", "noscript", "video"];
      Beautifier.prototype._do_optional_end_element = function(parser_token) {
        var result = null;
        if (parser_token.is_empty_element || !parser_token.is_start_tag || !parser_token.parent) {
          return;
        }
        if (parser_token.tag_name === "body") {
          result = result || this._tag_stack.try_pop("head");
        } else if (parser_token.tag_name === "li") {
          result = result || this._tag_stack.try_pop("li", ["ol", "ul", "menu"]);
        } else if (parser_token.tag_name === "dd" || parser_token.tag_name === "dt") {
          result = result || this._tag_stack.try_pop("dt", ["dl"]);
          result = result || this._tag_stack.try_pop("dd", ["dl"]);
        } else if (parser_token.parent.tag_name === "p" && p_closers.indexOf(parser_token.tag_name) !== -1) {
          var p_parent = parser_token.parent.parent;
          if (!p_parent || p_parent_excludes.indexOf(p_parent.tag_name) === -1) {
            result = result || this._tag_stack.try_pop("p");
          }
        } else if (parser_token.tag_name === "rp" || parser_token.tag_name === "rt") {
          result = result || this._tag_stack.try_pop("rt", ["ruby", "rtc"]);
          result = result || this._tag_stack.try_pop("rp", ["ruby", "rtc"]);
        } else if (parser_token.tag_name === "optgroup") {
          result = result || this._tag_stack.try_pop("optgroup", ["select"]);
        } else if (parser_token.tag_name === "option") {
          result = result || this._tag_stack.try_pop("option", ["select", "datalist", "optgroup"]);
        } else if (parser_token.tag_name === "colgroup") {
          result = result || this._tag_stack.try_pop("caption", ["table"]);
        } else if (parser_token.tag_name === "thead") {
          result = result || this._tag_stack.try_pop("caption", ["table"]);
          result = result || this._tag_stack.try_pop("colgroup", ["table"]);
        } else if (parser_token.tag_name === "tbody" || parser_token.tag_name === "tfoot") {
          result = result || this._tag_stack.try_pop("caption", ["table"]);
          result = result || this._tag_stack.try_pop("colgroup", ["table"]);
          result = result || this._tag_stack.try_pop("thead", ["table"]);
          result = result || this._tag_stack.try_pop("tbody", ["table"]);
        } else if (parser_token.tag_name === "tr") {
          result = result || this._tag_stack.try_pop("caption", ["table"]);
          result = result || this._tag_stack.try_pop("colgroup", ["table"]);
          result = result || this._tag_stack.try_pop("tr", ["table", "thead", "tbody", "tfoot"]);
        } else if (parser_token.tag_name === "th" || parser_token.tag_name === "td") {
          result = result || this._tag_stack.try_pop("td", ["table", "thead", "tbody", "tfoot", "tr"]);
          result = result || this._tag_stack.try_pop("th", ["table", "thead", "tbody", "tfoot", "tr"]);
        }
        parser_token.parent = this._tag_stack.get_parser_token();
        return result;
      };
      module.exports.Beautifier = Beautifier;
    }),
    /* 20 */
    /***/
    (function(module, __unused_webpack_exports, __webpack_require__2) {
      var BaseOptions = __webpack_require__2(6).Options;
      function Options(options) {
        BaseOptions.call(this, options, "html");
        if (this.templating.length === 1 && this.templating[0] === "auto") {
          this.templating = ["django", "erb", "handlebars", "php"];
        }
        this.indent_inner_html = this._get_boolean("indent_inner_html");
        this.indent_body_inner_html = this._get_boolean("indent_body_inner_html", true);
        this.indent_head_inner_html = this._get_boolean("indent_head_inner_html", true);
        this.indent_handlebars = this._get_boolean("indent_handlebars", true);
        this.wrap_attributes = this._get_selection(
          "wrap_attributes",
          ["auto", "force", "force-aligned", "force-expand-multiline", "aligned-multiple", "preserve", "preserve-aligned"]
        );
        this.wrap_attributes_min_attrs = this._get_number("wrap_attributes_min_attrs", 2);
        this.wrap_attributes_indent_size = this._get_number("wrap_attributes_indent_size", this.indent_size);
        this.extra_liners = this._get_array("extra_liners", ["head", "body", "/html"]);
        this.inline = this._get_array("inline", [
          "a",
          "abbr",
          "area",
          "audio",
          "b",
          "bdi",
          "bdo",
          "br",
          "button",
          "canvas",
          "cite",
          "code",
          "data",
          "datalist",
          "del",
          "dfn",
          "em",
          "embed",
          "i",
          "iframe",
          "img",
          "input",
          "ins",
          "kbd",
          "keygen",
          "label",
          "map",
          "mark",
          "math",
          "meter",
          "noscript",
          "object",
          "output",
          "progress",
          "q",
          "ruby",
          "s",
          "samp",
          /* 'script', */
          "select",
          "small",
          "span",
          "strong",
          "sub",
          "sup",
          "svg",
          "template",
          "textarea",
          "time",
          "u",
          "var",
          "video",
          "wbr",
          "text",
          // obsolete inline tags
          "acronym",
          "big",
          "strike",
          "tt"
        ]);
        this.inline_custom_elements = this._get_boolean("inline_custom_elements", true);
        this.void_elements = this._get_array("void_elements", [
          // HTLM void elements - aka self-closing tags - aka singletons
          // https://www.w3.org/html/wg/drafts/html/master/syntax.html#void-elements
          "area",
          "base",
          "br",
          "col",
          "embed",
          "hr",
          "img",
          "input",
          "keygen",
          "link",
          "menuitem",
          "meta",
          "param",
          "source",
          "track",
          "wbr",
          // NOTE: Optional tags are too complex for a simple list
          // they are hard coded in _do_optional_end_element
          // Doctype and xml elements
          "!doctype",
          "?xml",
          // obsolete tags
          // basefont: https://www.computerhope.com/jargon/h/html-basefont-tag.htm
          // isndex: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/isindex
          "basefont",
          "isindex"
        ]);
        this.unformatted = this._get_array("unformatted", []);
        this.content_unformatted = this._get_array("content_unformatted", [
          "pre",
          "textarea"
        ]);
        this.unformatted_content_delimiter = this._get_characters("unformatted_content_delimiter");
        this.indent_scripts = this._get_selection("indent_scripts", ["normal", "keep", "separate"]);
      }
      Options.prototype = new BaseOptions();
      module.exports.Options = Options;
    }),
    /* 21 */
    /***/
    (function(module, __unused_webpack_exports, __webpack_require__2) {
      var BaseTokenizer = __webpack_require__2(9).Tokenizer;
      var BASETOKEN = __webpack_require__2(9).TOKEN;
      var Directives = __webpack_require__2(13).Directives;
      var TemplatablePattern = __webpack_require__2(14).TemplatablePattern;
      var Pattern = __webpack_require__2(12).Pattern;
      var TOKEN = {
        TAG_OPEN: "TK_TAG_OPEN",
        TAG_CLOSE: "TK_TAG_CLOSE",
        CONTROL_FLOW_OPEN: "TK_CONTROL_FLOW_OPEN",
        CONTROL_FLOW_CLOSE: "TK_CONTROL_FLOW_CLOSE",
        ATTRIBUTE: "TK_ATTRIBUTE",
        EQUALS: "TK_EQUALS",
        VALUE: "TK_VALUE",
        COMMENT: "TK_COMMENT",
        TEXT: "TK_TEXT",
        UNKNOWN: "TK_UNKNOWN",
        START: BASETOKEN.START,
        RAW: BASETOKEN.RAW,
        EOF: BASETOKEN.EOF
      };
      var directives_core = new Directives(/<\!--/, /-->/);
      var Tokenizer = function(input_string, options) {
        BaseTokenizer.call(this, input_string, options);
        this._current_tag_name = "";
        var templatable_reader = new TemplatablePattern(this._input).read_options(this._options);
        var pattern_reader = new Pattern(this._input);
        this.__patterns = {
          word: templatable_reader.until(/[\n\r\t <]/),
          word_control_flow_close_excluded: templatable_reader.until(/[\n\r\t <}]/),
          single_quote: templatable_reader.until_after(/'/),
          double_quote: templatable_reader.until_after(/"/),
          attribute: templatable_reader.until(/[\n\r\t =>]|\/>/),
          element_name: templatable_reader.until(/[\n\r\t >\/]/),
          angular_control_flow_start: pattern_reader.matching(/\@[a-zA-Z]+[^({]*[({]/),
          handlebars_comment: pattern_reader.starting_with(/{{!--/).until_after(/--}}/),
          handlebars: pattern_reader.starting_with(/{{/).until_after(/}}/),
          handlebars_open: pattern_reader.until(/[\n\r\t }]/),
          handlebars_raw_close: pattern_reader.until(/}}/),
          comment: pattern_reader.starting_with(/<!--/).until_after(/-->/),
          cdata: pattern_reader.starting_with(/<!\[CDATA\[/).until_after(/]]>/),
          // https://en.wikipedia.org/wiki/Conditional_comment
          conditional_comment: pattern_reader.starting_with(/<!\[/).until_after(/]>/),
          processing: pattern_reader.starting_with(/<\?/).until_after(/\?>/)
        };
        if (this._options.indent_handlebars) {
          this.__patterns.word = this.__patterns.word.exclude("handlebars");
          this.__patterns.word_control_flow_close_excluded = this.__patterns.word_control_flow_close_excluded.exclude("handlebars");
        }
        this._unformatted_content_delimiter = null;
        if (this._options.unformatted_content_delimiter) {
          var literal_regexp = this._input.get_literal_regexp(this._options.unformatted_content_delimiter);
          this.__patterns.unformatted_content_delimiter = pattern_reader.matching(literal_regexp).until_after(literal_regexp);
        }
      };
      Tokenizer.prototype = new BaseTokenizer();
      Tokenizer.prototype._is_comment = function(current_token) {
        return false;
      };
      Tokenizer.prototype._is_opening = function(current_token) {
        return current_token.type === TOKEN.TAG_OPEN || current_token.type === TOKEN.CONTROL_FLOW_OPEN;
      };
      Tokenizer.prototype._is_closing = function(current_token, open_token) {
        return current_token.type === TOKEN.TAG_CLOSE && (open_token && ((current_token.text === ">" || current_token.text === "/>") && open_token.text[0] === "<" || current_token.text === "}}" && open_token.text[0] === "{" && open_token.text[1] === "{")) || current_token.type === TOKEN.CONTROL_FLOW_CLOSE && (current_token.text === "}" && open_token.text.endsWith("{"));
      };
      Tokenizer.prototype._reset = function() {
        this._current_tag_name = "";
      };
      Tokenizer.prototype._get_next_token = function(previous_token, open_token) {
        var token = null;
        this._readWhitespace();
        var c = this._input.peek();
        if (c === null) {
          return this._create_token(TOKEN.EOF, "");
        }
        token = token || this._read_open_handlebars(c, open_token);
        token = token || this._read_attribute(c, previous_token, open_token);
        token = token || this._read_close(c, open_token);
        token = token || this._read_script_and_style(c, previous_token);
        token = token || this._read_control_flows(c, open_token);
        token = token || this._read_raw_content(c, previous_token, open_token);
        token = token || this._read_content_word(c, open_token);
        token = token || this._read_comment_or_cdata(c);
        token = token || this._read_processing(c);
        token = token || this._read_open(c, open_token);
        token = token || this._create_token(TOKEN.UNKNOWN, this._input.next());
        return token;
      };
      Tokenizer.prototype._read_comment_or_cdata = function(c) {
        var token = null;
        var resulting_string = null;
        var directives = null;
        if (c === "<") {
          var peek1 = this._input.peek(1);
          if (peek1 === "!") {
            resulting_string = this.__patterns.comment.read();
            if (resulting_string) {
              directives = directives_core.get_directives(resulting_string);
              if (directives && directives.ignore === "start") {
                resulting_string += directives_core.readIgnored(this._input);
              }
            } else {
              resulting_string = this.__patterns.cdata.read();
            }
          }
          if (resulting_string) {
            token = this._create_token(TOKEN.COMMENT, resulting_string);
            token.directives = directives;
          }
        }
        return token;
      };
      Tokenizer.prototype._read_processing = function(c) {
        var token = null;
        var resulting_string = null;
        var directives = null;
        if (c === "<") {
          var peek1 = this._input.peek(1);
          if (peek1 === "!" || peek1 === "?") {
            resulting_string = this.__patterns.conditional_comment.read();
            resulting_string = resulting_string || this.__patterns.processing.read();
          }
          if (resulting_string) {
            token = this._create_token(TOKEN.COMMENT, resulting_string);
            token.directives = directives;
          }
        }
        return token;
      };
      Tokenizer.prototype._read_open = function(c, open_token) {
        var resulting_string = null;
        var token = null;
        if (!open_token || open_token.type === TOKEN.CONTROL_FLOW_OPEN) {
          if (c === "<") {
            resulting_string = this._input.next();
            if (this._input.peek() === "/") {
              resulting_string += this._input.next();
            }
            resulting_string += this.__patterns.element_name.read();
            token = this._create_token(TOKEN.TAG_OPEN, resulting_string);
          }
        }
        return token;
      };
      Tokenizer.prototype._read_open_handlebars = function(c, open_token) {
        var resulting_string = null;
        var token = null;
        if (!open_token || open_token.type === TOKEN.CONTROL_FLOW_OPEN) {
          if ((this._options.templating.includes("angular") || this._options.indent_handlebars) && c === "{" && this._input.peek(1) === "{") {
            if (this._options.indent_handlebars && this._input.peek(2) === "!") {
              resulting_string = this.__patterns.handlebars_comment.read();
              resulting_string = resulting_string || this.__patterns.handlebars.read();
              token = this._create_token(TOKEN.COMMENT, resulting_string);
            } else {
              resulting_string = this.__patterns.handlebars_open.read();
              token = this._create_token(TOKEN.TAG_OPEN, resulting_string);
            }
          }
        }
        return token;
      };
      Tokenizer.prototype._read_control_flows = function(c, open_token) {
        var resulting_string = "";
        var token = null;
        if (!this._options.templating.includes("angular")) {
          return token;
        }
        if (c === "@") {
          resulting_string = this.__patterns.angular_control_flow_start.read();
          if (resulting_string === "") {
            return token;
          }
          var opening_parentheses_count = resulting_string.endsWith("(") ? 1 : 0;
          var closing_parentheses_count = 0;
          while (!(resulting_string.endsWith("{") && opening_parentheses_count === closing_parentheses_count)) {
            var next_char = this._input.next();
            if (next_char === null) {
              break;
            } else if (next_char === "(") {
              opening_parentheses_count++;
            } else if (next_char === ")") {
              closing_parentheses_count++;
            }
            resulting_string += next_char;
          }
          token = this._create_token(TOKEN.CONTROL_FLOW_OPEN, resulting_string);
        } else if (c === "}" && open_token && open_token.type === TOKEN.CONTROL_FLOW_OPEN) {
          resulting_string = this._input.next();
          token = this._create_token(TOKEN.CONTROL_FLOW_CLOSE, resulting_string);
        }
        return token;
      };
      Tokenizer.prototype._read_close = function(c, open_token) {
        var resulting_string = null;
        var token = null;
        if (open_token && open_token.type === TOKEN.TAG_OPEN) {
          if (open_token.text[0] === "<" && (c === ">" || c === "/" && this._input.peek(1) === ">")) {
            resulting_string = this._input.next();
            if (c === "/") {
              resulting_string += this._input.next();
            }
            token = this._create_token(TOKEN.TAG_CLOSE, resulting_string);
          } else if (open_token.text[0] === "{" && c === "}" && this._input.peek(1) === "}") {
            this._input.next();
            this._input.next();
            token = this._create_token(TOKEN.TAG_CLOSE, "}}");
          }
        }
        return token;
      };
      Tokenizer.prototype._read_attribute = function(c, previous_token, open_token) {
        var token = null;
        var resulting_string = "";
        if (open_token && open_token.text[0] === "<") {
          if (c === "=") {
            token = this._create_token(TOKEN.EQUALS, this._input.next());
          } else if (c === '"' || c === "'") {
            var content = this._input.next();
            if (c === '"') {
              content += this.__patterns.double_quote.read();
            } else {
              content += this.__patterns.single_quote.read();
            }
            token = this._create_token(TOKEN.VALUE, content);
          } else {
            resulting_string = this.__patterns.attribute.read();
            if (resulting_string) {
              if (previous_token.type === TOKEN.EQUALS) {
                token = this._create_token(TOKEN.VALUE, resulting_string);
              } else {
                token = this._create_token(TOKEN.ATTRIBUTE, resulting_string);
              }
            }
          }
        }
        return token;
      };
      Tokenizer.prototype._is_content_unformatted = function(tag_name) {
        return this._options.void_elements.indexOf(tag_name) === -1 && (this._options.content_unformatted.indexOf(tag_name) !== -1 || this._options.unformatted.indexOf(tag_name) !== -1);
      };
      Tokenizer.prototype._read_raw_content = function(c, previous_token, open_token) {
        var resulting_string = "";
        if (open_token && open_token.text[0] === "{") {
          resulting_string = this.__patterns.handlebars_raw_close.read();
        } else if (previous_token.type === TOKEN.TAG_CLOSE && previous_token.opened.text[0] === "<" && previous_token.text[0] !== "/") {
          var tag_name = previous_token.opened.text.substr(1).toLowerCase();
          if (this._is_content_unformatted(tag_name)) {
            resulting_string = this._input.readUntil(new RegExp("</" + tag_name + "[\\n\\r\\t ]*?>", "ig"));
          }
        }
        if (resulting_string) {
          return this._create_token(TOKEN.TEXT, resulting_string);
        }
        return null;
      };
      Tokenizer.prototype._read_script_and_style = function(c, previous_token) {
        if (previous_token.type === TOKEN.TAG_CLOSE && previous_token.opened.text[0] === "<" && previous_token.text[0] !== "/") {
          var tag_name = previous_token.opened.text.substr(1).toLowerCase();
          if (tag_name === "script" || tag_name === "style") {
            var token = this._read_comment_or_cdata(c);
            if (token) {
              token.type = TOKEN.TEXT;
              return token;
            }
            var resulting_string = this._input.readUntil(new RegExp("</" + tag_name + "[\\n\\r\\t ]*?>", "ig"));
            if (resulting_string) {
              return this._create_token(TOKEN.TEXT, resulting_string);
            }
          }
        }
        return null;
      };
      Tokenizer.prototype._read_content_word = function(c, open_token) {
        var resulting_string = "";
        if (this._options.unformatted_content_delimiter) {
          if (c === this._options.unformatted_content_delimiter[0]) {
            resulting_string = this.__patterns.unformatted_content_delimiter.read();
          }
        }
        if (!resulting_string) {
          resulting_string = open_token && open_token.type === TOKEN.CONTROL_FLOW_OPEN ? this.__patterns.word_control_flow_close_excluded.read() : this.__patterns.word.read();
        }
        if (resulting_string) {
          return this._create_token(TOKEN.TEXT, resulting_string);
        }
        return null;
      };
      module.exports.Tokenizer = Tokenizer;
      module.exports.TOKEN = TOKEN;
    })
    /******/
  ];
  var __webpack_module_cache__ = {};
  function __webpack_require__(moduleId) {
    var cachedModule = __webpack_module_cache__[moduleId];
    if (cachedModule !== void 0) {
      return cachedModule.exports;
    }
    var module = __webpack_module_cache__[moduleId] = {
      /******/
      // no module.id needed
      /******/
      // no module.loaded needed
      /******/
      exports: {}
      /******/
    };
    __webpack_modules__[moduleId](module, module.exports, __webpack_require__);
    return module.exports;
  }
  var __webpack_exports__ = __webpack_require__(18);
  legacy_beautify_html = __webpack_exports__;
})();
function html_beautify(html_source, options) {
  return legacy_beautify_html(html_source, options, js_beautify, css_beautify);
}

// node_modules/vscode-html-languageservice/lib/esm/services/htmlFormatter.js
function format2(document, range, options) {
  let value = document.getText();
  let includesEnd = true;
  let initialIndentLevel = 0;
  const tabSize = options.tabSize || 4;
  if (range) {
    let startOffset = document.offsetAt(range.start);
    let extendedStart = startOffset;
    while (extendedStart > 0 && isWhitespace(value, extendedStart - 1)) {
      extendedStart--;
    }
    if (extendedStart === 0 || isEOL2(value, extendedStart - 1)) {
      startOffset = extendedStart;
    } else {
      if (extendedStart < startOffset) {
        startOffset = extendedStart + 1;
      }
    }
    let endOffset = document.offsetAt(range.end);
    let extendedEnd = endOffset;
    while (extendedEnd < value.length && isWhitespace(value, extendedEnd)) {
      extendedEnd++;
    }
    if (extendedEnd === value.length || isEOL2(value, extendedEnd)) {
      endOffset = extendedEnd;
    }
    range = Range.create(document.positionAt(startOffset), document.positionAt(endOffset));
    const firstHalf = value.substring(0, startOffset);
    if (new RegExp(/.*[<][^>]*$/).test(firstHalf)) {
      value = value.substring(startOffset, endOffset);
      return [{
        range,
        newText: value
      }];
    }
    includesEnd = endOffset === value.length;
    value = value.substring(startOffset, endOffset);
    if (startOffset !== 0) {
      const startOfLineOffset = document.offsetAt(Position.create(range.start.line, 0));
      initialIndentLevel = computeIndentLevel(document.getText(), startOfLineOffset, options);
    }
  } else {
    range = Range.create(Position.create(0, 0), document.positionAt(value.length));
  }
  const htmlOptions = {
    indent_size: tabSize,
    indent_char: options.insertSpaces ? " " : "	",
    indent_empty_lines: getFormatOption(options, "indentEmptyLines", false),
    wrap_line_length: getFormatOption(options, "wrapLineLength", 120),
    unformatted: getTagsFormatOption(options, "unformatted", void 0),
    content_unformatted: getTagsFormatOption(options, "contentUnformatted", void 0),
    indent_inner_html: getFormatOption(options, "indentInnerHtml", false),
    preserve_newlines: getFormatOption(options, "preserveNewLines", true),
    max_preserve_newlines: getFormatOption(options, "maxPreserveNewLines", 32786),
    indent_handlebars: getFormatOption(options, "indentHandlebars", false),
    end_with_newline: includesEnd && getFormatOption(options, "endWithNewline", false),
    extra_liners: getTagsFormatOption(options, "extraLiners", void 0),
    wrap_attributes: getFormatOption(options, "wrapAttributes", "auto"),
    wrap_attributes_indent_size: getFormatOption(options, "wrapAttributesIndentSize", void 0),
    eol: "\n",
    indent_scripts: getFormatOption(options, "indentScripts", "normal"),
    templating: getTemplatingFormatOption(options, "all"),
    unformatted_content_delimiter: getFormatOption(options, "unformattedContentDelimiter", "")
  };
  let result = html_beautify(trimLeft(value), htmlOptions);
  if (initialIndentLevel > 0) {
    const indent = options.insertSpaces ? repeat(" ", tabSize * initialIndentLevel) : repeat("	", initialIndentLevel);
    result = result.split("\n").join("\n" + indent);
    if (range.start.character === 0) {
      result = indent + result;
    }
  }
  return [{
    range,
    newText: result
  }];
}
function trimLeft(str) {
  return str.replace(/^\s+/, "");
}
function getFormatOption(options, key, dflt) {
  if (options && options.hasOwnProperty(key)) {
    const value = options[key];
    if (value !== null) {
      return value;
    }
  }
  return dflt;
}
function getTagsFormatOption(options, key, dflt) {
  const list = getFormatOption(options, key, null);
  if (typeof list === "string") {
    if (list.length > 0) {
      return list.split(",").map((t2) => t2.trim().toLowerCase());
    }
    return [];
  }
  return dflt;
}
function getTemplatingFormatOption(options, dflt) {
  const value = getFormatOption(options, "templating", dflt);
  if (value === true) {
    return ["auto"];
  }
  if (value === false || value === dflt || Array.isArray(value) === false) {
    return ["none"];
  }
  return value;
}
function computeIndentLevel(content, offset, options) {
  let i = offset;
  let nChars = 0;
  const tabSize = options.tabSize || 4;
  while (i < content.length) {
    const ch = content.charAt(i);
    if (ch === " ") {
      nChars++;
    } else if (ch === "	") {
      nChars += tabSize;
    } else {
      break;
    }
    i++;
  }
  return Math.floor(nChars / tabSize);
}
function isEOL2(text, offset) {
  return "\r\n".indexOf(text.charAt(offset)) !== -1;
}
function isWhitespace(text, offset) {
  return " 	".indexOf(text.charAt(offset)) !== -1;
}

// node_modules/vscode-uri/lib/esm/index.mjs
var LIB;
(() => {
  "use strict";
  var t2 = { 975: (t3) => {
    function e2(t4) {
      if ("string" != typeof t4) throw new TypeError("Path must be a string. Received " + JSON.stringify(t4));
    }
    function r2(t4, e3) {
      for (var r3, n3 = "", i2 = 0, o2 = -1, s2 = 0, h2 = 0; h2 <= t4.length; ++h2) {
        if (h2 < t4.length) r3 = t4.charCodeAt(h2);
        else {
          if (47 === r3) break;
          r3 = 47;
        }
        if (47 === r3) {
          if (o2 === h2 - 1 || 1 === s2) ;
          else if (o2 !== h2 - 1 && 2 === s2) {
            if (n3.length < 2 || 2 !== i2 || 46 !== n3.charCodeAt(n3.length - 1) || 46 !== n3.charCodeAt(n3.length - 2)) {
              if (n3.length > 2) {
                var a2 = n3.lastIndexOf("/");
                if (a2 !== n3.length - 1) {
                  -1 === a2 ? (n3 = "", i2 = 0) : i2 = (n3 = n3.slice(0, a2)).length - 1 - n3.lastIndexOf("/"), o2 = h2, s2 = 0;
                  continue;
                }
              } else if (2 === n3.length || 1 === n3.length) {
                n3 = "", i2 = 0, o2 = h2, s2 = 0;
                continue;
              }
            }
            e3 && (n3.length > 0 ? n3 += "/.." : n3 = "..", i2 = 2);
          } else n3.length > 0 ? n3 += "/" + t4.slice(o2 + 1, h2) : n3 = t4.slice(o2 + 1, h2), i2 = h2 - o2 - 1;
          o2 = h2, s2 = 0;
        } else 46 === r3 && -1 !== s2 ? ++s2 : s2 = -1;
      }
      return n3;
    }
    var n2 = { resolve: function() {
      for (var t4, n3 = "", i2 = false, o2 = arguments.length - 1; o2 >= -1 && !i2; o2--) {
        var s2;
        o2 >= 0 ? s2 = arguments[o2] : (void 0 === t4 && (t4 = process.cwd()), s2 = t4), e2(s2), 0 !== s2.length && (n3 = s2 + "/" + n3, i2 = 47 === s2.charCodeAt(0));
      }
      return n3 = r2(n3, !i2), i2 ? n3.length > 0 ? "/" + n3 : "/" : n3.length > 0 ? n3 : ".";
    }, normalize: function(t4) {
      if (e2(t4), 0 === t4.length) return ".";
      var n3 = 47 === t4.charCodeAt(0), i2 = 47 === t4.charCodeAt(t4.length - 1);
      return 0 !== (t4 = r2(t4, !n3)).length || n3 || (t4 = "."), t4.length > 0 && i2 && (t4 += "/"), n3 ? "/" + t4 : t4;
    }, isAbsolute: function(t4) {
      return e2(t4), t4.length > 0 && 47 === t4.charCodeAt(0);
    }, join: function() {
      if (0 === arguments.length) return ".";
      for (var t4, r3 = 0; r3 < arguments.length; ++r3) {
        var i2 = arguments[r3];
        e2(i2), i2.length > 0 && (void 0 === t4 ? t4 = i2 : t4 += "/" + i2);
      }
      return void 0 === t4 ? "." : n2.normalize(t4);
    }, relative: function(t4, r3) {
      if (e2(t4), e2(r3), t4 === r3) return "";
      if ((t4 = n2.resolve(t4)) === (r3 = n2.resolve(r3))) return "";
      for (var i2 = 1; i2 < t4.length && 47 === t4.charCodeAt(i2); ++i2) ;
      for (var o2 = t4.length, s2 = o2 - i2, h2 = 1; h2 < r3.length && 47 === r3.charCodeAt(h2); ++h2) ;
      for (var a2 = r3.length - h2, c2 = s2 < a2 ? s2 : a2, f2 = -1, u2 = 0; u2 <= c2; ++u2) {
        if (u2 === c2) {
          if (a2 > c2) {
            if (47 === r3.charCodeAt(h2 + u2)) return r3.slice(h2 + u2 + 1);
            if (0 === u2) return r3.slice(h2 + u2);
          } else s2 > c2 && (47 === t4.charCodeAt(i2 + u2) ? f2 = u2 : 0 === u2 && (f2 = 0));
          break;
        }
        var l2 = t4.charCodeAt(i2 + u2);
        if (l2 !== r3.charCodeAt(h2 + u2)) break;
        47 === l2 && (f2 = u2);
      }
      var g2 = "";
      for (u2 = i2 + f2 + 1; u2 <= o2; ++u2) u2 !== o2 && 47 !== t4.charCodeAt(u2) || (0 === g2.length ? g2 += ".." : g2 += "/..");
      return g2.length > 0 ? g2 + r3.slice(h2 + f2) : (h2 += f2, 47 === r3.charCodeAt(h2) && ++h2, r3.slice(h2));
    }, _makeLong: function(t4) {
      return t4;
    }, dirname: function(t4) {
      if (e2(t4), 0 === t4.length) return ".";
      for (var r3 = t4.charCodeAt(0), n3 = 47 === r3, i2 = -1, o2 = true, s2 = t4.length - 1; s2 >= 1; --s2) if (47 === (r3 = t4.charCodeAt(s2))) {
        if (!o2) {
          i2 = s2;
          break;
        }
      } else o2 = false;
      return -1 === i2 ? n3 ? "/" : "." : n3 && 1 === i2 ? "//" : t4.slice(0, i2);
    }, basename: function(t4, r3) {
      if (void 0 !== r3 && "string" != typeof r3) throw new TypeError('"ext" argument must be a string');
      e2(t4);
      var n3, i2 = 0, o2 = -1, s2 = true;
      if (void 0 !== r3 && r3.length > 0 && r3.length <= t4.length) {
        if (r3.length === t4.length && r3 === t4) return "";
        var h2 = r3.length - 1, a2 = -1;
        for (n3 = t4.length - 1; n3 >= 0; --n3) {
          var c2 = t4.charCodeAt(n3);
          if (47 === c2) {
            if (!s2) {
              i2 = n3 + 1;
              break;
            }
          } else -1 === a2 && (s2 = false, a2 = n3 + 1), h2 >= 0 && (c2 === r3.charCodeAt(h2) ? -1 == --h2 && (o2 = n3) : (h2 = -1, o2 = a2));
        }
        return i2 === o2 ? o2 = a2 : -1 === o2 && (o2 = t4.length), t4.slice(i2, o2);
      }
      for (n3 = t4.length - 1; n3 >= 0; --n3) if (47 === t4.charCodeAt(n3)) {
        if (!s2) {
          i2 = n3 + 1;
          break;
        }
      } else -1 === o2 && (s2 = false, o2 = n3 + 1);
      return -1 === o2 ? "" : t4.slice(i2, o2);
    }, extname: function(t4) {
      e2(t4);
      for (var r3 = -1, n3 = 0, i2 = -1, o2 = true, s2 = 0, h2 = t4.length - 1; h2 >= 0; --h2) {
        var a2 = t4.charCodeAt(h2);
        if (47 !== a2) -1 === i2 && (o2 = false, i2 = h2 + 1), 46 === a2 ? -1 === r3 ? r3 = h2 : 1 !== s2 && (s2 = 1) : -1 !== r3 && (s2 = -1);
        else if (!o2) {
          n3 = h2 + 1;
          break;
        }
      }
      return -1 === r3 || -1 === i2 || 0 === s2 || 1 === s2 && r3 === i2 - 1 && r3 === n3 + 1 ? "" : t4.slice(r3, i2);
    }, format: function(t4) {
      if (null === t4 || "object" != typeof t4) throw new TypeError('The "pathObject" argument must be of type Object. Received type ' + typeof t4);
      return (function(t5, e3) {
        var r3 = e3.dir || e3.root, n3 = e3.base || (e3.name || "") + (e3.ext || "");
        return r3 ? r3 === e3.root ? r3 + n3 : r3 + "/" + n3 : n3;
      })(0, t4);
    }, parse: function(t4) {
      e2(t4);
      var r3 = { root: "", dir: "", base: "", ext: "", name: "" };
      if (0 === t4.length) return r3;
      var n3, i2 = t4.charCodeAt(0), o2 = 47 === i2;
      o2 ? (r3.root = "/", n3 = 1) : n3 = 0;
      for (var s2 = -1, h2 = 0, a2 = -1, c2 = true, f2 = t4.length - 1, u2 = 0; f2 >= n3; --f2) if (47 !== (i2 = t4.charCodeAt(f2))) -1 === a2 && (c2 = false, a2 = f2 + 1), 46 === i2 ? -1 === s2 ? s2 = f2 : 1 !== u2 && (u2 = 1) : -1 !== s2 && (u2 = -1);
      else if (!c2) {
        h2 = f2 + 1;
        break;
      }
      return -1 === s2 || -1 === a2 || 0 === u2 || 1 === u2 && s2 === a2 - 1 && s2 === h2 + 1 ? -1 !== a2 && (r3.base = r3.name = 0 === h2 && o2 ? t4.slice(1, a2) : t4.slice(h2, a2)) : (0 === h2 && o2 ? (r3.name = t4.slice(1, s2), r3.base = t4.slice(1, a2)) : (r3.name = t4.slice(h2, s2), r3.base = t4.slice(h2, a2)), r3.ext = t4.slice(s2, a2)), h2 > 0 ? r3.dir = t4.slice(0, h2 - 1) : o2 && (r3.dir = "/"), r3;
    }, sep: "/", delimiter: ":", win32: null, posix: null };
    n2.posix = n2, t3.exports = n2;
  } }, e = {};
  function r(n2) {
    var i2 = e[n2];
    if (void 0 !== i2) return i2.exports;
    var o2 = e[n2] = { exports: {} };
    return t2[n2](o2, o2.exports, r), o2.exports;
  }
  r.d = (t3, e2) => {
    for (var n2 in e2) r.o(e2, n2) && !r.o(t3, n2) && Object.defineProperty(t3, n2, { enumerable: true, get: e2[n2] });
  }, r.o = (t3, e2) => Object.prototype.hasOwnProperty.call(t3, e2), r.r = (t3) => {
    "undefined" != typeof Symbol && Symbol.toStringTag && Object.defineProperty(t3, Symbol.toStringTag, { value: "Module" }), Object.defineProperty(t3, "__esModule", { value: true });
  };
  var n = {};
  let i;
  if (r.r(n), r.d(n, { URI: () => l, Utils: () => I }), "object" == typeof process) i = "win32" === process.platform;
  else if ("object" == typeof navigator) {
    let t3 = navigator.userAgent;
    i = t3.indexOf("Windows") >= 0;
  }
  const o = /^\w[\w\d+.-]*$/, s = /^\//, h = /^\/\//;
  function a(t3, e2) {
    if (!t3.scheme && e2) throw new Error(`[UriError]: Scheme is missing: {scheme: "", authority: "${t3.authority}", path: "${t3.path}", query: "${t3.query}", fragment: "${t3.fragment}"}`);
    if (t3.scheme && !o.test(t3.scheme)) throw new Error("[UriError]: Scheme contains illegal characters.");
    if (t3.path) {
      if (t3.authority) {
        if (!s.test(t3.path)) throw new Error('[UriError]: If a URI contains an authority component, then the path component must either be empty or begin with a slash ("/") character');
      } else if (h.test(t3.path)) throw new Error('[UriError]: If a URI does not contain an authority component, then the path cannot begin with two slash characters ("//")');
    }
  }
  const c = "", f = "/", u = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/;
  class l {
    static isUri(t3) {
      return t3 instanceof l || !!t3 && "string" == typeof t3.authority && "string" == typeof t3.fragment && "string" == typeof t3.path && "string" == typeof t3.query && "string" == typeof t3.scheme && "string" == typeof t3.fsPath && "function" == typeof t3.with && "function" == typeof t3.toString;
    }
    scheme;
    authority;
    path;
    query;
    fragment;
    constructor(t3, e2, r2, n2, i2, o2 = false) {
      "object" == typeof t3 ? (this.scheme = t3.scheme || c, this.authority = t3.authority || c, this.path = t3.path || c, this.query = t3.query || c, this.fragment = t3.fragment || c) : (this.scheme = /* @__PURE__ */ (function(t4, e3) {
        return t4 || e3 ? t4 : "file";
      })(t3, o2), this.authority = e2 || c, this.path = (function(t4, e3) {
        switch (t4) {
          case "https":
          case "http":
          case "file":
            e3 ? e3[0] !== f && (e3 = f + e3) : e3 = f;
        }
        return e3;
      })(this.scheme, r2 || c), this.query = n2 || c, this.fragment = i2 || c, a(this, o2));
    }
    get fsPath() {
      return v(this, false);
    }
    with(t3) {
      if (!t3) return this;
      let { scheme: e2, authority: r2, path: n2, query: i2, fragment: o2 } = t3;
      return void 0 === e2 ? e2 = this.scheme : null === e2 && (e2 = c), void 0 === r2 ? r2 = this.authority : null === r2 && (r2 = c), void 0 === n2 ? n2 = this.path : null === n2 && (n2 = c), void 0 === i2 ? i2 = this.query : null === i2 && (i2 = c), void 0 === o2 ? o2 = this.fragment : null === o2 && (o2 = c), e2 === this.scheme && r2 === this.authority && n2 === this.path && i2 === this.query && o2 === this.fragment ? this : new d(e2, r2, n2, i2, o2);
    }
    static parse(t3, e2 = false) {
      const r2 = u.exec(t3);
      return r2 ? new d(r2[2] || c, w(r2[4] || c), w(r2[5] || c), w(r2[7] || c), w(r2[9] || c), e2) : new d(c, c, c, c, c);
    }
    static file(t3) {
      let e2 = c;
      if (i && (t3 = t3.replace(/\\/g, f)), t3[0] === f && t3[1] === f) {
        const r2 = t3.indexOf(f, 2);
        -1 === r2 ? (e2 = t3.substring(2), t3 = f) : (e2 = t3.substring(2, r2), t3 = t3.substring(r2) || f);
      }
      return new d("file", e2, t3, c, c);
    }
    static from(t3) {
      const e2 = new d(t3.scheme, t3.authority, t3.path, t3.query, t3.fragment);
      return a(e2, true), e2;
    }
    toString(t3 = false) {
      return b(this, t3);
    }
    toJSON() {
      return this;
    }
    static revive(t3) {
      if (t3) {
        if (t3 instanceof l) return t3;
        {
          const e2 = new d(t3);
          return e2._formatted = t3.external, e2._fsPath = t3._sep === g ? t3.fsPath : null, e2;
        }
      }
      return t3;
    }
  }
  const g = i ? 1 : void 0;
  class d extends l {
    _formatted = null;
    _fsPath = null;
    get fsPath() {
      return this._fsPath || (this._fsPath = v(this, false)), this._fsPath;
    }
    toString(t3 = false) {
      return t3 ? b(this, true) : (this._formatted || (this._formatted = b(this, false)), this._formatted);
    }
    toJSON() {
      const t3 = { $mid: 1 };
      return this._fsPath && (t3.fsPath = this._fsPath, t3._sep = g), this._formatted && (t3.external = this._formatted), this.path && (t3.path = this.path), this.scheme && (t3.scheme = this.scheme), this.authority && (t3.authority = this.authority), this.query && (t3.query = this.query), this.fragment && (t3.fragment = this.fragment), t3;
    }
  }
  const p = { 58: "%3A", 47: "%2F", 63: "%3F", 35: "%23", 91: "%5B", 93: "%5D", 64: "%40", 33: "%21", 36: "%24", 38: "%26", 39: "%27", 40: "%28", 41: "%29", 42: "%2A", 43: "%2B", 44: "%2C", 59: "%3B", 61: "%3D", 32: "%20" };
  function m(t3, e2, r2) {
    let n2, i2 = -1;
    for (let o2 = 0; o2 < t3.length; o2++) {
      const s2 = t3.charCodeAt(o2);
      if (s2 >= 97 && s2 <= 122 || s2 >= 65 && s2 <= 90 || s2 >= 48 && s2 <= 57 || 45 === s2 || 46 === s2 || 95 === s2 || 126 === s2 || e2 && 47 === s2 || r2 && 91 === s2 || r2 && 93 === s2 || r2 && 58 === s2) -1 !== i2 && (n2 += encodeURIComponent(t3.substring(i2, o2)), i2 = -1), void 0 !== n2 && (n2 += t3.charAt(o2));
      else {
        void 0 === n2 && (n2 = t3.substr(0, o2));
        const e3 = p[s2];
        void 0 !== e3 ? (-1 !== i2 && (n2 += encodeURIComponent(t3.substring(i2, o2)), i2 = -1), n2 += e3) : -1 === i2 && (i2 = o2);
      }
    }
    return -1 !== i2 && (n2 += encodeURIComponent(t3.substring(i2))), void 0 !== n2 ? n2 : t3;
  }
  function y(t3) {
    let e2;
    for (let r2 = 0; r2 < t3.length; r2++) {
      const n2 = t3.charCodeAt(r2);
      35 === n2 || 63 === n2 ? (void 0 === e2 && (e2 = t3.substr(0, r2)), e2 += p[n2]) : void 0 !== e2 && (e2 += t3[r2]);
    }
    return void 0 !== e2 ? e2 : t3;
  }
  function v(t3, e2) {
    let r2;
    return r2 = t3.authority && t3.path.length > 1 && "file" === t3.scheme ? `//${t3.authority}${t3.path}` : 47 === t3.path.charCodeAt(0) && (t3.path.charCodeAt(1) >= 65 && t3.path.charCodeAt(1) <= 90 || t3.path.charCodeAt(1) >= 97 && t3.path.charCodeAt(1) <= 122) && 58 === t3.path.charCodeAt(2) ? e2 ? t3.path.substr(1) : t3.path[1].toLowerCase() + t3.path.substr(2) : t3.path, i && (r2 = r2.replace(/\//g, "\\")), r2;
  }
  function b(t3, e2) {
    const r2 = e2 ? y : m;
    let n2 = "", { scheme: i2, authority: o2, path: s2, query: h2, fragment: a2 } = t3;
    if (i2 && (n2 += i2, n2 += ":"), (o2 || "file" === i2) && (n2 += f, n2 += f), o2) {
      let t4 = o2.indexOf("@");
      if (-1 !== t4) {
        const e3 = o2.substr(0, t4);
        o2 = o2.substr(t4 + 1), t4 = e3.lastIndexOf(":"), -1 === t4 ? n2 += r2(e3, false, false) : (n2 += r2(e3.substr(0, t4), false, false), n2 += ":", n2 += r2(e3.substr(t4 + 1), false, true)), n2 += "@";
      }
      o2 = o2.toLowerCase(), t4 = o2.lastIndexOf(":"), -1 === t4 ? n2 += r2(o2, false, true) : (n2 += r2(o2.substr(0, t4), false, true), n2 += o2.substr(t4));
    }
    if (s2) {
      if (s2.length >= 3 && 47 === s2.charCodeAt(0) && 58 === s2.charCodeAt(2)) {
        const t4 = s2.charCodeAt(1);
        t4 >= 65 && t4 <= 90 && (s2 = `/${String.fromCharCode(t4 + 32)}:${s2.substr(3)}`);
      } else if (s2.length >= 2 && 58 === s2.charCodeAt(1)) {
        const t4 = s2.charCodeAt(0);
        t4 >= 65 && t4 <= 90 && (s2 = `${String.fromCharCode(t4 + 32)}:${s2.substr(2)}`);
      }
      n2 += r2(s2, true, false);
    }
    return h2 && (n2 += "?", n2 += r2(h2, false, false)), a2 && (n2 += "#", n2 += e2 ? a2 : m(a2, false, false)), n2;
  }
  function C(t3) {
    try {
      return decodeURIComponent(t3);
    } catch {
      return t3.length > 3 ? t3.substr(0, 3) + C(t3.substr(3)) : t3;
    }
  }
  const A = /(%[0-9A-Za-z][0-9A-Za-z])+/g;
  function w(t3) {
    return t3.match(A) ? t3.replace(A, ((t4) => C(t4))) : t3;
  }
  var x = r(975);
  const P = x.posix || x, _ = "/";
  var I;
  !(function(t3) {
    t3.joinPath = function(t4, ...e2) {
      return t4.with({ path: P.join(t4.path, ...e2) });
    }, t3.resolvePath = function(t4, ...e2) {
      let r2 = t4.path, n2 = false;
      r2[0] !== _ && (r2 = _ + r2, n2 = true);
      let i2 = P.resolve(r2, ...e2);
      return n2 && i2[0] === _ && !t4.authority && (i2 = i2.substring(1)), t4.with({ path: i2 });
    }, t3.dirname = function(t4) {
      if (0 === t4.path.length || t4.path === _) return t4;
      let e2 = P.dirname(t4.path);
      return 1 === e2.length && 46 === e2.charCodeAt(0) && (e2 = ""), t4.with({ path: e2 });
    }, t3.basename = function(t4) {
      return P.basename(t4.path);
    }, t3.extname = function(t4) {
      return P.extname(t4.path);
    };
  })(I || (I = {})), LIB = n;
})();
var { URI: URI2, Utils } = LIB;

// node_modules/vscode-html-languageservice/lib/esm/services/htmlLinks.js
function normalizeRef(url) {
  const first = url[0];
  const last = url[url.length - 1];
  if (first === last && (first === "'" || first === '"')) {
    url = url.substring(1, url.length - 1);
  }
  return url;
}
function validateRef(url, languageId) {
  if (!url.length) {
    return false;
  }
  if (languageId === "handlebars" && /{{|}}/.test(url)) {
    return false;
  }
  return /\b(w[\w\d+.-]*:\/\/)?[^\s()<>]+(?:\([\w\d]+\)|([^[:punct:]\s]|\/?))/.test(url);
}
function getWorkspaceUrl(documentUri, tokenContent, documentContext, base) {
  if (/^\s*javascript\:/i.test(tokenContent) || /[\n\r]/.test(tokenContent)) {
    return void 0;
  }
  tokenContent = tokenContent.replace(/^\s*/g, "");
  const match = tokenContent.match(/^(\w[\w\d+.-]*):/);
  if (match) {
    const schema = match[1].toLowerCase();
    if (schema === "http" || schema === "https" || schema === "file") {
      return tokenContent;
    }
    return void 0;
  }
  if (/^\#/i.test(tokenContent)) {
    return documentUri + tokenContent;
  }
  if (/^\/\//i.test(tokenContent)) {
    const pickedScheme = startsWith(documentUri, "https://") ? "https" : "http";
    return pickedScheme + ":" + tokenContent.replace(/^\s*/g, "");
  }
  if (documentContext) {
    return documentContext.resolveReference(tokenContent, base || documentUri);
  }
  return tokenContent;
}
function createLink(document, documentContext, attributeValue, startOffset, endOffset, base) {
  const tokenContent = normalizeRef(attributeValue);
  if (!validateRef(tokenContent, document.languageId)) {
    return void 0;
  }
  if (tokenContent.length < attributeValue.length) {
    startOffset++;
    endOffset--;
  }
  const workspaceUrl = getWorkspaceUrl(document.uri, tokenContent, documentContext, base);
  if (!workspaceUrl) {
    return void 0;
  }
  const target = validateAndCleanURI(workspaceUrl, document);
  return {
    range: Range.create(document.positionAt(startOffset), document.positionAt(endOffset)),
    target
  };
}
var _hash = "#".charCodeAt(0);
function validateAndCleanURI(uriStr, document) {
  try {
    let uri = URI2.parse(uriStr);
    if (uri.scheme === "file" && uri.query) {
      uri = uri.with({ query: null });
      uriStr = uri.toString(
        /* skipEncodig*/
        true
      );
    }
    if (uri.scheme === "file" && uri.fragment && !(uriStr.startsWith(document.uri) && uriStr.charCodeAt(document.uri.length) === _hash)) {
      return uri.with({ fragment: null }).toString(
        /* skipEncodig*/
        true
      );
    }
    return uriStr;
  } catch (e) {
    return void 0;
  }
}
var HTMLDocumentLinks = class {
  constructor(dataManager) {
    this.dataManager = dataManager;
  }
  findDocumentLinks(document, documentContext) {
    const newLinks = [];
    const scanner = createScanner(document.getText(), 0);
    let token = scanner.scan();
    let lastAttributeName = void 0;
    let lastTagName = void 0;
    let afterBase = false;
    let base = void 0;
    const idLocations = {};
    while (token !== TokenType.EOS) {
      switch (token) {
        case TokenType.StartTag:
          lastTagName = scanner.getTokenText().toLowerCase();
          if (!base) {
            afterBase = lastTagName === "base";
          }
          break;
        case TokenType.AttributeName:
          lastAttributeName = scanner.getTokenText().toLowerCase();
          break;
        case TokenType.AttributeValue:
          if (lastTagName && lastAttributeName && this.dataManager.isPathAttribute(lastTagName, lastAttributeName)) {
            const attributeValue = scanner.getTokenText();
            if (!afterBase) {
              const link = createLink(document, documentContext, attributeValue, scanner.getTokenOffset(), scanner.getTokenEnd(), base);
              if (link) {
                newLinks.push(link);
              }
            }
            if (afterBase && typeof base === "undefined") {
              base = normalizeRef(attributeValue);
              if (base && documentContext) {
                base = documentContext.resolveReference(base, document.uri);
              }
            }
            afterBase = false;
            lastAttributeName = void 0;
          } else if (lastAttributeName === "id") {
            const id = normalizeRef(scanner.getTokenText());
            idLocations[id] = scanner.getTokenOffset();
          }
          break;
      }
      token = scanner.scan();
    }
    for (const link of newLinks) {
      const localWithHash = document.uri + "#";
      if (link.target && startsWith(link.target, localWithHash)) {
        const target = link.target.substring(localWithHash.length);
        const offset = idLocations[target];
        if (offset !== void 0) {
          const pos = document.positionAt(offset);
          link.target = `${localWithHash}${pos.line + 1},${pos.character + 1}`;
        } else {
          link.target = document.uri;
        }
      }
    }
    return newLinks;
  }
};

// node_modules/vscode-html-languageservice/lib/esm/services/htmlHighlighting.js
function findDocumentHighlights(document, position, htmlDocument) {
  const offset = document.offsetAt(position);
  const node = htmlDocument.findNodeAt(offset);
  if (!node.tag) {
    return [];
  }
  const result = [];
  const startTagRange = getTagNameRange(TokenType.StartTag, document, node.start);
  const endTagRange = typeof node.endTagStart === "number" && getTagNameRange(TokenType.EndTag, document, node.endTagStart);
  if (startTagRange && covers(startTagRange, position) || endTagRange && covers(endTagRange, position)) {
    if (startTagRange) {
      result.push({ kind: DocumentHighlightKind.Read, range: startTagRange });
    }
    if (endTagRange) {
      result.push({ kind: DocumentHighlightKind.Read, range: endTagRange });
    }
  }
  return result;
}
function isBeforeOrEqual(pos1, pos2) {
  return pos1.line < pos2.line || pos1.line === pos2.line && pos1.character <= pos2.character;
}
function covers(range, position) {
  return isBeforeOrEqual(range.start, position) && isBeforeOrEqual(position, range.end);
}
function getTagNameRange(tokenType, document, startOffset) {
  const scanner = createScanner(document.getText(), startOffset);
  let token = scanner.scan();
  while (token !== TokenType.EOS && token !== tokenType) {
    token = scanner.scan();
  }
  if (token !== TokenType.EOS) {
    return { start: document.positionAt(scanner.getTokenOffset()), end: document.positionAt(scanner.getTokenEnd()) };
  }
  return null;
}

// node_modules/vscode-html-languageservice/lib/esm/services/htmlSymbolsProvider.js
function findDocumentSymbols(document, htmlDocument) {
  const symbols = [];
  const symbols2 = findDocumentSymbols2(document, htmlDocument);
  for (const symbol of symbols2) {
    walk(symbol, void 0);
  }
  return symbols;
  function walk(node, parent) {
    const symbol = SymbolInformation.create(node.name, node.kind, node.range, document.uri, parent?.name);
    symbol.containerName ?? (symbol.containerName = "");
    symbols.push(symbol);
    if (node.children) {
      for (const child of node.children) {
        walk(child, node);
      }
    }
  }
}
function findDocumentSymbols2(document, htmlDocument) {
  const symbols = [];
  htmlDocument.roots.forEach((node) => {
    provideFileSymbolsInternal(document, node, symbols);
  });
  return symbols;
}
function provideFileSymbolsInternal(document, node, symbols) {
  const name = nodeToName(node);
  const range = Range.create(document.positionAt(node.start), document.positionAt(node.end));
  const symbol = DocumentSymbol.create(name, void 0, SymbolKind.Field, range, range);
  symbols.push(symbol);
  node.children.forEach((child) => {
    symbol.children ?? (symbol.children = []);
    provideFileSymbolsInternal(document, child, symbol.children);
  });
}
function nodeToName(node) {
  let name = node.tag;
  if (node.attributes) {
    const id = node.attributes["id"];
    const classes = node.attributes["class"];
    if (id) {
      name += `#${id.replace(/[\"\']/g, "")}`;
    }
    if (classes) {
      name += classes.replace(/[\"\']/g, "").split(/\s+/).map((className) => `.${className}`).join("");
    }
  }
  return name || "?";
}

// node_modules/vscode-html-languageservice/lib/esm/services/htmlRename.js
function doRename(document, position, newName, htmlDocument) {
  const offset = document.offsetAt(position);
  const node = htmlDocument.findNodeAt(offset);
  if (!node.tag) {
    return null;
  }
  if (!isWithinTagRange(node, offset, node.tag)) {
    return null;
  }
  const edits = [];
  const startTagRange = {
    start: document.positionAt(node.start + "<".length),
    end: document.positionAt(node.start + "<".length + node.tag.length)
  };
  edits.push({
    range: startTagRange,
    newText: newName
  });
  if (node.endTagStart) {
    const endTagRange = {
      start: document.positionAt(node.endTagStart + "</".length),
      end: document.positionAt(node.endTagStart + "</".length + node.tag.length)
    };
    edits.push({
      range: endTagRange,
      newText: newName
    });
  }
  const changes = {
    [document.uri.toString()]: edits
  };
  return {
    changes
  };
}
function isWithinTagRange(node, offset, nodeTag) {
  if (node.endTagStart) {
    if (node.endTagStart + "</".length <= offset && offset <= node.endTagStart + "</".length + nodeTag.length) {
      return true;
    }
  }
  return node.start + "<".length <= offset && offset <= node.start + "<".length + nodeTag.length;
}

// node_modules/vscode-html-languageservice/lib/esm/services/htmlMatchingTagPosition.js
function findMatchingTagPosition(document, position, htmlDocument) {
  const offset = document.offsetAt(position);
  const node = htmlDocument.findNodeAt(offset);
  if (!node.tag) {
    return null;
  }
  if (!node.endTagStart) {
    return null;
  }
  if (node.start + "<".length <= offset && offset <= node.start + "<".length + node.tag.length) {
    const mirrorOffset = offset - "<".length - node.start + node.endTagStart + "</".length;
    return document.positionAt(mirrorOffset);
  }
  if (node.endTagStart + "</".length <= offset && offset <= node.endTagStart + "</".length + node.tag.length) {
    const mirrorOffset = offset - "</".length - node.endTagStart + node.start + "<".length;
    return document.positionAt(mirrorOffset);
  }
  return null;
}

// node_modules/vscode-html-languageservice/lib/esm/services/htmlLinkedEditing.js
function findLinkedEditingRanges(document, position, htmlDocument) {
  const offset = document.offsetAt(position);
  const node = htmlDocument.findNodeAt(offset);
  const tagLength = node.tag ? node.tag.length : 0;
  if (!node.endTagStart) {
    return null;
  }
  if (
    // Within open tag, compute close tag
    node.start + "<".length <= offset && offset <= node.start + "<".length + tagLength || // Within closing tag, compute open tag
    node.endTagStart + "</".length <= offset && offset <= node.endTagStart + "</".length + tagLength
  ) {
    return [
      Range.create(document.positionAt(node.start + "<".length), document.positionAt(node.start + "<".length + tagLength)),
      Range.create(document.positionAt(node.endTagStart + "</".length), document.positionAt(node.endTagStart + "</".length + tagLength))
    ];
  }
  return null;
}

// node_modules/vscode-html-languageservice/lib/esm/services/htmlFolding.js
var HTMLFolding = class {
  constructor(dataManager) {
    this.dataManager = dataManager;
  }
  limitRanges(ranges, rangeLimit) {
    ranges = ranges.sort((r1, r2) => {
      let diff = r1.startLine - r2.startLine;
      if (diff === 0) {
        diff = r1.endLine - r2.endLine;
      }
      return diff;
    });
    let top = void 0;
    const previous = [];
    const nestingLevels = [];
    const nestingLevelCounts = [];
    const setNestingLevel = (index, level) => {
      nestingLevels[index] = level;
      if (level < 30) {
        nestingLevelCounts[level] = (nestingLevelCounts[level] || 0) + 1;
      }
    };
    for (let i = 0; i < ranges.length; i++) {
      const entry = ranges[i];
      if (!top) {
        top = entry;
        setNestingLevel(i, 0);
      } else {
        if (entry.startLine > top.startLine) {
          if (entry.endLine <= top.endLine) {
            previous.push(top);
            top = entry;
            setNestingLevel(i, previous.length);
          } else if (entry.startLine > top.endLine) {
            do {
              top = previous.pop();
            } while (top && entry.startLine > top.endLine);
            if (top) {
              previous.push(top);
            }
            top = entry;
            setNestingLevel(i, previous.length);
          }
        }
      }
    }
    let entries = 0;
    let maxLevel = 0;
    for (let i = 0; i < nestingLevelCounts.length; i++) {
      const n = nestingLevelCounts[i];
      if (n) {
        if (n + entries > rangeLimit) {
          maxLevel = i;
          break;
        }
        entries += n;
      }
    }
    const result = [];
    for (let i = 0; i < ranges.length; i++) {
      const level = nestingLevels[i];
      if (typeof level === "number") {
        if (level < maxLevel || level === maxLevel && entries++ < rangeLimit) {
          result.push(ranges[i]);
        }
      }
    }
    return result;
  }
  getFoldingRanges(document, context) {
    const scanner = createScanner(document.getText());
    let token = scanner.scan();
    const ranges = [];
    const stack = [];
    let lastTagName = null;
    let prevStart = -1;
    let voidElements;
    function addRange(range) {
      ranges.push(range);
      prevStart = range.startLine;
    }
    while (token !== TokenType.EOS) {
      switch (token) {
        case TokenType.StartTag: {
          const tagName = scanner.getTokenText();
          const startLine = document.positionAt(scanner.getTokenOffset()).line;
          stack.push({ startLine, tagName });
          lastTagName = tagName;
          break;
        }
        case TokenType.EndTag: {
          lastTagName = scanner.getTokenText();
          break;
        }
        case TokenType.StartTagClose:
          if (!lastTagName) {
            break;
          }
          voidElements ?? (voidElements = this.dataManager.getVoidElements(document.languageId));
          if (!this.dataManager.isVoidElement(lastTagName, voidElements)) {
            break;
          }
        // fallthrough
        case TokenType.EndTagClose:
        case TokenType.StartTagSelfClose: {
          let i = stack.length - 1;
          while (i >= 0 && stack[i].tagName !== lastTagName) {
            i--;
          }
          if (i >= 0) {
            const stackElement = stack[i];
            stack.length = i;
            const line = document.positionAt(scanner.getTokenOffset()).line;
            const startLine = stackElement.startLine;
            const endLine = line - 1;
            if (endLine > startLine && prevStart !== startLine) {
              addRange({ startLine, endLine });
            }
          }
          break;
        }
        case TokenType.Comment: {
          let startLine = document.positionAt(scanner.getTokenOffset()).line;
          const text = scanner.getTokenText();
          const m = text.match(/^\s*#(region\b)|(endregion\b)/);
          if (m) {
            if (m[1]) {
              stack.push({ startLine, tagName: "" });
            } else {
              let i = stack.length - 1;
              while (i >= 0 && stack[i].tagName.length) {
                i--;
              }
              if (i >= 0) {
                const stackElement = stack[i];
                stack.length = i;
                const endLine = startLine;
                startLine = stackElement.startLine;
                if (endLine > startLine && prevStart !== startLine) {
                  addRange({ startLine, endLine, kind: FoldingRangeKind.Region });
                }
              }
            }
          } else {
            const endLine = document.positionAt(scanner.getTokenOffset() + scanner.getTokenLength()).line;
            if (startLine < endLine) {
              addRange({ startLine, endLine, kind: FoldingRangeKind.Comment });
            }
          }
          break;
        }
      }
      token = scanner.scan();
    }
    const rangeLimit = context && context.rangeLimit || Number.MAX_VALUE;
    if (ranges.length > rangeLimit) {
      return this.limitRanges(ranges, rangeLimit);
    }
    return ranges;
  }
};

// node_modules/vscode-html-languageservice/lib/esm/services/htmlSelectionRange.js
var HTMLSelectionRange = class {
  constructor(htmlParser) {
    this.htmlParser = htmlParser;
  }
  getSelectionRanges(document, positions) {
    const htmlDocument = this.htmlParser.parseDocument(document);
    return positions.map((p) => this.getSelectionRange(p, document, htmlDocument));
  }
  getSelectionRange(position, document, htmlDocument) {
    const applicableRanges = this.getApplicableRanges(document, position, htmlDocument);
    let prev = void 0;
    let current = void 0;
    for (let index = applicableRanges.length - 1; index >= 0; index--) {
      const range = applicableRanges[index];
      if (!prev || range[0] !== prev[0] || range[1] !== prev[1]) {
        current = SelectionRange.create(Range.create(document.positionAt(applicableRanges[index][0]), document.positionAt(applicableRanges[index][1])), current);
      }
      prev = range;
    }
    if (!current) {
      current = SelectionRange.create(Range.create(position, position));
    }
    return current;
  }
  getApplicableRanges(document, position, htmlDoc) {
    const currOffset = document.offsetAt(position);
    const currNode = htmlDoc.findNodeAt(currOffset);
    let result = this.getAllParentTagRanges(currNode);
    if (currNode.startTagEnd && !currNode.endTagStart) {
      if (currNode.startTagEnd !== currNode.end) {
        return [[currNode.start, currNode.end]];
      }
      const closeRange = Range.create(document.positionAt(currNode.startTagEnd - 2), document.positionAt(currNode.startTagEnd));
      const closeText = document.getText(closeRange);
      if (closeText === "/>") {
        result.unshift([currNode.start + 1, currNode.startTagEnd - 2]);
      } else {
        result.unshift([currNode.start + 1, currNode.startTagEnd - 1]);
      }
      const attributeLevelRanges = this.getAttributeLevelRanges(document, currNode, currOffset);
      result = attributeLevelRanges.concat(result);
      return result;
    }
    if (!currNode.startTagEnd || !currNode.endTagStart) {
      return result;
    }
    result.unshift([currNode.start, currNode.end]);
    if (currNode.start < currOffset && currOffset < currNode.startTagEnd) {
      result.unshift([currNode.start + 1, currNode.startTagEnd - 1]);
      const attributeLevelRanges = this.getAttributeLevelRanges(document, currNode, currOffset);
      result = attributeLevelRanges.concat(result);
      return result;
    } else if (currNode.startTagEnd <= currOffset && currOffset <= currNode.endTagStart) {
      result.unshift([currNode.startTagEnd, currNode.endTagStart]);
      return result;
    } else {
      if (currOffset >= currNode.endTagStart + 2) {
        result.unshift([currNode.endTagStart + 2, currNode.end - 1]);
      }
      return result;
    }
  }
  getAllParentTagRanges(initialNode) {
    let currNode = initialNode;
    const result = [];
    while (currNode.parent) {
      currNode = currNode.parent;
      this.getNodeRanges(currNode).forEach((r) => result.push(r));
    }
    return result;
  }
  getNodeRanges(n) {
    if (n.startTagEnd && n.endTagStart && n.startTagEnd < n.endTagStart) {
      return [
        [n.startTagEnd, n.endTagStart],
        [n.start, n.end]
      ];
    }
    return [
      [n.start, n.end]
    ];
  }
  getAttributeLevelRanges(document, currNode, currOffset) {
    const currNodeRange = Range.create(document.positionAt(currNode.start), document.positionAt(currNode.end));
    const currNodeText = document.getText(currNodeRange);
    const relativeOffset = currOffset - currNode.start;
    const scanner = createScanner(currNodeText);
    let token = scanner.scan();
    const positionOffset = currNode.start;
    const result = [];
    let isInsideAttribute = false;
    let attrStart = -1;
    while (token !== TokenType.EOS) {
      switch (token) {
        case TokenType.AttributeName: {
          if (relativeOffset < scanner.getTokenOffset()) {
            isInsideAttribute = false;
            break;
          }
          if (relativeOffset <= scanner.getTokenEnd()) {
            result.unshift([scanner.getTokenOffset(), scanner.getTokenEnd()]);
          }
          isInsideAttribute = true;
          attrStart = scanner.getTokenOffset();
          break;
        }
        case TokenType.AttributeValue: {
          if (!isInsideAttribute) {
            break;
          }
          const valueText = scanner.getTokenText();
          if (relativeOffset < scanner.getTokenOffset()) {
            result.push([attrStart, scanner.getTokenEnd()]);
            break;
          }
          if (relativeOffset >= scanner.getTokenOffset() && relativeOffset <= scanner.getTokenEnd()) {
            result.unshift([scanner.getTokenOffset(), scanner.getTokenEnd()]);
            if (valueText[0] === `"` && valueText[valueText.length - 1] === `"` || valueText[0] === `'` && valueText[valueText.length - 1] === `'`) {
              if (relativeOffset >= scanner.getTokenOffset() + 1 && relativeOffset <= scanner.getTokenEnd() - 1) {
                result.unshift([scanner.getTokenOffset() + 1, scanner.getTokenEnd() - 1]);
              }
            }
            result.push([attrStart, scanner.getTokenEnd()]);
          }
          break;
        }
      }
      token = scanner.scan();
    }
    return result.map((pair) => {
      return [pair[0] + positionOffset, pair[1] + positionOffset];
    });
  }
};

// node_modules/vscode-html-languageservice/lib/esm/languageFacts/data/webCustomData.js
var htmlData = {
  "version": 1.1,
  "tags": [
    {
      "name": "html",
      "description": {
        "kind": "markdown",
        "value": "The html element represents the root of an HTML document."
      },
      "attributes": [
        {
          "name": "manifest",
          "description": {
            "kind": "markdown",
            "value": "Specifies the URI of a resource manifest indicating resources that should be cached locally. See [Using the application cache](https://developer.mozilla.org/en-US/docs/Web/HTML/Using_the_application_cache) for details."
          }
        },
        {
          "name": "version",
          "description": 'Specifies the version of the HTML [Document Type Definition](https://developer.mozilla.org/en-US/docs/Glossary/DTD "Document Type Definition: In HTML, the doctype is the required "<!DOCTYPE html>" preamble found at the top of all documents. Its sole purpose is to prevent a browser from switching into so-called \u201Cquirks mode\u201D when rendering a document; that is, the "<!DOCTYPE html>" doctype ensures that the browser makes a best-effort attempt at following the relevant specifications, rather than using a different rendering mode that is incompatible with some specifications.") that governs the current document. This attribute is not needed, because it is redundant with the version information in the document type declaration.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "xmlns",
          "description": 'Specifies the XML Namespace of the document. Default value is `"http://www.w3.org/1999/xhtml"`. This is required in documents parsed with XML parsers, and optional in text/html documents.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/html"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "head",
      "description": {
        "kind": "markdown",
        "value": "The head element represents a collection of metadata for the Document."
      },
      "attributes": [
        {
          "name": "profile",
          "description": "The URIs of one or more metadata profiles, separated by white space."
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/head"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "title",
      "description": {
        "kind": "markdown",
        "value": "The title element represents the document's title or name. Authors should use titles that identify their documents even when they are used out of context, for example in a user's history or bookmarks, or in search results. The document's title is often different from its first heading, since the first heading does not have to stand alone when taken out of context."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/title"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "base",
      "description": {
        "kind": "markdown",
        "value": "The base element allows authors to specify the document base URL for the purposes of resolving relative URLs, and the name of the default browsing context for the purposes of following hyperlinks. The element does not represent any content beyond this information."
      },
      "void": true,
      "attributes": [
        {
          "name": "href",
          "description": {
            "kind": "markdown",
            "value": "The base URL to be used throughout the document for relative URL addresses. If this attribute is specified, this element must come before any other elements with attributes whose values are URLs. Absolute and relative URLs are allowed."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "target",
          "valueSet": "target",
          "description": {
            "kind": "markdown",
            "value": "A name or keyword indicating the default location to display the result when hyperlinks or forms cause navigation, for elements that do not have an explicit target reference. It is a name of, or keyword for, a _browsing context_ (for example: tab, window, or inline frame). The following keywords have special meanings:\n\n*   `_self`: Load the result into the same browsing context as the current one. This value is the default if the attribute is not specified.\n*   `_blank`: Load the result into a new unnamed browsing context.\n*   `_parent`: Load the result into the parent browsing context of the current one. If there is no parent, this option behaves the same way as `_self`.\n*   `_top`: Load the result into the top-level browsing context (that is, the browsing context that is an ancestor of the current one, and has no parent). If there is no parent, this option behaves the same way as `_self`.\n\nIf this attribute is specified, this element must come before any other elements with attributes whose values are URLs."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/base"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S3",
        "SM2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "link",
      "description": {
        "kind": "markdown",
        "value": "The link element allows authors to link their document to other resources."
      },
      "void": true,
      "attributes": [
        {
          "name": "href",
          "description": {
            "kind": "markdown",
            "value": 'This attribute specifies the [URL](https://developer.mozilla.org/en-US/docs/Glossary/URL "URL: Uniform Resource Locator (URL) is a text string specifying where a resource can be found on the Internet.") of the linked resource. A URL can be absolute or relative.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "crossorigin",
          "valueSet": "xo",
          "description": {
            "kind": "markdown",
            "value": 'This enumerated attribute indicates whether [CORS](https://developer.mozilla.org/en-US/docs/Glossary/CORS "CORS: CORS (Cross-Origin Resource Sharing) is a system, consisting of transmitting HTTP headers, that determines whether browsers block frontend JavaScript code from accessing responses for cross-origin requests.") must be used when fetching the resource. [CORS-enabled images](https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_Enabled_Image) can be reused in the [`<canvas>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas "Use the HTML <canvas> element with either the canvas scripting API or the WebGL API to draw graphics and animations.") element without being _tainted_. The allowed values are:\n\n`anonymous`\n\nA cross-origin request (i.e. with an [`Origin`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Origin "The Origin request header indicates where a fetch originates from. It doesn\'t include any path information, but only the server name. It is sent with CORS requests, as well as with POST requests. It is similar to the Referer header, but, unlike this header, it doesn\'t disclose the whole path.") HTTP header) is performed, but no credential is sent (i.e. no cookie, X.509 certificate, or HTTP Basic authentication). If the server does not give credentials to the origin site (by not setting the [`Access-Control-Allow-Origin`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Origin "The Access-Control-Allow-Origin response header indicates whether the response can be shared with requesting code from the given origin.") HTTP header) the image will be tainted and its usage restricted.\n\n`use-credentials`\n\nA cross-origin request (i.e. with an `Origin` HTTP header) is performed along with a credential sent (i.e. a cookie, certificate, and/or HTTP Basic authentication is performed). If the server does not give credentials to the origin site (through [`Access-Control-Allow-Credentials`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Credentials "The Access-Control-Allow-Credentials response header tells browsers whether to expose the response to frontend JavaScript code when the request\'s credentials mode (Request.credentials) is "include".") HTTP header), the resource will be _tainted_ and its usage restricted.\n\nIf the attribute is not present, the resource is fetched without a [CORS](https://developer.mozilla.org/en-US/docs/Glossary/CORS "CORS: CORS (Cross-Origin Resource Sharing) is a system, consisting of transmitting HTTP headers, that determines whether browsers block frontend JavaScript code from accessing responses for cross-origin requests.") request (i.e. without sending the `Origin` HTTP header), preventing its non-tainted usage. If invalid, it is handled as if the enumerated keyword **anonymous** was used. See [CORS settings attributes](https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_settings_attributes) for additional information.'
          },
          "browsers": [
            "C34",
            "CA34",
            "E17",
            "FF18",
            "FFA18",
            "S10",
            "SM10"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2018-04-30",
            "baseline_high_date": "2020-10-30"
          }
        },
        {
          "name": "rel",
          "description": {
            "kind": "markdown",
            "value": "This attribute names a relationship of the linked document to the current document. The attribute must be a space-separated list of the [link types values](https://developer.mozilla.org/en-US/docs/Web/HTML/Link_types)."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "media",
          "description": {
            "kind": "markdown",
            "value": "This attribute specifies the media that the linked resource applies to. Its value must be a media type / [media query](https://developer.mozilla.org/en-US/docs/Web/CSS/Media_queries). This attribute is mainly useful when linking to external stylesheets \u2014 it allows the user agent to pick the best adapted one for the device it runs on.\n\n**Notes:**\n\n*   In HTML 4, this can only be a simple white-space-separated list of media description literals, i.e., [media types and groups](https://developer.mozilla.org/en-US/docs/Web/CSS/@media), where defined and allowed as values for this attribute, such as `print`, `screen`, `aural`, `braille`. HTML5 extended this to any kind of [media queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Media_queries), which are a superset of the allowed values of HTML 4.\n*   Browsers not supporting [CSS3 Media Queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Media_queries) won't necessarily recognize the adequate link; do not forget to set fallback links, the restricted set of media queries defined in HTML 4."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "hreflang",
          "description": {
            "kind": "markdown",
            "value": "This attribute indicates the language of the linked resource. It is purely advisory. Allowed values are determined by [BCP47](https://www.ietf.org/rfc/bcp/bcp47.txt). Use this attribute only if the [`href`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a#attr-href) attribute is present."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "type",
          "description": {
            "kind": "markdown",
            "value": 'This attribute is used to define the type of the content linked to. The value of the attribute should be a MIME type such as **text/html**, **text/css**, and so on. The common use of this attribute is to define the type of stylesheet being referenced (such as **text/css**), but given that CSS is the only stylesheet language used on the web, not only is it possible to omit the `type` attribute, but is actually now recommended practice. It is also used on `rel="preload"` link types, to make sure the browser only downloads file types that it supports.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "sizes",
          "description": {
            "kind": "markdown",
            "value": "This attribute defines the sizes of the icons for visual media contained in the resource. It must be present only if the [`rel`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/link#attr-rel) contains a value of `icon` or a non-standard type such as Apple's `apple-touch-icon`. It may have the following values:\n\n*   `any`, meaning that the icon can be scaled to any size as it is in a vector format, like `image/svg+xml`.\n*   a white-space separated list of sizes, each in the format `_<width in pixels>_x_<height in pixels>_` or `_<width in pixels>_X_<height in pixels>_`. Each of these sizes must be contained in the resource.\n\n**Note:** Most icon formats are only able to store one single icon; therefore most of the time the [`sizes`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes#attr-sizes) contains only one entry. MS's ICO format does, as well as Apple's ICNS. ICO is more ubiquitous; you should definitely use it."
          },
          "browsers": [
            "C15",
            "CA18",
            "E79",
            "FF31",
            "FFA31",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-01-15",
            "baseline_high_date": "2022-07-15"
          }
        },
        {
          "name": "as",
          "description": 'This attribute is only used when `rel="preload"` or `rel="prefetch"` has been set on the `<link>` element. It specifies the type of content being loaded by the `<link>`, which is necessary for content prioritization, request matching, application of correct [content security policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP), and setting of correct [`Accept`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Accept "The Accept request HTTP header advertises which content types, expressed as MIME types, the client is able to understand. Using content negotiation, the server then selects one of the proposals, uses it and informs the client of its choice with the Content-Type response header. Browsers set adequate values for this header depending on\xA0the context where the request is done: when fetching a CSS stylesheet a different value is set for the request than when fetching an image,\xA0video or a script.") request header.',
          "browsers": [
            "C50",
            "CA50",
            "E17",
            "FF56",
            "FFA56",
            "S10",
            "SM10"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2018-04-30",
            "baseline_high_date": "2020-10-30"
          }
        },
        {
          "name": "importance",
          "description": "Indicates the relative importance of the resource. Priority hints are delegated using the values:"
        },
        {
          "name": "importance",
          "description": '**`auto`**: Indicates\xA0**no\xA0preference**. The browser may use its own heuristics to decide the priority of the resource.\n\n**`high`**: Indicates to the\xA0browser\xA0that the resource is of\xA0**high** priority.\n\n**`low`**:\xA0Indicates to the\xA0browser\xA0that the resource is of\xA0**low** priority.\n\n**Note:** The `importance` attribute may only be used for the `<link>` element if `rel="preload"` or `rel="prefetch"` is present.'
        },
        {
          "name": "integrity",
          "description": "Contains inline metadata \u2014 a base64-encoded cryptographic hash of the resource (file) you\u2019re telling the browser to fetch. The browser can use this to verify that the fetched resource has been delivered free of unexpected manipulation. See [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity).",
          "browsers": [
            "C45",
            "CA45",
            "E17",
            "FF43",
            "FFA43",
            "S11.1",
            "SM11.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2018-04-30",
            "baseline_high_date": "2020-10-30"
          }
        },
        {
          "name": "referrerpolicy",
          "description": 'A string indicating which referrer to use when fetching the resource:\n\n*   `no-referrer` means that the [`Referer`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referer "The Referer request header contains the address of the previous web page from which a link to the currently requested page was followed. The Referer header allows servers to identify where people are visiting them from and may use that data for analytics, logging, or optimized caching, for example.") header will not be sent.\n*   `no-referrer-when-downgrade` means that no [`Referer`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referer "The Referer request header contains the address of the previous web page from which a link to the currently requested page was followed. The Referer header allows servers to identify where people are visiting them from and may use that data for analytics, logging, or optimized caching, for example.") header will be sent when navigating to an origin without TLS (HTTPS). This is a user agent\u2019s default behavior, if no policy is otherwise specified.\n*   `origin` means that the referrer will be the origin of the page, which is roughly the scheme, the host, and the port.\n*   `origin-when-cross-origin` means that navigating to other origins will be limited to the scheme, the host, and the port, while navigating on the same origin will include the referrer\'s path.\n*   `unsafe-url` means that the referrer will include the origin and the path (but not the fragment, password, or username). This case is unsafe because it can leak origins and paths from TLS-protected resources to insecure origins.',
          "browsers": [
            "C51",
            "CA51",
            "E79",
            "FF50",
            "FFA50",
            "S14",
            "SM14"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-09-16",
            "baseline_high_date": "2023-03-16"
          }
        },
        {
          "name": "title",
          "description": 'The `title` attribute has special semantics on the `<link>` element. When used on a `<link rel="stylesheet">` it defines a [preferred or an alternate stylesheet](https://developer.mozilla.org/en-US/docs/Web/CSS/Alternative_style_sheets). Incorrectly using it may [cause the stylesheet to be ignored](https://developer.mozilla.org/en-US/docs/Correctly_Using_Titles_With_External_Stylesheets).'
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/link"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "meta",
      "description": {
        "kind": "markdown",
        "value": "The meta element represents various kinds of metadata that cannot be expressed using the title, base, link, style, and script elements."
      },
      "void": true,
      "attributes": [
        {
          "name": "name",
          "description": {
            "kind": "markdown",
            "value": 'This attribute defines the name of a piece of document-level metadata. It should not be set if one of the attributes [`itemprop`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes#attr-itemprop), [`http-equiv`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta#attr-http-equiv) or [`charset`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta#attr-charset) is also set.\n\nThis metadata name is associated with the value contained by the [`content`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta#attr-content) attribute. The possible values for the name attribute are:\n\n*   `application-name` which defines the name of the application running in the web page.\n    \n    **Note:**\n    \n    *   Browsers may use this to identify the application. It is different from the [`<title>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/title "The HTML Title element (<title>) defines the document\'s title that is shown in a browser\'s title bar or a page\'s tab.") element, which usually contain the application name, but may also contain information like the document name or a status.\n    *   Simple web pages shouldn\'t define an application-name.\n    \n*   `author` which defines the name of the document\'s author.\n*   `description` which contains a short and accurate summary of the content of the page. Several browsers, like Firefox and Opera, use this as the default description of bookmarked pages.\n*   `generator` which contains the identifier of the software that generated the page.\n*   `keywords` which contains words relevant to the page\'s content separated by commas.\n*   `referrer` which controls the [`Referer` HTTP header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referer) attached to requests sent from the document:\n    \n    Values for the `content` attribute of `<meta name="referrer">`\n    \n    `no-referrer`\n    \n    Do not send a HTTP `Referrer` header.\n    \n    `origin`\n    \n    Send the [origin](https://developer.mozilla.org/en-US/docs/Glossary/Origin) of the document.\n    \n    `no-referrer-when-downgrade`\n    \n    Send the [origin](https://developer.mozilla.org/en-US/docs/Glossary/Origin) as a referrer to URLs as secure as the current page, (https\u2192https), but does not send a referrer to less secure URLs (https\u2192http). This is the default behaviour.\n    \n    `origin-when-cross-origin`\n    \n    Send the full URL (stripped of parameters) for same-origin requests, but only send the [origin](https://developer.mozilla.org/en-US/docs/Glossary/Origin) for other cases.\n    \n    `same-origin`\n    \n    A referrer will be sent for [same-site origins](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy), but cross-origin requests will contain no referrer information.\n    \n    `strict-origin`\n    \n    Only send the origin of the document as the referrer to a-priori as-much-secure destination (HTTPS->HTTPS), but don\'t send it to a less secure destination (HTTPS->HTTP).\n    \n    `strict-origin-when-cross-origin`\n    \n    Send a full URL when performing a same-origin request, only send the origin of the document to a-priori as-much-secure destination (HTTPS->HTTPS), and send no header to a less secure destination (HTTPS->HTTP).\n    \n    `unsafe-URL`\n    \n    Send the full URL (stripped of parameters) for same-origin or cross-origin requests.\n    \n    **Notes:**\n    \n    *   Some browsers support the deprecated values of `always`, `default`, and `never` for referrer.\n    *   Dynamically inserting `<meta name="referrer">` (with [`document.write`](https://developer.mozilla.org/en-US/docs/Web/API/Document/write) or [`appendChild`](https://developer.mozilla.org/en-US/docs/Web/API/Node/appendChild)) makes the referrer behaviour unpredictable.\n    *   When several conflicting policies are defined, the no-referrer policy is applied.\n    \n\nThis attribute may also have a value taken from the extended list defined on [WHATWG Wiki MetaExtensions page](https://wiki.whatwg.org/wiki/MetaExtensions). Although none have been formally accepted yet, a few commonly used names are:\n\n*   `creator` which defines the name of the creator of the document, such as an organization or institution. If there are more than one, several [`<meta>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta "The HTML <meta> element represents metadata that cannot be represented by other HTML meta-related elements, like <base>, <link>, <script>, <style> or <title>.") elements should be used.\n*   `googlebot`, a synonym of `robots`, is only followed by Googlebot (the indexing crawler for Google).\n*   `publisher` which defines the name of the document\'s publisher.\n*   `robots` which defines the behaviour that cooperative crawlers, or "robots", should use with the page. It is a comma-separated list of the values below:\n    \n    Values for the content of `<meta name="robots">`\n    \n    Value\n    \n    Description\n    \n    Used by\n    \n    `index`\n    \n    Allows the robot to index the page (default).\n    \n    All\n    \n    `noindex`\n    \n    Requests the robot to not index the page.\n    \n    All\n    \n    `follow`\n    \n    Allows the robot to follow the links on the page (default).\n    \n    All\n    \n    `nofollow`\n    \n    Requests the robot to not follow the links on the page.\n    \n    All\n    \n    `none`\n    \n    Equivalent to `noindex, nofollow`\n    \n    [Google](https://support.google.com/webmasters/answer/79812)\n    \n    `noodp`\n    \n    Prevents using the [Open Directory Project](https://www.dmoz.org/) description, if any, as the page description in search engine results.\n    \n    [Google](https://support.google.com/webmasters/answer/35624#nodmoz), [Yahoo](https://help.yahoo.com/kb/search-for-desktop/meta-tags-robotstxt-yahoo-search-sln2213.html#cont5), [Bing](https://www.bing.com/webmaster/help/which-robots-metatags-does-bing-support-5198d240)\n    \n    `noarchive`\n    \n    Requests the search engine not to cache the page content.\n    \n    [Google](https://developers.google.com/webmasters/control-crawl-index/docs/robots_meta_tag#valid-indexing--serving-directives), [Yahoo](https://help.yahoo.com/kb/search-for-desktop/SLN2213.html), [Bing](https://www.bing.com/webmaster/help/which-robots-metatags-does-bing-support-5198d240)\n    \n    `nosnippet`\n    \n    Prevents displaying any description of the page in search engine results.\n    \n    [Google](https://developers.google.com/webmasters/control-crawl-index/docs/robots_meta_tag#valid-indexing--serving-directives), [Bing](https://www.bing.com/webmaster/help/which-robots-metatags-does-bing-support-5198d240)\n    \n    `noimageindex`\n    \n    Requests this page not to appear as the referring page of an indexed image.\n    \n    [Google](https://developers.google.com/webmasters/control-crawl-index/docs/robots_meta_tag#valid-indexing--serving-directives)\n    \n    `nocache`\n    \n    Synonym of `noarchive`.\n    \n    [Bing](https://www.bing.com/webmaster/help/which-robots-metatags-does-bing-support-5198d240)\n    \n    **Notes:**\n    \n    *   Only cooperative robots follow these rules. Do not expect to prevent e-mail harvesters with them.\n    *   The robot still needs to access the page in order to read these rules. To prevent bandwidth consumption, use a _[robots.txt](https://developer.mozilla.org/en-US/docs/Glossary/robots.txt "robots.txt: Robots.txt is a file which is usually placed in the root of any website. It decides whether\xA0crawlers are permitted or forbidden access to the web site.")_ file.\n    *   If you want to remove a page, `noindex` will work, but only after the robot visits the page again. Ensure that the `robots.txt` file is not preventing revisits.\n    *   Some values are mutually exclusive, like `index` and `noindex`, or `follow` and `nofollow`. In these cases the robot\'s behaviour is undefined and may vary between them.\n    *   Some crawler robots, like Google, Yahoo and Bing, support the same values for the HTTP header `X-Robots-Tag`; this allows non-HTML documents like images to use these rules.\n    \n*   `slurp`, is a synonym of `robots`, but only for Slurp - the crawler for Yahoo Search.\n*   `viewport`, which gives hints about the size of the initial size of the [viewport](https://developer.mozilla.org/en-US/docs/Glossary/viewport "viewport: A viewport represents a polygonal (normally rectangular) area in computer graphics that is currently being viewed. In web browser terms, it refers to the part of the document you\'re viewing which is currently visible in its window (or the screen, if the document is being viewed in full screen mode). Content outside the viewport is not visible onscreen until scrolled into view."). Used by mobile devices only.\n    \n    Values for the content of `<meta name="viewport">`\n    \n    Value\n    \n    Possible subvalues\n    \n    Description\n    \n    `width`\n    \n    A positive integer number, or the text `device-width`\n    \n    Defines the pixel width of the viewport that you want the web site to be rendered at.\n    \n    `height`\n    \n    A positive integer, or the text `device-height`\n    \n    Defines the height of the viewport. Not used by any browser.\n    \n    `initial-scale`\n    \n    A positive number between `0.0` and `10.0`\n    \n    Defines the ratio between the device width (`device-width` in portrait mode or `device-height` in landscape mode) and the viewport size.\n    \n    `maximum-scale`\n    \n    A positive number between `0.0` and `10.0`\n    \n    Defines the maximum amount to zoom in. It must be greater or equal to the `minimum-scale` or the behaviour is undefined. Browser settings can ignore this rule and iOS10+ ignores it by default.\n    \n    `minimum-scale`\n    \n    A positive number between `0.0` and `10.0`\n    \n    Defines the minimum zoom level. It must be smaller or equal to the `maximum-scale` or the behaviour is undefined. Browser settings can ignore this rule and iOS10+ ignores it by default.\n    \n    `user-scalable`\n    \n    `yes` or `no`\n    \n    If set to `no`, the user is not able to zoom in the webpage. The default is `yes`. Browser settings can ignore this rule, and iOS10+ ignores it by default.\n    \n    Specification\n    \n    Status\n    \n    Comment\n    \n    [CSS Device Adaptation  \n    The definition of \'<meta name="viewport">\' in that specification.](https://drafts.csswg.org/css-device-adapt/#viewport-meta)\n    \n    Working Draft\n    \n    Non-normatively describes the Viewport META element\n    \n    See also: [`@viewport`](https://developer.mozilla.org/en-US/docs/Web/CSS/@viewport "The @viewport CSS at-rule lets you configure the viewport through which the document is viewed. It\'s primarily used for mobile devices, but is also used by desktop browsers that support features like "snap to edge" (such as Microsoft Edge).")\n    \n    **Notes:**\n    \n    *   Though unstandardized, this declaration is respected by most mobile browsers due to de-facto dominance.\n    *   The default values may vary between devices and browsers.\n    *   To learn about this declaration in Firefox for Mobile, see [this article](https://developer.mozilla.org/en-US/docs/Mobile/Viewport_meta_tag "Mobile/Viewport meta tag").'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "http-equiv",
          "description": {
            "kind": "markdown",
            "value": 'Defines a pragma directive. The attribute is named `**http-equiv**(alent)` because all the allowed values are names of particular HTTP headers:\n\n*   `"content-language"`  \n    Defines the default language of the page. It can be overridden by the [lang](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/lang) attribute on any element.\n    \n    **Warning:** Do not use this value, as it is obsolete. Prefer the `lang` attribute on the [`<html>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/html "The HTML <html> element represents the root (top-level element) of an HTML document, so it is also referred to as the root element. All other elements must be descendants of this element.") element.\n    \n*   `"content-security-policy"`  \n    Allows page authors to define a [content policy](https://developer.mozilla.org/en-US/docs/Web/Security/CSP/CSP_policy_directives) for the current page. Content policies mostly specify allowed server origins and script endpoints which help guard against cross-site scripting attacks.\n*   `"content-type"`  \n    Defines the [MIME type](https://developer.mozilla.org/en-US/docs/Glossary/MIME_type) of the document, followed by its character encoding. It follows the same syntax as the HTTP `content-type` entity-header field, but as it is inside a HTML page, most values other than `text/html` are impossible. Therefore the valid syntax for its `content` is the string \'`text/html`\' followed by a character set with the following syntax: \'`; charset=_IANAcharset_`\', where `IANAcharset` is the _preferred MIME name_ for a character set as [defined by the IANA.](https://www.iana.org/assignments/character-sets)\n    \n    **Warning:** Do not use this value, as it is obsolete. Use the [`charset`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta#attr-charset) attribute on the [`<meta>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta "The HTML <meta> element represents metadata that cannot be represented by other HTML meta-related elements, like <base>, <link>, <script>, <style> or <title>.") element.\n    \n    **Note:** As [`<meta>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta "The HTML <meta> element represents metadata that cannot be represented by other HTML meta-related elements, like <base>, <link>, <script>, <style> or <title>.") can\'t change documents\' types in XHTML or HTML5\'s XHTML serialization, never set the MIME type to an XHTML MIME type with `<meta>`.\n    \n*   `"refresh"`  \n    This instruction specifies:\n    *   The number of seconds until the page should be reloaded - only if the [`content`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta#attr-content) attribute contains a positive integer.\n    *   The number of seconds until the page should redirect to another - only if the [`content`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta#attr-content) attribute contains a positive integer followed by the string \'`;url=`\', and a valid URL.\n*   `"set-cookie"`  \n    Defines a [cookie](https://developer.mozilla.org/en-US/docs/cookie) for the page. Its content must follow the syntax defined in the [IETF HTTP Cookie Specification](https://tools.ietf.org/html/draft-ietf-httpstate-cookie-14).\n    \n    **Warning:** Do not use this instruction, as it is obsolete. Use the HTTP header [`Set-Cookie`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie) instead.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "content",
          "description": {
            "kind": "markdown",
            "value": "This attribute contains the value for the [`http-equiv`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta#attr-http-equiv) or [`name`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta#attr-name) attribute, depending on which is used."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "charset",
          "description": {
            "kind": "markdown",
            "value": 'This attribute declares the page\'s character encoding. It must contain a [standard IANA MIME name for character encodings](https://www.iana.org/assignments/character-sets). Although the standard doesn\'t request a specific encoding, it suggests:\n\n*   Authors are encouraged to use [`UTF-8`](https://developer.mozilla.org/en-US/docs/Glossary/UTF-8).\n*   Authors should not use ASCII-incompatible encodings to avoid security risk: browsers not supporting them may interpret harmful content as HTML. This happens with the `JIS_C6226-1983`, `JIS_X0212-1990`, `HZ-GB-2312`, `JOHAB`, the ISO-2022 family and the EBCDIC family.\n\n**Note:** ASCII-incompatible encodings are those that don\'t map the 8-bit code points `0x20` to `0x7E` to the `0x0020` to `0x007E` Unicode code points)\n\n*   Authors **must not** use `CESU-8`, `UTF-7`, `BOCU-1` and/or `SCSU` as [cross-site scripting](https://developer.mozilla.org/en-US/docs/Glossary/Cross-site_scripting) attacks with these encodings have been demonstrated.\n*   Authors should not use `UTF-32` because not all HTML5 encoding algorithms can distinguish it from `UTF-16`.\n\n**Notes:**\n\n*   The declared character encoding must match the one the page was saved with to avoid garbled characters and security holes.\n*   The [`<meta>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta "The HTML <meta> element represents metadata that cannot be represented by other HTML meta-related elements, like <base>, <link>, <script>, <style> or <title>.") element declaring the encoding must be inside the [`<head>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/head "The HTML <head> element provides general information (metadata) about the document, including its title and links to its\xA0scripts and style sheets.") element and **within the first 1024 bytes** of the HTML as some browsers only look at those bytes before choosing an encoding.\n*   This [`<meta>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta "The HTML <meta> element represents metadata that cannot be represented by other HTML meta-related elements, like <base>, <link>, <script>, <style> or <title>.") element is only one part of the [algorithm to determine a page\'s character set](https://www.whatwg.org/specs/web-apps/current-work/multipage/parsing.html#encoding-sniffing-algorithm "Algorithm charset page"). The [`Content-Type` header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type) and any [Byte-Order Marks](https://developer.mozilla.org/en-US/docs/Glossary/Byte-Order_Mark "The definition of that term (Byte-Order Marks) has not been written yet; please consider contributing it!") override this element.\n*   It is strongly recommended to define the character encoding. If a page\'s encoding is undefined, cross-scripting techniques are possible, such as the [`UTF-7` fallback cross-scripting technique](https://code.google.com/p/doctype-mirror/wiki/ArticleUtf7).\n*   The [`<meta>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta "The HTML <meta> element represents metadata that cannot be represented by other HTML meta-related elements, like <base>, <link>, <script>, <style> or <title>.") element with a `charset` attribute is a synonym for the pre-HTML5 `<meta http-equiv="Content-Type" content="text/html; charset=_IANAcharset_">`, where _`IANAcharset`_ contains the value of the equivalent [`charset`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta#attr-charset) attribute. This syntax is still allowed, although no longer recommended.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "scheme",
          "description": "This attribute defines the scheme in which metadata is described. A scheme is a context leading to the correct interpretations of the [`content`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta#attr-content) value, like a format.\n\n**Warning:** Do not use this value, as it is obsolete. There is no replacement as there was no real usage for it.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/meta"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "style",
      "description": {
        "kind": "markdown",
        "value": "The style element allows authors to embed style information in their documents. The style element is one of several inputs to the styling processing model. The element does not represent content for the user."
      },
      "attributes": [
        {
          "name": "media",
          "description": {
            "kind": "markdown",
            "value": "This attribute defines which media the style should be applied to. Its value is a [media query](https://developer.mozilla.org/en-US/docs/Web/Guide/CSS/Media_queries), which defaults to `all` if the attribute is missing."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "nonce",
          "description": {
            "kind": "markdown",
            "value": "A cryptographic nonce (number used once) used to allow inline styles in a [style-src Content-Security-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/style-src). The server must generate a unique nonce value each time it transmits a policy. It is critical to provide a nonce that cannot be guessed as bypassing a resource\u2019s policy is otherwise trivial."
          }
        },
        {
          "name": "type",
          "description": {
            "kind": "markdown",
            "value": "This attribute defines the styling language as a MIME type (charset should not be specified). This attribute is optional and defaults to `text/css` if it is not specified \u2014 there is very little reason to include this in modern web documents."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "scoped",
          "valueSet": "v"
        },
        {
          "name": "title",
          "description": "This attribute specifies [alternative style sheet](https://developer.mozilla.org/en-US/docs/Web/CSS/Alternative_style_sheets) sets."
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/style"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "body",
      "description": {
        "kind": "markdown",
        "value": "The body element represents the content of the document."
      },
      "attributes": [
        {
          "name": "onafterprint",
          "description": {
            "kind": "markdown",
            "value": "Function to call after the user has printed the document."
          }
        },
        {
          "name": "onbeforeprint",
          "description": {
            "kind": "markdown",
            "value": "Function to call when the user requests printing of the document."
          }
        },
        {
          "name": "onbeforeunload",
          "description": {
            "kind": "markdown",
            "value": "Function to call when the document is about to be unloaded."
          }
        },
        {
          "name": "onhashchange",
          "description": {
            "kind": "markdown",
            "value": "Function to call when the fragment identifier part (starting with the hash (`'#'`) character) of the document's current address has changed."
          }
        },
        {
          "name": "onlanguagechange",
          "description": {
            "kind": "markdown",
            "value": "Function to call when the preferred languages changed."
          }
        },
        {
          "name": "onmessage",
          "description": {
            "kind": "markdown",
            "value": "Function to call when the document has received a message."
          }
        },
        {
          "name": "onoffline",
          "description": {
            "kind": "markdown",
            "value": "Function to call when network communication has failed."
          }
        },
        {
          "name": "ononline",
          "description": {
            "kind": "markdown",
            "value": "Function to call when network communication has been restored."
          }
        },
        {
          "name": "onpagehide"
        },
        {
          "name": "onpageshow"
        },
        {
          "name": "onpopstate",
          "description": {
            "kind": "markdown",
            "value": "Function to call when the user has navigated session history."
          }
        },
        {
          "name": "onstorage",
          "description": {
            "kind": "markdown",
            "value": "Function to call when the storage area has changed."
          }
        },
        {
          "name": "onunload",
          "description": {
            "kind": "markdown",
            "value": "Function to call when the document is going away."
          }
        },
        {
          "name": "alink",
          "description": 'Color of text for hyperlinks when selected. _This method is non-conforming, use CSS [`color`](https://developer.mozilla.org/en-US/docs/Web/CSS/color "The color CSS property sets the foreground color value of an element\'s text and text decorations, and sets the currentcolor value.") property in conjunction with the [`:active`](https://developer.mozilla.org/en-US/docs/Web/CSS/:active "The :active CSS pseudo-class represents an element (such as a button) that is being activated by the user.") pseudo-class instead._',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "background",
          "description": 'URI of a image to use as a background. _This method is non-conforming, use CSS [`background`](https://developer.mozilla.org/en-US/docs/Web/CSS/background "The background shorthand CSS property sets all background style properties at once, such as color, image, origin and size, or repeat method.") property on the element instead._',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "bgcolor",
          "description": 'Background color for the document. _This method is non-conforming, use CSS [`background-color`](https://developer.mozilla.org/en-US/docs/Web/CSS/background-color "The background-color CSS property sets the background color of an element.") property on the element instead._',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "bottommargin",
          "description": 'The margin of the bottom of the body. _This method is non-conforming, use CSS [`margin-bottom`](https://developer.mozilla.org/en-US/docs/Web/CSS/margin-bottom "The margin-bottom CSS property sets the margin area on the bottom of an element. A positive value places it farther from its neighbors, while a negative value places it closer.") property on the element instead._',
          "browsers": [
            "C1",
            "CA18",
            "E79",
            "FF35",
            "FFA35",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "leftmargin",
          "description": 'The margin of the left of the body. _This method is non-conforming, use CSS [`margin-left`](https://developer.mozilla.org/en-US/docs/Web/CSS/margin-left "The margin-left CSS property sets the margin area on the left side of an element. A positive value places it farther from its neighbors, while a negative value places it closer.") property on the element instead._',
          "browsers": [
            "C1",
            "CA18",
            "E79",
            "FF35",
            "FFA35",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "link",
          "description": 'Color of text for unvisited hypertext links. _This method is non-conforming, use CSS [`color`](https://developer.mozilla.org/en-US/docs/Web/CSS/color "The color CSS property sets the foreground color value of an element\'s text and text decorations, and sets the currentcolor value.") property in conjunction with the [`:link`](https://developer.mozilla.org/en-US/docs/Web/CSS/:link "The :link CSS pseudo-class represents an element that has not yet been visited. It matches every unvisited <a>, <area>, or <link> element that has an href attribute.") pseudo-class instead._',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "onblur",
          "description": "Function to call when the document loses focus."
        },
        {
          "name": "onerror",
          "description": "Function to call when the document fails to load properly."
        },
        {
          "name": "onfocus",
          "description": "Function to call when the document receives focus."
        },
        {
          "name": "onload",
          "description": "Function to call when the document has finished loading."
        },
        {
          "name": "onredo",
          "description": "Function to call when the user has moved forward in undo transaction history."
        },
        {
          "name": "onresize",
          "description": "Function to call when the document has been resized."
        },
        {
          "name": "onundo",
          "description": "Function to call when the user has moved backward in undo transaction history."
        },
        {
          "name": "rightmargin",
          "description": 'The margin of the right of the body. _This method is non-conforming, use CSS [`margin-right`](https://developer.mozilla.org/en-US/docs/Web/CSS/margin-right "The margin-right CSS property sets the margin area on the right side of an element. A positive value places it farther from its neighbors, while a negative value places it closer.") property on the element instead._',
          "browsers": [
            "C1",
            "CA18",
            "E79",
            "FF35",
            "FFA35",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "text",
          "description": 'Foreground color of text. _This method is non-conforming, use CSS [`color`](https://developer.mozilla.org/en-US/docs/Web/CSS/color "The color CSS property sets the foreground color value of an element\'s text and text decorations, and sets the currentcolor value.") property on the element instead._',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "topmargin",
          "description": 'The margin of the top of the body. _This method is non-conforming, use CSS [`margin-top`](https://developer.mozilla.org/en-US/docs/Web/CSS/margin-top "The margin-top CSS property sets the margin area on the top of an element. A positive value places it farther from its neighbors, while a negative value places it closer.") property on the element instead._',
          "browsers": [
            "C1",
            "CA18",
            "E79",
            "FF35",
            "FFA35",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "vlink",
          "description": 'Color of text for visited hypertext links. _This method is non-conforming, use CSS [`color`](https://developer.mozilla.org/en-US/docs/Web/CSS/color "The color CSS property sets the foreground color value of an element\'s text and text decorations, and sets the currentcolor value.") property in conjunction with the [`:visited`](https://developer.mozilla.org/en-US/docs/Web/CSS/:visited "The :visited CSS pseudo-class represents links that the user has already visited. For privacy reasons, the styles that can be modified using this selector are very limited.") pseudo-class instead._',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/body"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "article",
      "description": {
        "kind": "markdown",
        "value": "The article element represents a complete, or self-contained, composition in a document, page, application, or site and that is, in principle, independently distributable or reusable, e.g. in syndication. This could be a forum post, a magazine or newspaper article, a blog entry, a user-submitted comment, an interactive widget or gadget, or any other independent item of content. Each article should be identified, typically by including a heading (h1\u2013h6 element) as a child of the article element."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/article"
        }
      ],
      "browsers": [
        "C5",
        "CA18",
        "E12",
        "FF4",
        "FFA4",
        "S5",
        "SM4.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "section",
      "description": {
        "kind": "markdown",
        "value": "The section element represents a generic section of a document or application. A section, in this context, is a thematic grouping of content. Each section should be identified, typically by including a heading ( h1- h6 element) as a child of the section element."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/section"
        }
      ],
      "browsers": [
        "C5",
        "CA18",
        "E12",
        "FF4",
        "FFA4",
        "S5",
        "SM4.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "nav",
      "description": {
        "kind": "markdown",
        "value": "The nav element represents a section of a page that links to other pages or to parts within the page: a section with navigation links."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/nav"
        }
      ],
      "browsers": [
        "C5",
        "CA18",
        "E12",
        "FF4",
        "FFA4",
        "S5",
        "SM4.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "aside",
      "description": {
        "kind": "markdown",
        "value": "The aside element represents a section of a page that consists of content that is tangentially related to the content around the aside element, and which could be considered separate from that content. Such sections are often represented as sidebars in printed typography."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/aside"
        }
      ],
      "browsers": [
        "C5",
        "CA18",
        "E12",
        "FF4",
        "FFA4",
        "S5",
        "SM4.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "h1",
      "description": {
        "kind": "markdown",
        "value": "The h1 element represents a section heading."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/Heading_Elements"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "h2",
      "description": {
        "kind": "markdown",
        "value": "The h2 element represents a section heading."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/Heading_Elements"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "h3",
      "description": {
        "kind": "markdown",
        "value": "The h3 element represents a section heading."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/Heading_Elements"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "h4",
      "description": {
        "kind": "markdown",
        "value": "The h4 element represents a section heading."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/Heading_Elements"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "h5",
      "description": {
        "kind": "markdown",
        "value": "The h5 element represents a section heading."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/Heading_Elements"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "h6",
      "description": {
        "kind": "markdown",
        "value": "The h6 element represents a section heading."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/Heading_Elements"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "header",
      "description": {
        "kind": "markdown",
        "value": "The header element represents introductory content for its nearest ancestor sectioning content or sectioning root element. A header typically contains a group of introductory or navigational aids. When the nearest ancestor sectioning content or sectioning root element is the body element, then it applies to the whole page."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/header"
        }
      ],
      "browsers": [
        "C5",
        "CA18",
        "E12",
        "FF4",
        "FFA4",
        "S5",
        "SM4.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "footer",
      "description": {
        "kind": "markdown",
        "value": "The footer element represents a footer for its nearest ancestor sectioning content or sectioning root element. A footer typically contains information about its section such as who wrote it, links to related documents, copyright data, and the like."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/footer"
        }
      ],
      "browsers": [
        "C5",
        "CA18",
        "E12",
        "FF4",
        "FFA4",
        "S5",
        "SM4.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "address",
      "description": {
        "kind": "markdown",
        "value": "The address element represents the contact information for its nearest article or body element ancestor. If that is the body element, then the contact information applies to the document as a whole."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/address"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "p",
      "description": {
        "kind": "markdown",
        "value": "The p element represents a paragraph."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/p"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "hr",
      "description": {
        "kind": "markdown",
        "value": "The hr element represents a paragraph-level thematic break, e.g. a scene change in a story, or a transition to another topic within a section of a reference book."
      },
      "void": true,
      "attributes": [
        {
          "name": "align",
          "description": "Sets the alignment of the rule on the page. If no value is specified, the default value is `left`.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "color",
          "description": "Sets the color of the rule through color name or hexadecimal value.",
          "browsers": [
            "C33",
            "CA33",
            "E12",
            "FF1",
            "FFA4",
            "S10.1",
            "SM10.3"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "noshade",
          "description": "Sets the rule to have no shading.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "size",
          "description": "Sets the height, in pixels, of the rule.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "width",
          "description": "Sets the length of the rule on the page through a pixel or percentage value.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/hr"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S3",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "pre",
      "description": {
        "kind": "markdown",
        "value": "The pre element represents a block of preformatted text, in which structure is represented by typographic conventions rather than by elements."
      },
      "attributes": [
        {
          "name": "cols",
          "description": 'Contains the _preferred_ count of characters that a line should have. It was a non-standard synonym of [`width`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/pre#attr-width). To achieve such an effect, use CSS [`width`](https://developer.mozilla.org/en-US/docs/Web/CSS/width "The width CSS property sets an element\'s width. By default it sets the width of the content area, but if box-sizing is set to border-box, it sets the width of the border area.") instead.'
        },
        {
          "name": "width",
          "description": 'Contains the _preferred_ count of characters that a line should have. Though technically still implemented, this attribute has no visual effect; to achieve such an effect, use CSS [`width`](https://developer.mozilla.org/en-US/docs/Web/CSS/width "The width CSS property sets an element\'s width. By default it sets the width of the content area, but if box-sizing is set to border-box, it sets the width of the border area.") instead.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "wrap",
          "description": 'Is a _hint_ indicating how the overflow must happen. In modern browser this hint is ignored and no visual effect results in its present; to achieve such an effect, use CSS [`white-space`](https://developer.mozilla.org/en-US/docs/Web/CSS/white-space "The white-space CSS property sets how white space inside an element is handled.") instead.'
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/pre"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "blockquote",
      "description": {
        "kind": "markdown",
        "value": "The blockquote element represents content that is quoted from another source, optionally with a citation which must be within a footer or cite element, and optionally with in-line changes such as annotations and abbreviations."
      },
      "attributes": [
        {
          "name": "cite",
          "description": {
            "kind": "markdown",
            "value": "A URL that designates a source document or message for the information quoted. This attribute is intended to point to information explaining the context or the reference for the quote."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/blockquote"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "ol",
      "description": {
        "kind": "markdown",
        "value": "The ol element represents a list of items, where the items have been intentionally ordered, such that changing the order would change the meaning of the document."
      },
      "attributes": [
        {
          "name": "reversed",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "This Boolean attribute specifies that the items of the list are specified in reversed order."
          },
          "browsers": [
            "C18",
            "CA18",
            "E79",
            "FF18",
            "FFA18",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-01-15",
            "baseline_high_date": "2022-07-15"
          }
        },
        {
          "name": "start",
          "description": {
            "kind": "markdown",
            "value": 'This integer attribute specifies the start value for numbering the individual list items. Although the ordering type of list elements might be Roman numerals, such as XXXI, or letters, the value of start is always represented as a number. To start numbering elements from the letter "C", use `<ol start="3">`.\n\n**Note**: This attribute was deprecated in HTML4, but reintroduced in HTML5.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "type",
          "valueSet": "lt",
          "description": {
            "kind": "markdown",
            "value": "Indicates the numbering type:\n\n*   `'a'` indicates lowercase letters,\n*   `'A'` indicates uppercase letters,\n*   `'i'` indicates lowercase Roman numerals,\n*   `'I'` indicates uppercase Roman numerals,\n*   and `'1'` indicates numbers (default).\n\nThe type set is used for the entire list unless a different [`type`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/li#attr-type) attribute is used within an enclosed [`<li>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/li \"The HTML <li> element is used to represent an item in a list. It must be contained in a parent element: an ordered list (<ol>), an unordered list (<ul>), or a menu (<menu>). In menus and unordered lists, list items are usually displayed using bullet points. In ordered lists, they are usually displayed with an ascending counter on the left, such as a number or letter.\") element.\n\n**Note:** This attribute was deprecated in HTML4, but reintroduced in HTML5.\n\nUnless the value of the list number matters (e.g. in legal or technical documents where items are to be referenced by their number/letter), the CSS [`list-style-type`](https://developer.mozilla.org/en-US/docs/Web/CSS/list-style-type \"The list-style-type CSS property sets the marker (such as a disc, character, or custom counter style) of a list item element.\") property should be used instead."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "compact",
          "description": 'This Boolean attribute hints that the list should be rendered in a compact style. The interpretation of this attribute depends on the user agent and it doesn\'t work in all browsers.\n\n**Warning:** Do not use this attribute, as it has been deprecated: the [`<ol>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ol "The HTML <ol> element represents an ordered list of items, typically rendered as a numbered list.") element should be styled using [CSS](https://developer.mozilla.org/en-US/docs/CSS). To give an effect similar to the `compact` attribute, the [CSS](https://developer.mozilla.org/en-US/docs/CSS) property [`line-height`](https://developer.mozilla.org/en-US/docs/Web/CSS/line-height "The line-height CSS property sets the amount of space used for lines, such as in text. On block-level elements, it specifies the minimum height of line boxes within the element. On non-replaced inline elements, it specifies the height that is used to calculate line box height.") can be used with a value of `80%`.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/ol"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "ul",
      "description": {
        "kind": "markdown",
        "value": "The ul element represents a list of items, where the order of the items is not important \u2014 that is, where changing the order would not materially change the meaning of the document."
      },
      "attributes": [
        {
          "name": "compact",
          "description": 'This Boolean attribute hints that the list should be rendered in a compact style. The interpretation of this attribute depends on the user agent and it doesn\'t work in all browsers.\n\n**Usage note:\xA0**Do not use this attribute, as it has been deprecated: the [`<ul>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ul "The HTML <ul> element represents an unordered list of items, typically rendered as a bulleted list.") element should be styled using [CSS](https://developer.mozilla.org/en-US/docs/CSS). To give a similar effect as the `compact` attribute, the [CSS](https://developer.mozilla.org/en-US/docs/CSS) property [line-height](https://developer.mozilla.org/en-US/docs/CSS/line-height) can be used with a value of `80%`.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/ul"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "li",
      "description": {
        "kind": "markdown",
        "value": "The li element represents a list item. If its parent element is an ol, ul, or menu element, then the element is an item of the parent element's list, as defined for those elements. Otherwise, the list item has no defined list-related relationship to any other li element."
      },
      "attributes": [
        {
          "name": "value",
          "description": {
            "kind": "markdown",
            "value": 'This integer attribute indicates the current ordinal value of the list item as defined by the [`<ol>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ol "The HTML <ol> element represents an ordered list of items, typically rendered as a numbered list.") element. The only allowed value for this attribute is a number, even if the list is displayed with Roman numerals or letters. List items that follow this one continue numbering from the value set. The **value** attribute has no meaning for unordered lists ([`<ul>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ul "The HTML <ul> element represents an unordered list of items, typically rendered as a bulleted list.")) or for menus ([`<menu>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/menu "The HTML <menu> element represents a group of commands that a user can perform or activate. This includes both list menus, which might appear across the top of a screen, as well as context menus, such as those that might appear underneath a button after it has been clicked.")).\n\n**Note**: This attribute was deprecated in HTML4, but reintroduced in HTML5.\n\n**Note:** Prior to Gecko\xA09.0, negative values were incorrectly converted to 0. Starting in Gecko\xA09.0 all integer values are correctly parsed.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "type",
          "description": 'This character attribute indicates the numbering type:\n\n*   `a`: lowercase letters\n*   `A`: uppercase letters\n*   `i`: lowercase Roman numerals\n*   `I`: uppercase Roman numerals\n*   `1`: numbers\n\nThis type overrides the one used by its parent [`<ol>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ol "The HTML <ol> element represents an ordered list of items, typically rendered as a numbered list.") element, if any.\n\n**Usage note:** This attribute has been deprecated: use the CSS [`list-style-type`](https://developer.mozilla.org/en-US/docs/Web/CSS/list-style-type "The list-style-type CSS property sets the marker (such as a disc, character, or custom counter style) of a list item element.") property instead.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/li"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S3",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "dl",
      "description": {
        "kind": "markdown",
        "value": "The dl element represents an association list consisting of zero or more name-value groups (a description list). A name-value group consists of one or more names (dt elements) followed by one or more values (dd elements), ignoring any nodes other than dt and dd elements. Within a single dl element, there should not be more than one dt element for each name."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/dl"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "dt",
      "description": {
        "kind": "markdown",
        "value": "The dt element represents the term, or name, part of a term-description group in a description list (dl element)."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/dt"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "dd",
      "description": {
        "kind": "markdown",
        "value": "The dd element represents the description, definition, or value, part of a term-description group in a description list (dl element)."
      },
      "attributes": [
        {
          "name": "nowrap",
          "description": "If the value of this attribute is set to `yes`, the definition text will not wrap. The default value is `no`."
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/dd"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "figure",
      "description": {
        "kind": "markdown",
        "value": "The figure element represents some flow content, optionally with a caption, that is self-contained (like a complete sentence) and is typically referenced as a single unit from the main flow of the document."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/figure"
        }
      ],
      "browsers": [
        "C8",
        "CA18",
        "E12",
        "FF4",
        "FFA4",
        "S5.1",
        "SM5"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "figcaption",
      "description": {
        "kind": "markdown",
        "value": "The figcaption element represents a caption or legend for the rest of the contents of the figcaption element's parent figure element, if any."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/figcaption"
        }
      ],
      "browsers": [
        "C8",
        "CA18",
        "E12",
        "FF4",
        "FFA4",
        "S5.1",
        "SM5"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "main",
      "description": {
        "kind": "markdown",
        "value": "The main element represents the main content of the body of a document or application. The main content area consists of content that is directly related to or expands upon the central topic of a document or central functionality of an application."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/main"
        }
      ],
      "browsers": [
        "C26",
        "CA26",
        "E12",
        "FF21",
        "FFA21",
        "S7",
        "SM7"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "div",
      "description": {
        "kind": "markdown",
        "value": "The div element has no special meaning at all. It represents its children. It can be used with the class, lang, and title attributes to mark up semantics common to a group of consecutive elements."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/div"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "a",
      "description": {
        "kind": "markdown",
        "value": "If the a element has an href attribute, then it represents a hyperlink (a hypertext anchor) labeled by its contents."
      },
      "attributes": [
        {
          "name": "href",
          "description": {
            "kind": "markdown",
            "value": 'Contains a URL or a URL fragment that the hyperlink points to.\nA URL fragment is a name preceded by a hash mark (`#`), which specifies an internal target location (an [`id`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes#attr-id) of an HTML element) within the current document. URLs are not restricted to Web (HTTP)-based documents, but can use any protocol supported by the browser. For example, [`file:`](https://en.wikipedia.org/wiki/File_URI_scheme), `ftp:`, and `mailto:` work in most browsers.\n\n**Note:** You can use `href="#top"` or the empty fragment `href="#"` to link to the top of the current page. [This behavior is specified by HTML5](https://www.w3.org/TR/html5/single-page.html#scroll-to-fragid).'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "target",
          "valueSet": "target",
          "description": {
            "kind": "markdown",
            "value": 'Specifies where to display the linked URL. It is a name of, or keyword for, a _browsing context_: a tab, window, or `<iframe>`. The following keywords have special meanings:\n\n*   `_self`: Load the URL into the same browsing context as the current one. This is the default behavior.\n*   `_blank`: Load the URL into a new browsing context. This is usually a tab, but users can configure browsers to use new windows instead.\n*   `_parent`: Load the URL into the parent browsing context of the current one. If there is no parent, this behaves the same way as `_self`.\n*   `_top`: Load the URL into the top-level browsing context (that is, the "highest" browsing context that is an ancestor of the current one, and has no parent). If there is no parent, this behaves the same way as `_self`.\n\n**Note:** When using `target`, consider adding `rel="noreferrer"` to avoid exploitation of the `window.opener` API.\n\n**Note:** Linking to another page using `target="_blank"` will run the new page on the same process as your page. If the new page is executing expensive JS, your page\'s performance may suffer. To avoid this use `rel="noopener"`.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "download",
          "description": {
            "kind": "markdown",
            "value": "This attribute instructs browsers to download a URL instead of navigating to it, so the user will be prompted to save it as a local file. If the attribute has a value, it is used as the pre-filled file name in the Save prompt (the user can still change the file name if they want). There are no restrictions on allowed values, though `/` and `\\` are converted to underscores. Most file systems limit some punctuation in file names, and browsers will adjust the suggested name accordingly.\n\n**Notes:**\n\n*   This attribute only works for [same-origin URLs](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy).\n*   Although HTTP(s) URLs need to be in the same-origin, [`blob:` URLs](https://developer.mozilla.org/en-US/docs/Web/API/URL.createObjectURL) and [`data:` URLs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs) are allowed so that content generated by JavaScript, such as pictures created in an image-editor Web app, can be downloaded.\n*   If the HTTP header [`Content-Disposition:`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition) gives a different filename than this attribute, the HTTP header takes priority over this attribute.\n*   If `Content-Disposition:` is set to `inline`, Firefox prioritizes `Content-Disposition`, like the filename case, while Chrome prioritizes the `download` attribute."
          },
          "browsers": [
            "C14",
            "CA18",
            "E18",
            "FF20",
            "FFA20",
            "S10.1",
            "SM13"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2019-09-19",
            "baseline_high_date": "2022-03-19"
          }
        },
        {
          "name": "ping",
          "description": {
            "kind": "markdown",
            "value": 'Contains a space-separated list of URLs to which, when the hyperlink is followed, [`POST`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/POST "The HTTP POST method sends data to the server. The type of the body of the request is indicated by the Content-Type header.") requests with the body `PING` will be sent by the browser (in the background). Typically used for tracking.'
          },
          "browsers": [
            "C12",
            "CA18",
            "E17",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "rel",
          "description": {
            "kind": "markdown",
            "value": "Specifies the relationship of the target object to the link object. The value is a space-separated list of [link types](https://developer.mozilla.org/en-US/docs/Web/HTML/Link_types)."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "hreflang",
          "description": {
            "kind": "markdown",
            "value": 'This attribute indicates the human language of the linked resource. It is purely advisory, with no built-in functionality. Allowed values are determined by [BCP47](https://www.ietf.org/rfc/bcp/bcp47.txt "Tags for Identifying Languages").'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "type",
          "description": {
            "kind": "markdown",
            "value": 'Specifies the media type in the form of a [MIME type](https://developer.mozilla.org/en-US/docs/Glossary/MIME_type "MIME type: A\xA0MIME type\xA0(now properly called "media type", but\xA0also sometimes "content type") is a string sent along\xA0with a file indicating the type of the file (describing the content format, for example, a sound file might be labeled\xA0audio/ogg, or an image file\xA0image/png).") for the linked URL. It is purely advisory, with no built-in functionality.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "referrerpolicy",
          "description": "Indicates which [referrer](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referer) to send when fetching the URL:\n\n*   `'no-referrer'` means the `Referer:` header will not be sent.\n*   `'no-referrer-when-downgrade'` means no `Referer:` header will be sent when navigating to an origin without HTTPS. This is the default behavior.\n*   `'origin'` means the referrer will be the [origin](https://developer.mozilla.org/en-US/docs/Glossary/Origin) of the page, not including information after the domain.\n*   `'origin-when-cross-origin'` meaning that navigations to other origins will be limited to the scheme, the host and the port, while navigations on the same origin will include the referrer's path.\n*   `'strict-origin-when-cross-origin'`\n*   `'unsafe-url'` means the referrer will include the origin and path, but not the fragment, password, or username. This is unsafe because it can leak data from secure URLs to insecure ones.",
          "browsers": [
            "C51",
            "CA51",
            "E79",
            "FF50",
            "FFA50",
            "S14",
            "SM14"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-09-16",
            "baseline_high_date": "2023-03-16"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/a"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "em",
      "description": {
        "kind": "markdown",
        "value": "The em element represents stress emphasis of its contents."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/em"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "strong",
      "description": {
        "kind": "markdown",
        "value": "The strong element represents strong importance, seriousness, or urgency for its contents."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/strong"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "small",
      "description": {
        "kind": "markdown",
        "value": "The small element represents side comments such as small print."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/small"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "s",
      "description": {
        "kind": "markdown",
        "value": "The s element represents contents that are no longer accurate or no longer relevant."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/s"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "cite",
      "description": {
        "kind": "markdown",
        "value": "The cite element represents a reference to a creative work. It must include the title of the work or the name of the author(person, people or organization) or an URL reference, or a reference in abbreviated form as per the conventions used for the addition of citation metadata."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/cite"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "q",
      "description": {
        "kind": "markdown",
        "value": "The q element represents some phrasing content quoted from another source."
      },
      "attributes": [
        {
          "name": "cite",
          "description": {
            "kind": "markdown",
            "value": "The value of this attribute is a URL that designates a source document or message for the information quoted. This attribute is intended to point to information explaining the context or the reference for the quote."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/q"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S3",
        "SM2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "dfn",
      "description": {
        "kind": "markdown",
        "value": "The dfn element represents the defining instance of a term. The paragraph, description list group, or section that is the nearest ancestor of the dfn element must also contain the definition(s) for the term given by the dfn element."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/dfn"
        }
      ],
      "browsers": [
        "C15",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S6",
        "SM6"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "abbr",
      "description": {
        "kind": "markdown",
        "value": "The abbr element represents an abbreviation or acronym, optionally with its expansion. The title attribute may be used to provide an expansion of the abbreviation. The attribute, if specified, must contain an expansion of the abbreviation, and nothing else."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/abbr"
        }
      ],
      "browsers": [
        "C2",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "ruby",
      "description": {
        "kind": "markdown",
        "value": "The ruby element allows one or more spans of phrasing content to be marked with ruby annotations. Ruby annotations are short runs of text presented alongside base text, primarily used in East Asian typography as a guide for pronunciation or to include other annotations. In Japanese, this form of typography is also known as furigana. Ruby text can appear on either side, and sometimes both sides, of the base text, and it is possible to control its position using CSS. A more complete introduction to ruby can be found in the Use Cases & Exploratory Approaches for Ruby Markup document as well as in CSS Ruby Module Level 1. [RUBY-UC] [CSSRUBY]"
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/ruby"
        }
      ],
      "browsers": [
        "C5",
        "CA18",
        "E12",
        "FF38",
        "FFA38",
        "S5",
        "SM4.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "rb",
      "description": {
        "kind": "markdown",
        "value": "The rb element marks the base text component of a ruby annotation. When it is the child of a ruby element, it doesn't represent anything itself, but its parent ruby element uses it as part of determining what it represents."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/rb"
        }
      ]
    },
    {
      "name": "rt",
      "description": {
        "kind": "markdown",
        "value": "The rt element marks the ruby text component of a ruby annotation. When it is the child of a ruby element or of an rtc element that is itself the child of a ruby element, it doesn't represent anything itself, but its ancestor ruby element uses it as part of determining what it represents."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/rt"
        }
      ],
      "browsers": [
        "C5",
        "CA18",
        "E12",
        "FF38",
        "FFA38",
        "S5",
        "SM4.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "rp",
      "description": {
        "kind": "markdown",
        "value": "The rp element is used to provide fallback text to be shown by user agents that don't support ruby annotations. One widespread convention is to provide parentheses around the ruby text component of a ruby annotation."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/rp"
        }
      ],
      "browsers": [
        "C5",
        "CA18",
        "E12",
        "FF38",
        "FFA38",
        "S5",
        "SM4.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "time",
      "description": {
        "kind": "markdown",
        "value": "The time element represents its contents, along with a machine-readable form of those contents in the datetime attribute. The kind of content is limited to various kinds of dates, times, time-zone offsets, and durations, as described below."
      },
      "attributes": [
        {
          "name": "datetime",
          "description": {
            "kind": "markdown",
            "value": "This attribute indicates the time and/or date of the element and must be in one of the formats described below."
          },
          "browsers": [
            "C62",
            "CA62",
            "E14",
            "FF22",
            "FFA22",
            "S7",
            "SM4"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2017-10-24",
            "baseline_high_date": "2020-04-24"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/time"
        }
      ],
      "browsers": [
        "C62",
        "CA62",
        "E14",
        "FF22",
        "FFA22",
        "S7",
        "SM4"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2017-10-24",
        "baseline_high_date": "2020-04-24"
      }
    },
    {
      "name": "code",
      "description": {
        "kind": "markdown",
        "value": "The code element represents a fragment of computer code. This could be an XML element name, a file name, a computer program, or any other string that a computer would recognize."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/code"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "var",
      "description": {
        "kind": "markdown",
        "value": "The var element represents a variable. This could be an actual variable in a mathematical expression or programming context, an identifier representing a constant, a symbol identifying a physical quantity, a function parameter, or just be a term used as a placeholder in prose."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/var"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "samp",
      "description": {
        "kind": "markdown",
        "value": "The samp element represents sample or quoted output from another program or computing system."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/samp"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "kbd",
      "description": {
        "kind": "markdown",
        "value": "The kbd element represents user input (typically keyboard input, although it may also be used to represent other input, such as voice commands)."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/kbd"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "sub",
      "description": {
        "kind": "markdown",
        "value": "The sub element represents a subscript."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/sub"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "sup",
      "description": {
        "kind": "markdown",
        "value": "The sup element represents a superscript."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/sup"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "i",
      "description": {
        "kind": "markdown",
        "value": "The i element represents a span of text in an alternate voice or mood, or otherwise offset from the normal prose in a manner indicating a different quality of text, such as a taxonomic designation, a technical term, an idiomatic phrase from another language, transliteration, a thought, or a ship name in Western texts."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/i"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "b",
      "description": {
        "kind": "markdown",
        "value": "The b element represents a span of text to which attention is being drawn for utilitarian purposes without conveying any extra importance and with no implication of an alternate voice or mood, such as key words in a document abstract, product names in a review, actionable words in interactive text-driven software, or an article lede."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/b"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "u",
      "description": {
        "kind": "markdown",
        "value": "The u element represents a span of text with an unarticulated, though explicitly rendered, non-textual annotation, such as labeling the text as being a proper name in Chinese text (a Chinese proper name mark), or labeling the text as being misspelt."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/u"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "mark",
      "description": {
        "kind": "markdown",
        "value": "The mark element represents a run of text in one document marked or highlighted for reference purposes, due to its relevance in another context. When used in a quotation or other block of text referred to from the prose, it indicates a highlight that was not originally present but which has been added to bring the reader's attention to a part of the text that might not have been considered important by the original author when the block was originally written, but which is now under previously unexpected scrutiny. When used in the main prose of a document, it indicates a part of the document that has been highlighted due to its likely relevance to the user's current activity."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/mark"
        }
      ],
      "browsers": [
        "C7",
        "CA18",
        "E12",
        "FF4",
        "FFA4",
        "S5.1",
        "SM5"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "bdi",
      "description": {
        "kind": "markdown",
        "value": "The bdi element represents a span of text that is to be isolated from its surroundings for the purposes of bidirectional text formatting. [BIDI]"
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/bdi"
        }
      ],
      "browsers": [
        "C16",
        "CA18",
        "E79",
        "FF10",
        "FFA10",
        "S6",
        "SM6"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2020-01-15",
        "baseline_high_date": "2022-07-15"
      }
    },
    {
      "name": "bdo",
      "description": {
        "kind": "markdown",
        "value": "The bdo element represents explicit text directionality formatting control for its children. It allows authors to override the Unicode bidirectional algorithm by explicitly specifying a direction override. [BIDI]"
      },
      "attributes": [
        {
          "name": "dir",
          "description": "The direction in which text should be rendered in this element's contents. Possible values are:\n\n*   `ltr`: Indicates that the text should go in a left-to-right direction.\n*   `rtl`: Indicates that the text should go in a right-to-left direction."
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/bdo"
        }
      ],
      "browsers": [
        "C15",
        "CA18",
        "E12",
        "FF10",
        "FFA10",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "span",
      "description": {
        "kind": "markdown",
        "value": "The span element doesn't mean anything on its own, but can be useful when used together with the global attributes, e.g. class, lang, or dir. It represents its children."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/span"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "br",
      "description": {
        "kind": "markdown",
        "value": "The br element represents a line break."
      },
      "void": true,
      "attributes": [
        {
          "name": "clear",
          "description": "Indicates where to begin the next line after the break.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/br"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "wbr",
      "description": {
        "kind": "markdown",
        "value": "The wbr element represents a line break opportunity."
      },
      "void": true,
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/wbr"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "ins",
      "description": {
        "kind": "markdown",
        "value": "The ins element represents an addition to the document."
      },
      "attributes": [
        {
          "name": "cite",
          "description": "This attribute defines the URI of a resource that explains the change, such as a link to meeting minutes or a ticket in a troubleshooting system.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "datetime",
          "description": 'This attribute indicates the time and date of the change and must be a valid date with an optional time string. If the value cannot be parsed as a date with an optional time string, the element does not have an associated time stamp. For the format of the string without a time, see [Format of a valid date string](https://developer.mozilla.org/en-US/docs/Web/HTML/Date_and_time_formats#Format_of_a_valid_date_string "Certain HTML elements use date and/or time values. The formats of the strings that specify these are described in this article.") in [Date and time formats used in HTML](https://developer.mozilla.org/en-US/docs/Web/HTML/Date_and_time_formats "Certain HTML elements use date and/or time values. The formats of the strings that specify these are described in this article."). The format of the string if it includes both date and time is covered in [Format of a valid local date and time string](https://developer.mozilla.org/en-US/docs/Web/HTML/Date_and_time_formats#Format_of_a_valid_local_date_and_time_string "Certain HTML elements use date and/or time values. The formats of the strings that specify these are described in this article.") in [Date and time formats used in HTML](https://developer.mozilla.org/en-US/docs/Web/HTML/Date_and_time_formats "Certain HTML elements use date and/or time values. The formats of the strings that specify these are described in this article.").',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/ins"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "del",
      "description": {
        "kind": "markdown",
        "value": "The del element represents a removal from the document."
      },
      "attributes": [
        {
          "name": "cite",
          "description": {
            "kind": "markdown",
            "value": "A URI for a resource that explains the change (for example, meeting minutes)."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "datetime",
          "description": {
            "kind": "markdown",
            "value": 'This attribute indicates the time and date of the change and must be a valid date string with an optional time. If the value cannot be parsed as a date with an optional time string, the element does not have an associated time stamp. For the format of the string without a time, see [Format of a valid date string](https://developer.mozilla.org/en-US/docs/Web/HTML/Date_and_time_formats#Format_of_a_valid_date_string "Certain HTML elements use date and/or time values. The formats of the strings that specify these are described in this article.") in [Date and time formats used in HTML](https://developer.mozilla.org/en-US/docs/Web/HTML/Date_and_time_formats "Certain HTML elements use date and/or time values. The formats of the strings that specify these are described in this article."). The format of the string if it includes both date and time is covered in [Format of a valid local date and time string](https://developer.mozilla.org/en-US/docs/Web/HTML/Date_and_time_formats#Format_of_a_valid_local_date_and_time_string "Certain HTML elements use date and/or time values. The formats of the strings that specify these are described in this article.") in [Date and time formats used in HTML](https://developer.mozilla.org/en-US/docs/Web/HTML/Date_and_time_formats "Certain HTML elements use date and/or time values. The formats of the strings that specify these are described in this article.").'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/del"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "picture",
      "description": {
        "kind": "markdown",
        "value": "The picture element is a container which provides multiple sources to its contained img element to allow authors to declaratively control or give hints to the user agent about which image resource to use, based on the screen pixel density, viewport size, image format, and other factors. It represents its children."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/picture"
        }
      ],
      "browsers": [
        "C38",
        "CA38",
        "E13",
        "FF38",
        "FFA38",
        "S9.1",
        "SM9.3"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2016-03-21",
        "baseline_high_date": "2018-09-21"
      }
    },
    {
      "name": "img",
      "description": {
        "kind": "markdown",
        "value": "An img element represents an image."
      },
      "void": true,
      "attributes": [
        {
          "name": "alt",
          "description": {
            "kind": "markdown",
            "value": 'This attribute defines an alternative text description of the image.\n\n**Note:** Browsers do not always display the image referenced by the element. This is the case for non-graphical browsers (including those used by people with visual impairments), if the user chooses not to display images, or if the browser cannot display the image because it is invalid or an [unsupported type](#Supported_image_formats). In these cases, the browser may replace the image with the text defined in this element\'s `alt` attribute. You should, for these reasons and others, provide a useful value for `alt` whenever possible.\n\n**Note:** Omitting this attribute altogether indicates that the image is a key part of the content, and no textual equivalent is available. Setting this attribute to an empty string (`alt=""`) indicates that this image is _not_ a key part of the content (decorative), and that non-visual browsers may omit it from rendering.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "src",
          "description": {
            "kind": "markdown",
            "value": "The image URL. This attribute is mandatory for the `<img>` element. On browsers supporting `srcset`, `src` is treated like a candidate image with a pixel density descriptor `1x` unless an image with this pixel density descriptor is already defined in `srcset,` or unless `srcset` contains '`w`' descriptors."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "srcset",
          "description": {
            "kind": "markdown",
            "value": "A list of one or more strings separated by commas indicating a set of possible image sources for the user agent to use. Each string is composed of:\n\n1.  a URL to an image,\n2.  optionally, whitespace followed by one of:\n    *   A width descriptor, or a positive integer directly followed by '`w`'. The width descriptor is divided by the source size given in the `sizes` attribute to calculate the effective pixel density.\n    *   A pixel density descriptor, which is a positive floating point number directly followed by '`x`'.\n\nIf no descriptor is specified, the source is assigned the default descriptor: `1x`.\n\nIt is incorrect to mix width descriptors and pixel density descriptors in the same `srcset` attribute. Duplicate descriptors (for instance, two sources in the same `srcset` which are both described with '`2x`') are also invalid.\n\nThe user agent selects any one of the available sources at its discretion. This provides them with significant leeway to tailor their selection based on things like user preferences or bandwidth conditions. See our [Responsive images](https://developer.mozilla.org/en-US/docs/Learn/HTML/Multimedia_and_embedding/Responsive_images) tutorial for an example."
          },
          "browsers": [
            "C34",
            "CA34",
            "E12",
            "FF38",
            "FFA38",
            "S8",
            "SM8"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "crossorigin",
          "valueSet": "xo",
          "description": {
            "kind": "markdown",
            "value": 'This enumerated attribute indicates if the fetching of the related image must be done using CORS or not. [CORS-enabled images](https://developer.mozilla.org/en-US/docs/CORS_Enabled_Image) can be reused in the [`<canvas>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas "Use the HTML <canvas> element with either the canvas scripting API or the WebGL API to draw graphics and animations.") element without being "[tainted](https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_enabled_image#What_is_a_tainted_canvas)." The allowed values are:\n`anonymous`\n\nA cross-origin request (i.e., with `Origin:` HTTP header) is performed, but no credential is sent (i.e., no cookie, X.509 certificate, or HTTP Basic authentication). If the server does not give credentials to the origin site (by not setting the [`Access-Control-Allow-Origin`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Origin "The Access-Control-Allow-Origin response header indicates whether the response can be shared with requesting code from the given origin.") HTTP header), the image will be tainted and its usage restricted.\n\n`use-credentials`\n\nA cross-origin request (i.e., with the [`Origin`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Origin "The Origin request header indicates where a fetch originates from. It doesn\'t include any path information, but only the server name. It is sent with CORS requests, as well as with POST requests. It is similar to the Referer header, but, unlike this header, it doesn\'t disclose the whole path.") HTTP header) performed along with credentials sent (i.e., a cookie, certificate, or HTTP Basic authentication). If the server does not give credentials to the origin site (through the `Access-Control-Allow-Credentials` HTTP header), the image will be tainted and its usage restricted.\n\nIf the attribute is not present, the resource is fetched without a CORS request (i.e., without sending the `Origin` HTTP header), preventing its non-tainted usage in [`<canvas>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas "Use the HTML <canvas> element with either the canvas scripting API or the WebGL API to draw graphics and animations.") elements. If invalid, it is handled as if the `anonymous` value was used. See [CORS settings attributes](https://developer.mozilla.org/en-US/docs/HTML/CORS_settings_attributes) for additional information.'
          },
          "browsers": [
            "C13",
            "CA18",
            "E12",
            "FF8",
            "FFA8",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "usemap",
          "description": {
            "kind": "markdown",
            "value": 'The partial URL (starting with \'#\') of an [image map](https://developer.mozilla.org/en-US/docs/HTML/Element/map) associated with the element.\n\n**Note:** You cannot use this attribute if the `<img>` element is a descendant of an [`<a>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a "The HTML <a> element (or anchor element) creates a hyperlink to other web pages, files, locations within the same page, email addresses, or any other URL.") or [`<button>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button "The HTML <button> element represents a clickable button, which can be used in forms or anywhere in a document that needs simple, standard button functionality.") element.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "ismap",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": 'This Boolean attribute indicates that the image is part of a server-side map. If so, the precise coordinates of a click are sent to the server.\n\n**Note:** This attribute is allowed only if the `<img>` element is a descendant of an [`<a>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a "The HTML <a> element (or anchor element) creates a hyperlink to other web pages, files, locations within the same page, email addresses, or any other URL.") element with a valid [`href`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a#attr-href) attribute.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "width",
          "description": {
            "kind": "markdown",
            "value": "The intrinsic width of the image in pixels."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "height",
          "description": {
            "kind": "markdown",
            "value": "The intrinsic height of the image in pixels."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "decoding",
          "valueSet": "decoding",
          "description": {
            "kind": "markdown",
            "value": "Provides an image decoding hint to the browser. The allowed values are:\n`sync`\n\nDecode the image synchronously for atomic presentation with other content.\n\n`async`\n\nDecode the image asynchronously to reduce delay in presenting other content.\n\n`auto`\n\nDefault mode, which indicates no preference for the decoding mode. The browser decides what is best for the user."
          },
          "browsers": [
            "C65",
            "CA65",
            "E79",
            "FF63",
            "FFA63",
            "S11.1",
            "SM11.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-01-15",
            "baseline_high_date": "2022-07-15"
          }
        },
        {
          "name": "loading",
          "valueSet": "loading",
          "description": {
            "kind": "markdown",
            "value": "Indicates how the browser should load the image."
          },
          "browsers": [
            "C77",
            "CA77",
            "E79",
            "FF75",
            "FFA79",
            "S15.4",
            "SM15.4"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2022-03-14",
            "baseline_high_date": "2024-09-14"
          }
        },
        {
          "name": "fetchpriority",
          "valueSet": "fetchpriority",
          "description": {
            "kind": "markdown",
            "value": "Provides a hint of the relative priority to use when fetching the image."
          },
          "browsers": [
            "C101",
            "CA101",
            "E101",
            "FF132",
            "FFA132",
            "S17.2",
            "SM17.2"
          ],
          "status": {
            "baseline": "low",
            "baseline_low_date": "2024-10-29"
          }
        },
        {
          "name": "referrerpolicy",
          "valueSet": "referrerpolicy",
          "description": {
            "kind": "markdown",
            "value": "A string indicating which referrer to use when fetching the resource:\n\n*   `no-referrer:` The [`Referer`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referer \"The Referer request header contains the address of the previous web page from which a link to the currently requested page was followed. The Referer header allows servers to identify where people are visiting them from and may use that data for analytics, logging, or optimized caching, for example.\") header will not be sent.\n*   `no-referrer-when-downgrade:` No `Referer` header will be sent when navigating to an origin without TLS (HTTPS). This is a user agent\u2019s default behavior if no policy is otherwise specified.\n*   `origin:` The `Referer` header will include the page of origin's scheme, the host, and the port.\n*   `origin-when-cross-origin:` Navigating to other origins will limit the included referral data to the scheme, the host and the port, while navigating from the same origin will include the referrer's full path.\n*   `unsafe-url:` The `Referer` header will include the origin and the path, but not the fragment, password, or username. This case is unsafe because it can leak origins and paths from TLS-protected resources to insecure origins."
          },
          "browsers": [
            "C51",
            "CA51",
            "E79",
            "FF50",
            "FFA50",
            "S14",
            "SM14"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-09-16",
            "baseline_high_date": "2023-03-16"
          }
        },
        {
          "name": "sizes",
          "description": {
            "kind": "markdown",
            "value": "A list of one or more strings separated by commas indicating a set of source sizes. Each source size consists of:\n\n1.  a media condition. This must be omitted for the last item.\n2.  a source size value.\n\nSource size values specify the intended display size of the image. User agents use the current source size to select one of the sources supplied by the `srcset` attribute, when those sources are described using width ('`w`') descriptors. The selected source size affects the intrinsic size of the image (the image\u2019s display size if no CSS styling is applied). If the `srcset` attribute is absent, or contains no values with a width (`w`) descriptor, then the `sizes` attribute has no effect."
          },
          "browsers": [
            "C38",
            "CA38",
            "E12",
            "FF38",
            "FFA38",
            "S9.1",
            "SM9.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2016-03-21",
            "baseline_high_date": "2018-09-21"
          }
        },
        {
          "name": "importance",
          "description": "Indicates the relative importance of the resource. Priority hints are delegated using the values:"
        },
        {
          "name": "importance",
          "description": "`auto`: Indicates\xA0**no\xA0preference**. The browser may use its own heuristics to decide the priority of the image.\n\n`high`: Indicates to the\xA0browser\xA0that the image is of\xA0**high** priority.\n\n`low`:\xA0Indicates to the\xA0browser\xA0that the image is of\xA0**low** priority."
        },
        {
          "name": "intrinsicsize",
          "description": "This attribute tells the browser to ignore the actual intrinsic size of the image and pretend it\u2019s the size specified in the attribute. Specifically, the image would raster at these dimensions and `naturalWidth`/`naturalHeight` on images would return the values specified in this attribute. [Explainer](https://github.com/ojanvafai/intrinsicsize-attribute), [examples](https://googlechrome.github.io/samples/intrinsic-size/index.html)"
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/img"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "iframe",
      "description": {
        "kind": "markdown",
        "value": "The iframe element represents a nested browsing context."
      },
      "attributes": [
        {
          "name": "src",
          "description": {
            "kind": "markdown",
            "value": 'The URL of the page to embed. Use a value of `about:blank` to embed an empty page that conforms to the [same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy#Inherited_origins). Also note that programatically removing an `<iframe>`\'s src attribute (e.g. via [`Element.removeAttribute()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/removeAttribute "The Element method removeAttribute() removes the attribute with the specified name from the element.")) causes `about:blank` to be loaded in the frame in Firefox (from version 65), Chromium-based browsers, and Safari/iOS.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "srcdoc",
          "description": {
            "kind": "markdown",
            "value": "Inline HTML to embed, overriding the `src` attribute. If a browser does not support the `srcdoc` attribute, it will fall back to the URL in the `src` attribute."
          },
          "browsers": [
            "C20",
            "CA25",
            "E79",
            "FF25",
            "FFA25",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-01-15",
            "baseline_high_date": "2022-07-15"
          }
        },
        {
          "name": "name",
          "description": {
            "kind": "markdown",
            "value": 'A targetable name for the embedded browsing context. This can be used in the `target` attribute of the [`<a>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a "The HTML <a> element (or anchor element) creates a hyperlink to other web pages, files, locations within the same page, email addresses, or any other URL."), [`<form>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form "The HTML <form> element represents a document section that contains interactive controls for submitting information to a web server."), or [`<base>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/base "The HTML <base> element specifies the base URL to use for all relative URLs contained within a document. There can be only one <base> element in a document.") elements; the `formtarget` attribute of the [`<input>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input "The HTML <input> element is used to create interactive controls for web-based forms in order to accept data from the user; a wide variety of types of input data and control widgets are available, depending on the device and user agent.") or [`<button>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button "The HTML <button> element represents a clickable button, which can be used in forms or anywhere in a document that needs simple, standard button functionality.") elements; or the `windowName` parameter in the [`window.open()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/open "The\xA0Window interface\'s open() method loads the specified resource into the browsing context (window, <iframe> or tab) with the specified name. If the name doesn\'t exist, then a new window is opened and the specified resource is loaded into its browsing context.") method.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "sandbox",
          "valueSet": "sb",
          "description": {
            "kind": "markdown",
            "value": 'Applies extra restrictions to the content in the frame. The value of the attribute can either be empty to apply all restrictions, or space-separated tokens to lift particular restrictions:\n\n*   `allow-forms`: Allows the resource to submit forms. If this keyword is not used, form submission is blocked.\n*   `allow-modals`: Lets the resource [open modal windows](https://html.spec.whatwg.org/multipage/origin.html#sandboxed-modals-flag).\n*   `allow-orientation-lock`: Lets the resource [lock the screen orientation](https://developer.mozilla.org/en-US/docs/Web/API/Screen/lockOrientation).\n*   `allow-pointer-lock`: Lets the resource use the [Pointer Lock API](https://developer.mozilla.org/en-US/docs/WebAPI/Pointer_Lock).\n*   `allow-popups`: Allows popups (such as `window.open()`, `target="_blank"`, or `showModalDialog()`). If this keyword is not used, the popup will silently fail to open.\n*   `allow-popups-to-escape-sandbox`: Lets the sandboxed document open new windows without those windows inheriting the sandboxing. For example, this can safely sandbox an advertisement without forcing the same restrictions upon the page the ad links to.\n*   `allow-presentation`: Lets the resource start a [presentation session](https://developer.mozilla.org/en-US/docs/Web/API/PresentationRequest).\n*   `allow-same-origin`: If this token is not used, the resource is treated as being from a special origin that always fails the [same-origin policy](https://developer.mozilla.org/en-US/docs/Glossary/same-origin_policy "same-origin policy: The same-origin policy is a critical security mechanism that restricts how a document or script loaded from one origin can interact with a resource from another origin.").\n*   `allow-scripts`: Lets the resource run scripts (but not create popup windows).\n*   `allow-storage-access-by-user-activation` : Lets the resource request access to the parent\'s storage capabilities with the [Storage Access API](https://developer.mozilla.org/en-US/docs/Web/API/Storage_Access_API).\n*   `allow-top-navigation`: Lets the resource navigate the top-level browsing context (the one named `_top`).\n*   `allow-top-navigation-by-user-activation`: Lets the resource navigate the top-level browsing context, but only if initiated by a user gesture.\n\n**Notes about sandboxing:**\n\n*   When the embedded document has the same origin as the embedding page, it is **strongly discouraged** to use both `allow-scripts` and `allow-same-origin`, as that lets the embedded document remove the `sandbox` attribute \u2014 making it no more secure than not using the `sandbox` attribute at all.\n*   Sandboxing is useless if the attacker can display content outside a sandboxed `iframe` \u2014 such as if the viewer opens the frame in a new tab. Such content should be also served from a _separate origin_ to limit potential damage.\n*   The `sandbox` attribute is unsupported in Internet Explorer 9 and earlier.'
          },
          "browsers": [
            "C5",
            "CA18",
            "E12",
            "FF17",
            "FFA17",
            "S5",
            "SM4"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "seamless",
          "valueSet": "v"
        },
        {
          "name": "allowfullscreen",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": 'Set to `true` if the `<iframe>` can activate fullscreen mode by calling the [`requestFullscreen()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen "The Element.requestFullscreen() method issues an asynchronous request to make the element be displayed in full-screen mode.") method.\nThis attribute is considered a legacy attribute and redefined as `allow="fullscreen"`.'
          },
          "browsers": [
            "C38",
            "CA38",
            "E12",
            "FF18",
            "FFA18",
            "S10.1"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "width",
          "description": {
            "kind": "markdown",
            "value": "The width of the frame in CSS pixels. Default is `300`."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "height",
          "description": {
            "kind": "markdown",
            "value": "The height of the frame in CSS pixels. Default is `150`."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "allow",
          "description": "Specifies a [feature policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Feature_Policy) for the `<iframe>`.",
          "browsers": [
            "C60",
            "CA60",
            "E79",
            "FF74",
            "FFA79",
            "S11.1",
            "SM11.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-07-28",
            "baseline_high_date": "2023-01-28"
          }
        },
        {
          "name": "allowpaymentrequest",
          "description": "Set to `true` if a cross-origin `<iframe>` should be allowed to invoke the [Payment Request API](https://developer.mozilla.org/en-US/docs/Web/API/Payment_Request_API).",
          "browsers": [
            "C60",
            "CA60",
            "E79"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "allowpaymentrequest",
          "description": 'This attribute is considered a legacy attribute and redefined as `allow="payment"`.',
          "browsers": [
            "C60",
            "CA60",
            "E79"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "csp",
          "description": 'A [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP) enforced for the embedded resource. See [`HTMLIFrameElement.csp`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/csp "The csp property of the HTMLIFrameElement interface specifies the Content Security Policy that an embedded document must agree to enforce upon itself.") for details.',
          "browsers": [
            "C61",
            "CA61",
            "E79"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "importance",
          "description": "The download priority of the resource in the `<iframe>`'s `src` attribute. Allowed values:\n\n`auto` (default)\n\nNo preference. The browser uses its own heuristics to decide the priority of the resource.\n\n`high`\n\nThe resource should be downloaded before other lower-priority page resources.\n\n`low`\n\nThe resource should be downloaded after other higher-priority page resources."
        },
        {
          "name": "referrerpolicy",
          "description": 'Indicates which [referrer](https://developer.mozilla.org/en-US/docs/Web/API/Document/referrer) to send when fetching the frame\'s resource:\n\n*   `no-referrer`: The [`Referer`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referer "The Referer request header contains the address of the previous web page from which a link to the currently requested page was followed. The Referer header allows servers to identify where people are visiting them from and may use that data for analytics, logging, or optimized caching, for example.") header will not be sent.\n*   `no-referrer-when-downgrade` (default): The [`Referer`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referer "The Referer request header contains the address of the previous web page from which a link to the currently requested page was followed. The Referer header allows servers to identify where people are visiting them from and may use that data for analytics, logging, or optimized caching, for example.") header will not be sent to [origin](https://developer.mozilla.org/en-US/docs/Glossary/origin "origin: Web content\'s origin is defined by the scheme (protocol), host (domain), and port of the URL used to access it. Two objects have the same origin only when the scheme, host, and port all match.")s without [TLS](https://developer.mozilla.org/en-US/docs/Glossary/TLS "TLS: Transport Layer Security (TLS), previously known as Secure Sockets Layer (SSL), is a protocol used by applications to communicate securely across a network, preventing tampering with and eavesdropping on email, web browsing, messaging, and other protocols.") ([HTTPS](https://developer.mozilla.org/en-US/docs/Glossary/HTTPS "HTTPS: HTTPS (HTTP Secure) is an encrypted version of the HTTP protocol. It usually uses SSL or TLS to encrypt all communication between a client and a server. This secure connection allows clients to safely exchange sensitive data with a server, for example for banking activities or online shopping.")).\n*   `origin`: The sent referrer will be limited to the origin of the referring page: its [scheme](https://developer.mozilla.org/en-US/docs/Archive/Mozilla/URIScheme), [host](https://developer.mozilla.org/en-US/docs/Glossary/host "host: A host is a device connected to the Internet (or a local network). Some hosts called servers offer additional services like serving webpages or storing files and emails."), and [port](https://developer.mozilla.org/en-US/docs/Glossary/port "port: For a computer connected to a network with an IP address, a port is a communication endpoint. Ports are designated by numbers, and below 1024 each port is associated by default with a specific protocol.").\n*   `origin-when-cross-origin`: The referrer sent to other origins will be limited to the scheme, the host, and the port. Navigations on the same origin will still include the path.\n*   `same-origin`: A referrer will be sent for [same origin](https://developer.mozilla.org/en-US/docs/Glossary/Same-origin_policy "same origin: The same-origin policy is a critical security mechanism that restricts how a document or script loaded from one origin can interact with a resource from another origin."), but cross-origin requests will contain no referrer information.\n*   `strict-origin`: Only send the origin of the document as the referrer when the protocol security level stays the same (HTTPS\u2192HTTPS), but don\'t send it to a less secure destination (HTTPS\u2192HTTP).\n*   `strict-origin-when-cross-origin`: Send a full URL when performing a same-origin request, only send the origin when the protocol security level stays the same (HTTPS\u2192HTTPS), and send no header to a less secure destination (HTTPS\u2192HTTP).\n*   `unsafe-url`: The referrer will include the origin _and_ the path (but not the [fragment](https://developer.mozilla.org/en-US/docs/Web/API/HTMLHyperlinkElementUtils/hash), [password](https://developer.mozilla.org/en-US/docs/Web/API/HTMLHyperlinkElementUtils/password), or [username](https://developer.mozilla.org/en-US/docs/Web/API/HTMLHyperlinkElementUtils/username)). **This value is unsafe**, because it leaks origins and paths from TLS-protected resources to insecure origins.',
          "browsers": [
            "C51",
            "CA51",
            "E79",
            "FF50",
            "FFA50",
            "S14",
            "SM14"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-09-16",
            "baseline_high_date": "2023-03-16"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/iframe"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "embed",
      "description": {
        "kind": "markdown",
        "value": "The embed element provides an integration point for an external (typically non-HTML) application or interactive content."
      },
      "void": true,
      "attributes": [
        {
          "name": "src",
          "description": {
            "kind": "markdown",
            "value": "The URL\xA0of the resource being embedded."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "type",
          "description": {
            "kind": "markdown",
            "value": "The MIME\xA0type to use to select the plug-in to instantiate."
          },
          "browsers": [
            "C1",
            "CA18",
            "E79",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-01-15",
            "baseline_high_date": "2022-07-15"
          }
        },
        {
          "name": "width",
          "description": {
            "kind": "markdown",
            "value": "The displayed width of the resource, in [CSS pixels](https://drafts.csswg.org/css-values/#px). This must be an absolute value; percentages are _not_ allowed."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "height",
          "description": {
            "kind": "markdown",
            "value": "The displayed height of the resource, in [CSS pixels](https://drafts.csswg.org/css-values/#px). This must be an absolute value; percentages are _not_ allowed."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/embed"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "object",
      "description": {
        "kind": "markdown",
        "value": "The object element can represent an external resource, which, depending on the type of the resource, will either be treated as an image, as a nested browsing context, or as an external resource to be processed by a plugin."
      },
      "attributes": [
        {
          "name": "data",
          "description": {
            "kind": "markdown",
            "value": "The address of the resource as a valid URL. At least one of **data** and **type** must be defined."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "type",
          "description": {
            "kind": "markdown",
            "value": "The [content type](https://developer.mozilla.org/en-US/docs/Glossary/Content_type) of the resource specified by **data**. At least one of **data** and **type** must be defined."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "typemustmatch",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "This Boolean attribute indicates if the **type** attribute and the actual [content type](https://developer.mozilla.org/en-US/docs/Glossary/Content_type) of the resource must match to be used."
          }
        },
        {
          "name": "name",
          "description": {
            "kind": "markdown",
            "value": "The name of valid browsing context (HTML5), or the name of the control (HTML 4)."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "usemap",
          "description": {
            "kind": "markdown",
            "value": "A hash-name reference to a [`<map>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/map \"The HTML <map> element is used with <area> elements to define an image map (a clickable link area).\") element; that is a '#' followed by the value of a [`name`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/map#attr-name) of a map element."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "form",
          "description": {
            "kind": "markdown",
            "value": 'The form element, if any, that the object element is associated with (its _form owner_). The value of the attribute must be an ID of a [`<form>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form "The HTML <form> element represents a document section that contains interactive controls for submitting information to a web server.") element in the same document.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "width",
          "description": {
            "kind": "markdown",
            "value": "The width of the display resource, in [CSS pixels](https://drafts.csswg.org/css-values/#px). -- (Absolute values only. [NO percentages](https://html.spec.whatwg.org/multipage/embedded-content.html#dimension-attributes))"
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "height",
          "description": {
            "kind": "markdown",
            "value": "The height of the displayed resource, in [CSS pixels](https://drafts.csswg.org/css-values/#px). -- (Absolute values only. [NO percentages](https://html.spec.whatwg.org/multipage/embedded-content.html#dimension-attributes))"
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "archive",
          "description": "A space-separated list of URIs for archives of resources for the object.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "border",
          "description": "The width of a border around the control, in pixels.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "classid",
          "description": "The URI of the object's implementation. It can be used together with, or in place of, the **data** attribute.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "codebase",
          "description": "The base path used to resolve relative URIs specified by **classid**, **data**, or **archive**. If not specified, the default is the base URI of the current document.",
          "browsers": [],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "codetype",
          "description": "The content type of the data specified by **classid**.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "declare",
          "description": "The presence of this Boolean attribute makes this element a declaration only. The object must be instantiated by a subsequent `<object>` element. In HTML5, repeat the <object> element completely each that that the resource is reused.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "standby",
          "description": "A message that the browser can show while loading the object's implementation and data.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "tabindex",
          "description": "The position of the element in the tabbing navigation order for the current document."
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/object"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S3",
        "SM2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "param",
      "description": {
        "kind": "markdown",
        "value": "The param element defines parameters for plugins invoked by object elements. It does not represent anything on its own."
      },
      "void": true,
      "attributes": [
        {
          "name": "name",
          "description": {
            "kind": "markdown",
            "value": "Name of the parameter."
          }
        },
        {
          "name": "value",
          "description": {
            "kind": "markdown",
            "value": "Specifies the value of the parameter."
          }
        },
        {
          "name": "type",
          "description": 'Only used if the `valuetype` is set to "ref". Specifies the MIME type of values found at the URI specified by value.'
        },
        {
          "name": "valuetype",
          "description": 'Specifies the type of the `value` attribute. Possible values are:\n\n*   data: Default value. The value is passed to the object\'s implementation as a string.\n*   ref: The value is a URI to a resource where run-time values are stored.\n*   object: An ID of another [`<object>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/object "The HTML <object> element represents an external resource, which can be treated as an image, a nested browsing context, or a resource to be handled by a plugin.") in the same document.'
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/param"
        }
      ]
    },
    {
      "name": "video",
      "description": {
        "kind": "markdown",
        "value": "A video element is used for playing videos or movies, and audio files with captions."
      },
      "attributes": [
        {
          "name": "src",
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF3.5",
            "FFA4",
            "S3.1",
            "SM3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "crossorigin",
          "valueSet": "xo",
          "browsers": [
            "C33",
            "CA33",
            "E18",
            "FF74",
            "FFA79",
            "S10",
            "SM10"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-07-28",
            "baseline_high_date": "2023-01-28"
          }
        },
        {
          "name": "poster",
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF3.6",
            "FFA4",
            "S3.1",
            "SM3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "preload",
          "valueSet": "pl",
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S3.1",
            "SM3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "autoplay",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": 'A Boolean attribute; if specified, the video automatically begins to play back as soon as it can do so without stopping to finish loading the data.\n**Note**: Sites that automatically play audio (or video with an audio track) can be an unpleasant experience for users, so it should be avoided when possible. If you must offer autoplay functionality, you should make it opt-in (requiring a user to specifically enable it). However, this can be useful when creating media elements whose source will be set at a later time, under user control.\n\nTo disable video autoplay, `autoplay="false"` will not work; the video will autoplay if the attribute is there in the `<video>` tag at all. To remove autoplay the attribute needs to be removed altogether.\n\nIn some browsers (e.g. Chrome 70.0) autoplay is not working if no `muted` attribute is present.'
          },
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF3.5",
            "FFA4",
            "S3.1",
            "SM10"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2016-09-13",
            "baseline_high_date": "2019-03-13"
          }
        },
        {
          "name": "mediagroup"
        },
        {
          "name": "loop",
          "valueSet": "v",
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF11",
            "FFA14",
            "S3.1",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "muted",
          "valueSet": "v",
          "browsers": [
            "C30",
            "CA30",
            "E12",
            "FF11",
            "FFA14",
            "S5",
            "SM4.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "controls",
          "valueSet": "v",
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF3.5",
            "FFA4",
            "S3.1",
            "SM3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "width",
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF3.5",
            "FFA4",
            "S3.1",
            "SM3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "height",
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF3.5",
            "FFA4",
            "S3.1",
            "SM3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/video"
        }
      ],
      "browsers": [
        "C3",
        "CA18",
        "E12",
        "FF3.5",
        "FFA4",
        "S3.1",
        "SM3"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "audio",
      "description": {
        "kind": "markdown",
        "value": "An audio element represents a sound or audio stream."
      },
      "attributes": [
        {
          "name": "src",
          "description": {
            "kind": "markdown",
            "value": 'The URL of the audio to embed. This is subject to [HTTP access controls](https://developer.mozilla.org/en-US/docs/HTTP_access_control). This is optional; you may instead use the [`<source>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/source "The HTML <source> element specifies multiple media resources for the <picture>, the <audio> element, or the <video> element.") element within the audio block to specify the audio to embed.'
          },
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF3.5",
            "FFA4",
            "S3.1",
            "SM3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "crossorigin",
          "valueSet": "xo",
          "description": {
            "kind": "markdown",
            "value": 'This enumerated attribute indicates whether to use CORS to fetch the related image. [CORS-enabled resources](https://developer.mozilla.org/en-US/docs/CORS_Enabled_Image) can be reused in the [`<canvas>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas "Use the HTML <canvas> element with either the canvas scripting API or the WebGL API to draw graphics and animations.") element without being _tainted_. The allowed values are:\n\nanonymous\n\nSends a cross-origin request without a credential. In other words, it sends the `Origin:` HTTP header without a cookie, X.509 certificate, or performing HTTP Basic authentication. If the server does not give credentials to the origin site (by not setting the `Access-Control-Allow-Origin:` HTTP header), the image will be _tainted_, and its usage restricted.\n\nuse-credentials\n\nSends a cross-origin request with a credential. In other words, it sends the `Origin:` HTTP header with a cookie, a certificate, or performing HTTP Basic authentication. If the server does not give credentials to the origin site (through `Access-Control-Allow-Credentials:` HTTP header), the image will be _tainted_ and its usage restricted.\n\nWhen not present, the resource is fetched without a CORS request (i.e. without sending the `Origin:` HTTP header), preventing its non-tainted used in [`<canvas>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas "Use the HTML <canvas> element with either the canvas scripting API or the WebGL API to draw graphics and animations.") elements. If invalid, it is handled as if the enumerated keyword **anonymous** was used. See [CORS settings attributes](https://developer.mozilla.org/en-US/docs/HTML/CORS_settings_attributes) for additional information.'
          },
          "browsers": [
            "C33",
            "CA33",
            "E18",
            "FF74",
            "FFA79",
            "S10",
            "SM10"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-07-28",
            "baseline_high_date": "2023-01-28"
          }
        },
        {
          "name": "preload",
          "valueSet": "pl",
          "description": {
            "kind": "markdown",
            "value": "This enumerated attribute is intended to provide a hint to the browser about what the author thinks will lead to the best user experience. It may have one of the following values:\n\n*   `none`: Indicates that the audio should not be preloaded.\n*   `metadata`: Indicates that only audio metadata (e.g. length) is fetched.\n*   `auto`: Indicates that the whole audio file can be downloaded, even if the user is not expected to use it.\n*   _empty string_: A synonym of the `auto` value.\n\nIf not set, `preload`'s default value is browser-defined (i.e. each browser may have its own default value). The spec advises it to be set to `metadata`.\n\n**Usage notes:**\n\n*   The `autoplay` attribute has precedence over\xA0`preload`. If `autoplay` is specified, the browser would obviously need to start downloading the audio for playback.\n*   The browser is not forced by the specification to follow the value of this attribute; it is a mere hint."
          },
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S3.1",
            "SM3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "autoplay",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "A Boolean attribute:\xA0if specified, the audio will automatically begin playback as soon as it can do so, without waiting for the entire audio file to finish downloading.\n\n**Note**: Sites that automatically play audio (or videos with an audio track) can be an unpleasant experience for users, so should be avoided when possible. If you must offer autoplay functionality, you should make it opt-in (requiring a user to specifically enable it). However, this can be useful when creating media elements whose source will be set at a later time, under user control."
          }
        },
        {
          "name": "mediagroup"
        },
        {
          "name": "loop",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "A Boolean attribute:\xA0if specified, the audio player will\xA0automatically seek back to the start\xA0upon reaching the end of the audio."
          },
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF11",
            "FFA14",
            "S3.1",
            "SM3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "muted",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "A Boolean attribute that indicates whether the audio will be initially silenced. Its default value is `false`."
          },
          "browsers": [
            "C15",
            "CA18",
            "E18",
            "FF11",
            "FFA14",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "\u22642018-10-02",
            "baseline_high_date": "\u22642021-04-02"
          }
        },
        {
          "name": "controls",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "If this attribute is present, the browser will offer controls to allow the user to control audio playback, including volume, seeking, and pause/resume playback."
          },
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF3.5",
            "FFA4",
            "S3.1",
            "SM3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/audio"
        }
      ],
      "browsers": [
        "C3",
        "CA18",
        "E12",
        "FF3.5",
        "FFA4",
        "S3.1",
        "SM3"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "source",
      "description": {
        "kind": "markdown",
        "value": "The source element allows authors to specify multiple alternative media resources for media elements. It does not represent anything on its own."
      },
      "void": true,
      "attributes": [
        {
          "name": "src",
          "description": {
            "kind": "markdown",
            "value": 'Required for [`<audio>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio "The HTML <audio> element is used to embed sound content in documents. It may contain one or more audio sources, represented using the src attribute or the <source> element:\xA0the browser will choose the most suitable one. It can also be the destination for streamed media, using a MediaStream.") and [`<video>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video "The HTML Video element (<video>) embeds a media player which supports video playback into the document."), address of the media resource. The value of this attribute is ignored when the `<source>` element is placed inside a [`<picture>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/picture "The HTML <picture> element contains zero or more <source> elements and one <img> element to provide versions of an image for different display/device scenarios.") element.'
          },
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF3.5",
            "FFA4",
            "S3.1",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "type",
          "description": {
            "kind": "markdown",
            "value": "The MIME-type of the resource, optionally with a `codecs` parameter. See [RFC 4281](https://tools.ietf.org/html/rfc4281) for information about how to specify codecs."
          },
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF3.5",
            "FFA4",
            "S3.1",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "sizes",
          "description": 'Is a list of source sizes that describes the final rendered width of the image represented by the source. Each source size consists of a comma-separated list of media condition-length pairs. This information is used by the browser to determine, before laying the page out, which image defined in [`srcset`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/source#attr-srcset) to use.  \nThe `sizes` attribute has an effect only when the [`<source>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/source "The HTML <source> element specifies multiple media resources for the <picture>, the <audio> element, or the <video> element.") element is the direct child of a [`<picture>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/picture "The HTML <picture> element contains zero or more <source> elements and one <img> element to provide versions of an image for different display/device scenarios.") element.',
          "browsers": [
            "C34",
            "CA34",
            "E13",
            "FF38",
            "FFA38",
            "S9.1",
            "SM9.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2016-03-21",
            "baseline_high_date": "2018-09-21"
          }
        },
        {
          "name": "srcset",
          "description": "A list of one or more strings separated by commas indicating a set of possible images represented by the source for the browser to use. Each string is composed of:\n\n1.  one URL to an image,\n2.  a width descriptor, that is a positive integer directly followed by `'w'`. The default value, if missing, is the infinity.\n3.  a pixel density descriptor, that is a positive floating number directly followed by `'x'`. The default value, if missing, is `1x`.\n\nEach string in the list must have at least a width descriptor or a pixel density descriptor to be valid. Among the list, there must be only one string containing the same tuple of width descriptor and pixel density descriptor.  \nThe browser chooses the most adequate image to display at a given point of time.  \nThe `srcset` attribute has an effect only when the [`<source>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/source \"The HTML <source> element specifies multiple media resources for the <picture>, the <audio> element, or the <video> element.\") element is the direct child of a [`<picture>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/picture \"The HTML <picture> element contains zero or more <source> elements and one <img> element to provide versions of an image for different display/device scenarios.\") element.",
          "browsers": [
            "C34",
            "CA34",
            "E13",
            "FF38",
            "FFA38",
            "S9.1",
            "SM9.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2016-03-21",
            "baseline_high_date": "2018-09-21"
          }
        },
        {
          "name": "media",
          "description": '[Media query](https://developer.mozilla.org/en-US/docs/CSS/Media_queries) of the resource\'s intended media; this should be used only in a [`<picture>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/picture "The HTML <picture> element contains zero or more <source> elements and one <img> element to provide versions of an image for different display/device scenarios.") element.',
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF15",
            "FFA15",
            "S3.1",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/source"
        }
      ],
      "browsers": [
        "C3",
        "CA18",
        "E12",
        "FF3.5",
        "FFA4",
        "S3.1",
        "SM2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "track",
      "description": {
        "kind": "markdown",
        "value": "The track element allows authors to specify explicit external timed text tracks for media elements. It does not represent anything on its own."
      },
      "void": true,
      "attributes": [
        {
          "name": "default",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "This attribute indicates that the track should be enabled unless the user's preferences indicate that another track is more appropriate. This may only be used on one `track` element per media element."
          },
          "browsers": [
            "C23",
            "CA25",
            "E12",
            "FF31",
            "FFA31",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "kind",
          "valueSet": "tk",
          "description": {
            "kind": "markdown",
            "value": "How the text track is meant to be used. If omitted the default kind is `subtitles`. If the attribute is not present, it will use the `subtitles`. If the attribute contains an invalid value, it will use `metadata`. (Versions of Chrome earlier than 52 treated an invalid value as `subtitles`.)\xA0The following keywords are allowed:\n\n*   `subtitles`\n    *   Subtitles provide translation of content that cannot be understood by the viewer. For example dialogue or text that is not English in an English language film.\n    *   Subtitles may contain additional content, usually extra background information. For example the text at the beginning of the Star Wars films, or the date, time, and location of a scene.\n*   `captions`\n    *   Closed captions provide a transcription and possibly a translation of audio.\n    *   It may include important non-verbal information such as music cues or sound effects. It may indicate the cue's source (e.g. music, text, character).\n    *   Suitable for users who are deaf or when the sound is muted.\n*   `descriptions`\n    *   Textual description of the video content.\n    *   Suitable for users who are blind or where the video cannot be seen.\n*   `chapters`\n    *   Chapter titles are intended to be used when the user is navigating the media resource.\n*   `metadata`\n    *   Tracks used by scripts. Not visible to the user."
          },
          "browsers": [
            "C23",
            "CA25",
            "E12",
            "FF31",
            "FFA31",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "label",
          "description": {
            "kind": "markdown",
            "value": "A user-readable title of the text track which is used by the browser when listing available text tracks."
          },
          "browsers": [
            "C23",
            "CA25",
            "E12",
            "FF31",
            "FFA31",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "src",
          "description": {
            "kind": "markdown",
            "value": 'Address of the track (`.vtt` file). Must be a valid URL. This attribute must be specified and its URL value must have the same origin as the document \u2014 unless the [`<audio>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio "The HTML <audio> element is used to embed sound content in documents. It may contain one or more audio sources, represented using the src attribute or the <source> element:\xA0the browser will choose the most suitable one. It can also be the destination for streamed media, using a MediaStream.") or [`<video>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video "The HTML Video element (<video>) embeds a media player which supports video playback into the document.") parent element of the `track` element has a [`crossorigin`](https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_settings_attributes) attribute.'
          },
          "browsers": [
            "C23",
            "CA25",
            "E12",
            "FF50",
            "FFA50",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2016-11-15",
            "baseline_high_date": "2019-05-15"
          }
        },
        {
          "name": "srclang",
          "description": {
            "kind": "markdown",
            "value": "Language of the track text data. It must be a valid [BCP 47](https://r12a.github.io/app-subtags/) language tag. If the `kind` attribute is set to\xA0`subtitles,` then `srclang` must be defined."
          },
          "browsers": [
            "C23",
            "CA25",
            "E12",
            "FF31",
            "FFA31",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/track"
        }
      ],
      "browsers": [
        "C23",
        "CA25",
        "E12",
        "FF31",
        "FFA31",
        "S6",
        "SM6"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "map",
      "description": {
        "kind": "markdown",
        "value": "The map element, in conjunction with an img element and any area element descendants, defines an image map. The element represents its children."
      },
      "attributes": [
        {
          "name": "name",
          "description": {
            "kind": "markdown",
            "value": "The name attribute gives the map a name so that it can be referenced. The attribute must be present and must have a non-empty value with no space characters. The value of the name attribute must not be a compatibility-caseless match for the value of the name attribute of another map element in the same document. If the id attribute is also specified, both attributes must have the same value."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/map"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "area",
      "description": {
        "kind": "markdown",
        "value": "The area element represents either a hyperlink with some text and a corresponding area on an image map, or a dead area on an image map."
      },
      "void": true,
      "attributes": [
        {
          "name": "alt",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "coords",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "shape",
          "valueSet": "sh",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "href",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "target",
          "valueSet": "target",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "download",
          "browsers": [
            "C54",
            "CA54",
            "E12",
            "FF20",
            "FFA20",
            "S10.1",
            "SM10.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2017-03-27",
            "baseline_high_date": "2019-09-27"
          }
        },
        {
          "name": "ping",
          "browsers": [
            "C12",
            "CA18",
            "E17",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "rel",
          "browsers": [
            "C16",
            "CA18",
            "E12",
            "FF30",
            "FFA30",
            "S5",
            "SM4.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "hreflang"
        },
        {
          "name": "type"
        },
        {
          "name": "accesskey",
          "description": "Specifies a keyboard navigation accelerator for the element. Pressing ALT or a similar key in association with the specified character selects the form control correlated with that key sequence. Page designers are forewarned to avoid key sequences already bound to browsers. This attribute is global since HTML5."
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/area"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "table",
      "description": {
        "kind": "markdown",
        "value": "The table element represents data with more than one dimension, in the form of a table."
      },
      "attributes": [
        {
          "name": "border",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "align",
          "description": 'This enumerated attribute indicates how the table must be aligned inside the containing document. It may have the following values:\n\n*   left: the table is displayed on the left side of the document;\n*   center: the table is displayed in the center of the document;\n*   right: the table is displayed on the right side of the document.\n\n**Usage Note**\n\n*   **Do not use this attribute**, as it has been deprecated. The [`<table>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/table "The HTML <table> element represents tabular data \u2014 that is, information presented in a two-dimensional table comprised of rows and columns of cells containing data.") element should be styled using [CSS](https://developer.mozilla.org/en-US/docs/CSS). Set [`margin-left`](https://developer.mozilla.org/en-US/docs/Web/CSS/margin-left "The margin-left CSS property sets the margin area on the left side of an element. A positive value places it farther from its neighbors, while a negative value places it closer.") and [`margin-right`](https://developer.mozilla.org/en-US/docs/Web/CSS/margin-right "The margin-right CSS property sets the margin area on the right side of an element. A positive value places it farther from its neighbors, while a negative value places it closer.") to `auto` or [`margin`](https://developer.mozilla.org/en-US/docs/Web/CSS/margin "The margin CSS property sets the margin area on all four sides of an element. It is a shorthand for margin-top, margin-right, margin-bottom, and margin-left.") to `0 auto` to achieve an effect that is similar to the align attribute.\n*   Prior to Firefox 4, Firefox also supported the `middle`, `absmiddle`, and `abscenter` values as synonyms of `center`, in quirks mode only.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/table"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "caption",
      "description": {
        "kind": "markdown",
        "value": "The caption element represents the title of the table that is its parent, if it has a parent and that is a table element."
      },
      "attributes": [
        {
          "name": "align",
          "description": 'This enumerated attribute indicates how the caption must be aligned with respect to the table. It may have one of the following values:\n\n`left`\n\nThe caption is displayed to the left of the table.\n\n`top`\n\nThe caption is displayed above the table.\n\n`right`\n\nThe caption is displayed to the right of the table.\n\n`bottom`\n\nThe caption is displayed below the table.\n\n**Usage note:** Do not use this attribute, as it has been deprecated. The [`<caption>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/caption "The HTML Table Caption element (<caption>) specifies the caption (or title) of a table, and if used is always the first child of a <table>.") element should be styled using the [CSS](https://developer.mozilla.org/en-US/docs/CSS) properties [`caption-side`](https://developer.mozilla.org/en-US/docs/Web/CSS/caption-side "The caption-side CSS property puts the content of a table\'s <caption> on the specified side. The values are relative to the writing-mode of the table.") and [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.").',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/caption"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "colgroup",
      "description": {
        "kind": "markdown",
        "value": "The colgroup element represents a group of one or more columns in the table that is its parent, if it has a parent and that is a table element."
      },
      "attributes": [
        {
          "name": "span",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "align",
          "description": 'This enumerated attribute specifies how horizontal alignment of each column cell content will be handled. Possible values are:\n\n*   `left`, aligning the content to the left of the cell\n*   `center`, centering the content in the cell\n*   `right`, aligning the content to the right of the cell\n*   `justify`, inserting spaces into the textual content so that the content is justified in the cell\n*   `char`, aligning the textual content on a special character with a minimal offset, defined by the [`char`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/col#attr-char) and [`charoff`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/col#attr-charoff) attributes Unimplemented (see [bug\xA02212](https://bugzilla.mozilla.org/show_bug.cgi?id=2212 "character alignment not implemented (align=char, charoff=, text-align:<string>)")).\n\nIf this attribute is not set, the `left` value is assumed. The descendant [`<col>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/col "The HTML <col> element defines a column within a table and is used for defining common semantics on all common cells. It is generally found within a <colgroup> element.") elements may override this value using their own [`align`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/col#attr-align) attribute.\n\n**Note:** Do not use this attribute as it is obsolete (not supported) in the latest standard.\n\n*   To achieve the same effect as the `left`, `center`, `right` or `justify` values:\n    *   Do not try to set the [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property on a selector giving a [`<colgroup>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/colgroup "The HTML <colgroup> element defines a group of columns within a table.") element. Because [`<td>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/td "The HTML <td> element defines a cell of a table that contains data. It participates in the table model.") elements are not descendant of the [`<colgroup>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/colgroup "The HTML <colgroup> element defines a group of columns within a table.") element, they won\'t inherit it.\n    *   If the table doesn\'t use a [`colspan`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/td#attr-colspan) attribute, use one `td:nth-child(an+b)` CSS selector per column, where a is the total number of the columns in the table and b is the ordinal position of this column in the table. Only after this selector the [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property can be used.\n    *   If the table does use a [`colspan`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/td#attr-colspan) attribute, the effect can be achieved by combining adequate CSS attribute selectors like `[colspan=n]`, though this is not trivial.\n*   To achieve the same effect as the `char` value, in CSS3, you can use the value of the [`char`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/colgroup#attr-char) as the value of the [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property Unimplemented.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/colgroup"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "col",
      "description": {
        "kind": "markdown",
        "value": "If a col element has a parent and that is a colgroup element that itself has a parent that is a table element, then the col element represents one or more columns in the column group represented by that colgroup."
      },
      "void": true,
      "attributes": [
        {
          "name": "span",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "align",
          "description": 'This enumerated attribute specifies how horizontal alignment of each column cell content will be handled. Possible values are:\n\n*   `left`, aligning the content to the left of the cell\n*   `center`, centering the content in the cell\n*   `right`, aligning the content to the right of the cell\n*   `justify`, inserting spaces into the textual content so that the content is justified in the cell\n*   `char`, aligning the textual content on a special character with a minimal offset, defined by the [`char`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/col#attr-char) and [`charoff`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/col#attr-charoff) attributes Unimplemented (see [bug\xA02212](https://bugzilla.mozilla.org/show_bug.cgi?id=2212 "character alignment not implemented (align=char, charoff=, text-align:<string>)")).\n\nIf this attribute is not set, its value is inherited from the [`align`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/colgroup#attr-align) of the [`<colgroup>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/colgroup "The HTML <colgroup> element defines a group of columns within a table.") element this `<col>` element belongs too. If there are none, the `left` value is assumed.\n\n**Note:** Do not use this attribute as it is obsolete (not supported) in the latest standard.\n\n*   To achieve the same effect as the `left`, `center`, `right` or `justify` values:\n    *   Do not try to set the [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property on a selector giving a [`<col>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/col "The HTML <col> element defines a column within a table and is used for defining common semantics on all common cells. It is generally found within a <colgroup> element.") element. Because [`<td>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/td "The HTML <td> element defines a cell of a table that contains data. It participates in the table model.") elements are not descendant of the [`<col>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/col "The HTML <col> element defines a column within a table and is used for defining common semantics on all common cells. It is generally found within a <colgroup> element.") element, they won\'t inherit it.\n    *   If the table doesn\'t use a [`colspan`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/td#attr-colspan) attribute, use the `td:nth-child(an+b)` CSS selector. Set `a` to zero and `b` to the position of the column in the table, e.g. `td:nth-child(2) { text-align: right; }` to right-align the second column.\n    *   If the table does use a [`colspan`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/td#attr-colspan) attribute, the effect can be achieved by combining adequate CSS attribute selectors like `[colspan=n]`, though this is not trivial.\n*   To achieve the same effect as the `char` value, in CSS3, you can use the value of the [`char`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/col#attr-char) as the value of the [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property Unimplemented.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/col"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "tbody",
      "description": {
        "kind": "markdown",
        "value": "The tbody element represents a block of rows that consist of a body of data for the parent table element, if the tbody element has a parent and it is a table."
      },
      "attributes": [
        {
          "name": "align",
          "description": 'This enumerated attribute specifies how horizontal alignment of each cell content will be handled. Possible values are:\n\n*   `left`, aligning the content to the left of the cell\n*   `center`, centering the content in the cell\n*   `right`, aligning the content to the right of the cell\n*   `justify`, inserting spaces into the textual content so that the content is justified in the cell\n*   `char`, aligning the textual content on a special character with a minimal offset, defined by the [`char`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/tbody#attr-char) and [`charoff`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/tbody#attr-charoff) attributes.\n\nIf this attribute is not set, the `left` value is assumed.\n\n**Note:** Do not use this attribute as it is obsolete (not supported) in the latest standard.\n\n*   To achieve the same effect as the `left`, `center`, `right` or `justify` values, use the CSS [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property on it.\n*   To achieve the same effect as the `char` value, in CSS3, you can use the value of the [`char`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/tbody#attr-char) as the value of the [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property Unimplemented.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/tbody"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "thead",
      "description": {
        "kind": "markdown",
        "value": "The thead element represents the block of rows that consist of the column labels (headers) for the parent table element, if the thead element has a parent and it is a table."
      },
      "attributes": [
        {
          "name": "align",
          "description": 'This enumerated attribute specifies how horizontal alignment of each cell content will be handled. Possible values are:\n\n*   `left`, aligning the content to the left of the cell\n*   `center`, centering the content in the cell\n*   `right`, aligning the content to the right of the cell\n*   `justify`, inserting spaces into the textual content so that the content is justified in the cell\n*   `char`, aligning the textual content on a special character with a minimal offset, defined by the [`char`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/thead#attr-char) and [`charoff`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/thead#attr-charoff) attributes Unimplemented (see [bug\xA02212](https://bugzilla.mozilla.org/show_bug.cgi?id=2212 "character alignment not implemented (align=char, charoff=, text-align:<string>)")).\n\nIf this attribute is not set, the `left` value is assumed.\n\n**Note:** Do not use this attribute as it is obsolete (not supported) in the latest standard.\n\n*   To achieve the same effect as the `left`, `center`, `right` or `justify` values, use the CSS [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property on it.\n*   To achieve the same effect as the `char` value, in CSS3, you can use the value of the [`char`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/thead#attr-char) as the value of the [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property Unimplemented.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/thead"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "tfoot",
      "description": {
        "kind": "markdown",
        "value": "The tfoot element represents the block of rows that consist of the column summaries (footers) for the parent table element, if the tfoot element has a parent and it is a table."
      },
      "attributes": [
        {
          "name": "align",
          "description": 'This enumerated attribute specifies how horizontal alignment of each cell content will be handled. Possible values are:\n\n*   `left`, aligning the content to the left of the cell\n*   `center`, centering the content in the cell\n*   `right`, aligning the content to the right of the cell\n*   `justify`, inserting spaces into the textual content so that the content is justified in the cell\n*   `char`, aligning the textual content on a special character with a minimal offset, defined by the [`char`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/tbody#attr-char) and [`charoff`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/tbody#attr-charoff) attributes Unimplemented (see [bug\xA02212](https://bugzilla.mozilla.org/show_bug.cgi?id=2212 "character alignment not implemented (align=char, charoff=, text-align:<string>)")).\n\nIf this attribute is not set, the `left` value is assumed.\n\n**Note:** Do not use this attribute as it is obsolete (not supported) in the latest standard.\n\n*   To achieve the same effect as the `left`, `center`, `right` or `justify` values, use the CSS [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property on it.\n*   To achieve the same effect as the `char` value, in CSS3, you can use the value of the [`char`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/tfoot#attr-char) as the value of the [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property Unimplemented.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/tfoot"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "tr",
      "description": {
        "kind": "markdown",
        "value": "The tr element represents a row of cells in a table."
      },
      "attributes": [
        {
          "name": "align",
          "description": 'A [`DOMString`](https://developer.mozilla.org/en-US/docs/Web/API/DOMString "DOMString is a UTF-16 String. As JavaScript already uses such strings, DOMString is mapped directly to a String.") which specifies how the cell\'s context should be aligned horizontally within the cells in the row; this is shorthand for using `align` on every cell in the row individually. Possible values are:\n\n`left`\n\nAlign the content of each cell at its left edge.\n\n`center`\n\nCenter the contents of each cell between their left and right edges.\n\n`right`\n\nAlign the content of each cell at its right edge.\n\n`justify`\n\nWiden whitespaces within the text of each cell so that the text fills the full width of each cell (full justification).\n\n`char`\n\nAlign each cell in the row on a specific character (such that each row in the column that is configured this way will horizontally align its cells on that character). This uses the [`char`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/tr#attr-char) and [`charoff`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/tr#attr-charoff) to establish the alignment character (typically "." or "," when aligning numerical data) and the number of characters that should follow the alignment character. This alignment type was never widely supported.\n\nIf no value is expressly set for `align`, the parent node\'s value is inherited.\n\nInstead of using the obsolete `align` attribute, you should instead use the CSS [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property to establish `left`, `center`, `right`, or `justify` alignment for the row\'s cells. To apply character-based alignment, set the CSS [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property to the alignment character (such as `"."` or `","`).',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/tr"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "td",
      "description": {
        "kind": "markdown",
        "value": "The td element represents a data cell in a table."
      },
      "attributes": [
        {
          "name": "colspan",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "rowspan",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "headers",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "abbr",
          "description": "This attribute contains a short abbreviated description of the cell's content. Some user-agents, such as speech readers, may present this description before the content itself.\n\n**Note:** Do not use this attribute as it is obsolete in the latest standard. Alternatively, you can put the abbreviated description inside the cell and place the long content in the **title** attribute.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "align",
          "description": 'This enumerated attribute specifies how the cell content\'s horizontal alignment will be handled. Possible values are:\n\n*   `left`: The content is aligned to the left of the cell.\n*   `center`: The content is centered in the cell.\n*   `right`: The content is aligned to the right of the cell.\n*   `justify` (with text only): The content is stretched out inside the cell so that it covers its entire width.\n*   `char` (with text only): The content is aligned to a character inside the `<th>` element with minimal offset. This character is defined by the [`char`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/td#attr-char) and [`charoff`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/td#attr-charoff) attributes Unimplemented (see [bug\xA02212](https://bugzilla.mozilla.org/show_bug.cgi?id=2212 "character alignment not implemented (align=char, charoff=, text-align:<string>)")).\n\nThe default value when this attribute is not specified is `left`.\n\n**Note:** Do not use this attribute as it is obsolete in the latest standard.\n\n*   To achieve the same effect as the `left`, `center`, `right` or `justify` values, apply the CSS [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property to the element.\n*   To achieve the same effect as the `char` value, give the [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property the same value you would use for the [`char`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/td#attr-char). Unimplemented in CSS3.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "axis",
          "description": "This attribute contains a list of space-separated strings. Each string is the `id` of a group of cells that this header applies to.\n\n**Note:** Do not use this attribute as it is obsolete in the latest standard.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "bgcolor",
          "description": 'This attribute defines the background color of each cell in a column. It consists of a 6-digit hexadecimal code as defined in [sRGB](https://www.w3.org/Graphics/Color/sRGB) and is prefixed by \'#\'. This attribute may be used with one of sixteen predefined color strings:\n\n\xA0\n\n`black` = "#000000"\n\n\xA0\n\n`green` = "#008000"\n\n\xA0\n\n`silver` = "#C0C0C0"\n\n\xA0\n\n`lime` = "#00FF00"\n\n\xA0\n\n`gray` = "#808080"\n\n\xA0\n\n`olive` = "#808000"\n\n\xA0\n\n`white` = "#FFFFFF"\n\n\xA0\n\n`yellow` = "#FFFF00"\n\n\xA0\n\n`maroon` = "#800000"\n\n\xA0\n\n`navy` = "#000080"\n\n\xA0\n\n`red` = "#FF0000"\n\n\xA0\n\n`blue` = "#0000FF"\n\n\xA0\n\n`purple` = "#800080"\n\n\xA0\n\n`teal` = "#008080"\n\n\xA0\n\n`fuchsia` = "#FF00FF"\n\n\xA0\n\n`aqua` = "#00FFFF"\n\n**Note:** Do not use this attribute, as it is non-standard and only implemented in some versions of Microsoft Internet Explorer: The [`<td>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/td "The HTML <td> element defines a cell of a table that contains data. It participates in the table model.") element should be styled using [CSS](https://developer.mozilla.org/en-US/docs/CSS). To create a similar effect use the [`background-color`](https://developer.mozilla.org/en-US/docs/Web/CSS/background-color "The background-color CSS property sets the background color of an element.") property in [CSS](https://developer.mozilla.org/en-US/docs/CSS) instead.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/td"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "th",
      "description": {
        "kind": "markdown",
        "value": "The th element represents a header cell in a table."
      },
      "attributes": [
        {
          "name": "colspan",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "rowspan",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "headers",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "scope",
          "valueSet": "s",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "sorted"
        },
        {
          "name": "abbr",
          "description": {
            "kind": "markdown",
            "value": "This attribute contains a short abbreviated description of the cell's content. Some user-agents, such as speech readers, may present this description before the content itself."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "align",
          "description": 'This enumerated attribute specifies how the cell content\'s horizontal alignment will be handled. Possible values are:\n\n*   `left`: The content is aligned to the left of the cell.\n*   `center`: The content is centered in the cell.\n*   `right`: The content is aligned to the right of the cell.\n*   `justify` (with text only): The content is stretched out inside the cell so that it covers its entire width.\n*   `char` (with text only): The content is aligned to a character inside the `<th>` element with minimal offset. This character is defined by the [`char`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/th#attr-char) and [`charoff`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/th#attr-charoff) attributes.\n\nThe default value when this attribute is not specified is `left`.\n\n**Note:** Do not use this attribute as it is obsolete in the latest standard.\n\n*   To achieve the same effect as the `left`, `center`, `right` or `justify` values, apply the CSS [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property to the element.\n*   To achieve the same effect as the `char` value, give the [`text-align`](https://developer.mozilla.org/en-US/docs/Web/CSS/text-align "The text-align CSS property sets the horizontal alignment of an inline or table-cell box. This means it works like vertical-align but in the horizontal direction.") property the same value you would use for the [`char`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/th#attr-char). Unimplemented in CSS3.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "axis",
          "description": "This attribute contains a list of space-separated strings. Each string is the `id` of a group of cells that this header applies to.\n\n**Note:** Do not use this attribute as it is obsolete in the latest standard: use the [`scope`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/th#attr-scope) attribute instead.",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "bgcolor",
          "description": 'This attribute defines the background color of each cell in a column. It consists of a 6-digit hexadecimal code as defined in [sRGB](https://www.w3.org/Graphics/Color/sRGB) and is prefixed by \'#\'. This attribute may be used with one of sixteen predefined color strings:\n\n\xA0\n\n`black` = "#000000"\n\n\xA0\n\n`green` = "#008000"\n\n\xA0\n\n`silver` = "#C0C0C0"\n\n\xA0\n\n`lime` = "#00FF00"\n\n\xA0\n\n`gray` = "#808080"\n\n\xA0\n\n`olive` = "#808000"\n\n\xA0\n\n`white` = "#FFFFFF"\n\n\xA0\n\n`yellow` = "#FFFF00"\n\n\xA0\n\n`maroon` = "#800000"\n\n\xA0\n\n`navy` = "#000080"\n\n\xA0\n\n`red` = "#FF0000"\n\n\xA0\n\n`blue` = "#0000FF"\n\n\xA0\n\n`purple` = "#800080"\n\n\xA0\n\n`teal` = "#008080"\n\n\xA0\n\n`fuchsia` = "#FF00FF"\n\n\xA0\n\n`aqua` = "#00FFFF"\n\n**Note:** Do not use this attribute, as it is non-standard and only implemented in some versions of Microsoft Internet Explorer: The [`<th>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/th "The HTML <th> element defines a cell as header of a group of table cells. The exact nature of this group is defined by the scope and headers attributes.") element should be styled using [CSS](https://developer.mozilla.org/en-US/docs/Web/CSS). To create a similar effect use the [`background-color`](https://developer.mozilla.org/en-US/docs/Web/CSS/background-color "The background-color CSS property sets the background color of an element.") property in [CSS](https://developer.mozilla.org/en-US/docs/Web/CSS) instead.',
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/th"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "form",
      "description": {
        "kind": "markdown",
        "value": "The form element represents a collection of form-associated elements, some of which can represent editable values that can be submitted to a server for processing."
      },
      "attributes": [
        {
          "name": "accept-charset",
          "description": {
            "kind": "markdown",
            "value": 'A space- or comma-delimited list of character encodings that the server accepts. The browser uses them in the order in which they are listed. The default value, the reserved string `"UNKNOWN"`, indicates the same encoding as that of the document containing the form element.  \nIn previous versions of HTML, the different character encodings could be delimited by spaces or commas. In HTML5, only spaces are allowed as delimiters.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "action",
          "description": {
            "kind": "markdown",
            "value": 'The URI of a program that processes the form information. This value can be overridden by a [`formaction`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button#attr-formaction) attribute on a [`<button>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button "The HTML <button> element represents a clickable button, which can be used in forms or anywhere in a document that needs simple, standard button functionality.") or [`<input>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input "The HTML <input> element is used to create interactive controls for web-based forms in order to accept data from the user; a wide variety of types of input data and control widgets are available, depending on the device and user agent.") element.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "autocomplete",
          "valueSet": "o",
          "description": {
            "kind": "markdown",
            "value": "Indicates whether input elements can by default have their values automatically completed by the browser. This setting can be overridden by an `autocomplete` attribute on an element belonging to the form. Possible values are:\n\n*   `off`: The user must explicitly enter a value into each field for every use, or the document provides its own auto-completion method; the browser does not automatically complete entries.\n*   `on`: The browser can automatically complete values based on values that the user has previously entered in the form.\n\nFor most modern browsers (including Firefox 38+, Google Chrome 34+, IE 11+) setting the autocomplete attribute will not prevent a browser's password manager from asking the user if they want to store login fields (username and password), if the user permits the storage the browser will autofill the login the next time the user visits the page. See [The autocomplete attribute and login fields](https://developer.mozilla.org/en-US/docs/Web/Security/Securing_your_site/Turning_off_form_autocompletion#The_autocomplete_attribute_and_login_fields).\n**Note:** If you set `autocomplete` to `off` in a form because the document provides its own auto-completion, then you should also set `autocomplete` to `off` for each of the form's `input` elements that the document can auto-complete. For details, see the note regarding Google Chrome in the [Browser Compatibility chart](#compatChart)."
          },
          "browsers": [
            "C14",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "enctype",
          "valueSet": "et",
          "description": {
            "kind": "markdown",
            "value": 'When the value of the `method` attribute is `post`, enctype is the [MIME type](https://en.wikipedia.org/wiki/Mime_type) of content that is used to submit the form to the server. Possible values are:\n\n*   `application/x-www-form-urlencoded`: The default value if the attribute is not specified.\n*   `multipart/form-data`: The value used for an [`<input>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input "The HTML <input> element is used to create interactive controls for web-based forms in order to accept data from the user; a wide variety of types of input data and control widgets are available, depending on the device and user agent.") element with the `type` attribute set to "file".\n*   `text/plain`: (HTML5)\n\nThis value can be overridden by a [`formenctype`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button#attr-formenctype) attribute on a [`<button>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button "The HTML <button> element represents a clickable button, which can be used in forms or anywhere in a document that needs simple, standard button functionality.") or [`<input>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input "The HTML <input> element is used to create interactive controls for web-based forms in order to accept data from the user; a wide variety of types of input data and control widgets are available, depending on the device and user agent.") element.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "method",
          "valueSet": "m",
          "description": {
            "kind": "markdown",
            "value": 'The [HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP) method that the browser uses to submit the form. Possible values are:\n\n*   `post`: Corresponds to the HTTP [POST method](https://www.w3.org/Protocols/rfc2616/rfc2616-sec9.html#sec9.5) ; form data are included in the body of the form and sent to the server.\n*   `get`: Corresponds to the HTTP [GET method](https://www.w3.org/Protocols/rfc2616/rfc2616-sec9.html#sec9.3); form data are appended to the `action` attribute URI with a \'?\' as separator, and the resulting URI is sent to the server. Use this method when the form has no side-effects and contains only ASCII characters.\n*   `dialog`: Use when the form is inside a\xA0[`<dialog>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog "The HTML <dialog> element represents a dialog box or other interactive component, such as an inspector or window.") element to close the dialog when submitted.\n\nThis value can be overridden by a [`formmethod`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button#attr-formmethod) attribute on a [`<button>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button "The HTML <button> element represents a clickable button, which can be used in forms or anywhere in a document that needs simple, standard button functionality.") or [`<input>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input "The HTML <input> element is used to create interactive controls for web-based forms in order to accept data from the user; a wide variety of types of input data and control widgets are available, depending on the device and user agent.") element.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "name",
          "description": {
            "kind": "markdown",
            "value": "The name of the form. In HTML 4, its use is deprecated (`id` should be used instead). It must be unique among the forms in a document and not just an empty string in HTML 5."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "novalidate",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": 'This Boolean attribute indicates that the form is not to be validated when submitted. If this attribute is not specified (and therefore the form is validated), this default setting can be overridden by a [`formnovalidate`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button#attr-formnovalidate) attribute on a [`<button>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button "The HTML <button> element represents a clickable button, which can be used in forms or anywhere in a document that needs simple, standard button functionality.") or [`<input>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input "The HTML <input> element is used to create interactive controls for web-based forms in order to accept data from the user; a wide variety of types of input data and control widgets are available, depending on the device and user agent.") element belonging to the form.'
          },
          "browsers": [
            "C10",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S10.1",
            "SM10.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2017-03-27",
            "baseline_high_date": "2019-09-27"
          }
        },
        {
          "name": "target",
          "valueSet": "target",
          "description": {
            "kind": "markdown",
            "value": 'A name or keyword indicating where to display the response that is received after submitting the form. In HTML 4, this is the name/keyword for a frame. In HTML5, it is a name/keyword for a _browsing context_ (for example, tab, window, or inline frame). The following keywords have special meanings:\n\n*   `_self`: Load the response into the same HTML 4 frame (or HTML5 browsing context) as the current one. This value is the default if the attribute is not specified.\n*   `_blank`: Load the response into a new unnamed HTML 4 window or HTML5 browsing context.\n*   `_parent`: Load the response into the HTML 4 frameset parent of the current frame, or HTML5 parent browsing context of the current one. If there is no parent, this option behaves the same way as `_self`.\n*   `_top`: HTML 4: Load the response into the full original window, and cancel all other frames. HTML5: Load the response into the top-level browsing context (i.e., the browsing context that is an ancestor of the current one, and has no parent). If there is no parent, this option behaves the same way as `_self`.\n*   _iframename_: The response is displayed in a named [`<iframe>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe "The HTML Inline Frame element (<iframe>) represents a nested browsing context, embedding another HTML page into the current one.").\n\nHTML5: This value can be overridden by a [`formtarget`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button#attr-formtarget) attribute on a [`<button>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button "The HTML <button> element represents a clickable button, which can be used in forms or anywhere in a document that needs simple, standard button functionality.") or [`<input>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input "The HTML <input> element is used to create interactive controls for web-based forms in order to accept data from the user; a wide variety of types of input data and control widgets are available, depending on the device and user agent.") element.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "accept",
          "description": 'A comma-separated list of content types that the server accepts.\n\n**Usage note:** This attribute has been removed in HTML5 and should no longer be used. Instead, use the [`accept`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#attr-accept) attribute of the specific [`<input>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input "The HTML <input> element is used to create interactive controls for web-based forms in order to accept data from the user; a wide variety of types of input data and control widgets are available, depending on the device and user agent.") element.'
        },
        {
          "name": "autocapitalize",
          "description": "This is a nonstandard attribute used by iOS Safari Mobile which controls whether and how the text value for textual form control descendants should be automatically capitalized as it is entered/edited by the user. If the `autocapitalize` attribute is specified on an individual form control descendant, it trumps the form-wide `autocapitalize` setting. The non-deprecated values are available in iOS 5 and later. The default value is `sentences`. Possible values are:\n\n*   `none`: Completely disables automatic capitalization\n*   `sentences`: Automatically capitalize the first letter of sentences.\n*   `words`: Automatically capitalize the first letter of words.\n*   `characters`: Automatically capitalize all characters.\n*   `on`: Deprecated since iOS 5.\n*   `off`: Deprecated since iOS 5."
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/form"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S3",
        "SM2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "label",
      "description": {
        "kind": "markdown",
        "value": "The label element represents a caption in a user interface. The caption can be associated with a specific form control, known as the label element's labeled control, either using the for attribute, or by putting the form control inside the label element itself."
      },
      "attributes": [
        {
          "name": "form",
          "description": {
            "kind": "markdown",
            "value": 'The [`<form>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form "The HTML <form> element represents a document section that contains interactive controls for submitting information to a web server.") element with which the label is associated (its _form owner_). If specified, the value of the attribute is the `id` of a [`<form>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form "The HTML <form> element represents a document section that contains interactive controls for submitting information to a web server.") element in the same document. This lets you place label elements anywhere within a document, not just as descendants of their form elements.'
          }
        },
        {
          "name": "for",
          "description": {
            "kind": "markdown",
            "value": "The [`id`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes#attr-id) of a [labelable](https://developer.mozilla.org/en-US/docs/Web/Guide/HTML/Content_categories#Form_labelable) form-related element in the same document as the `<label>` element. The first element in the document with an `id` matching the value of the `for` attribute is the _labeled control_ for this label element, if it is a labelable element. If it is\xA0not labelable then the `for` attribute has no effect. If there are other elements which also match the `id` value, later in the document, they are not considered.\n\n**Note**: A `<label>` element can have both a `for` attribute and a contained control element, as long as the `for` attribute points to the contained control element."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/label"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "input",
      "description": {
        "kind": "markdown",
        "value": "The input element represents a typed data field, usually with a form control to allow the user to edit the data."
      },
      "void": true,
      "attributes": [
        {
          "name": "accept",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "alt",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "autocomplete",
          "valueSet": "inputautocomplete",
          "browsers": [
            "C14",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "autofocus",
          "valueSet": "v"
        },
        {
          "name": "checked",
          "valueSet": "v",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "dirname",
          "browsers": [
            "C17",
            "CA18",
            "E79",
            "FF116",
            "FFA116",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2023-08-01",
            "baseline_high_date": "2026-02-01"
          }
        },
        {
          "name": "disabled",
          "valueSet": "v",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "form",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "formaction",
          "browsers": [
            "C9",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5",
            "SM4.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "formenctype",
          "valueSet": "et",
          "browsers": [
            "C9",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5",
            "SM4.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "formmethod",
          "valueSet": "fm",
          "browsers": [
            "C9",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5",
            "SM4.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "formnovalidate",
          "valueSet": "v",
          "browsers": [
            "C4",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5",
            "SM4"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "formtarget",
          "browsers": [
            "C9",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5",
            "SM4.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "height"
        },
        {
          "name": "inputmode",
          "valueSet": "im"
        },
        {
          "name": "list"
        },
        {
          "name": "max",
          "browsers": [
            "C4",
            "CA18",
            "E12",
            "FF16",
            "FFA16",
            "S5",
            "SM4"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "maxlength",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "min",
          "browsers": [
            "C4",
            "CA18",
            "E12",
            "FF16",
            "FFA16",
            "S5",
            "SM4"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "minlength",
          "browsers": [
            "C40",
            "CA40",
            "E17",
            "FF51",
            "FFA51",
            "S10.1",
            "SM10.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2018-04-30",
            "baseline_high_date": "2020-10-30"
          }
        },
        {
          "name": "multiple",
          "valueSet": "v",
          "browsers": [
            "C2",
            "CA18",
            "E12",
            "FF3.6",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "name",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "pattern",
          "browsers": [
            "C4",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5",
            "SM4"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "placeholder",
          "browsers": [
            "C3",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "popovertarget",
          "browsers": [
            "C114",
            "CA114",
            "E114",
            "FF125",
            "FFA125",
            "S17",
            "SM17"
          ],
          "status": {
            "baseline": "low",
            "baseline_low_date": "2024-04-16"
          }
        },
        {
          "name": "popovertargetaction",
          "browsers": [
            "C114",
            "CA114",
            "E114",
            "FF125",
            "FFA125",
            "S17",
            "SM17"
          ],
          "status": {
            "baseline": "low",
            "baseline_low_date": "2024-04-16"
          }
        },
        {
          "name": "readonly",
          "valueSet": "v",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "required",
          "valueSet": "v",
          "browsers": [
            "C4",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5",
            "SM4"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "size",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "src",
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S1",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "step",
          "browsers": [
            "C5",
            "CA18",
            "E12",
            "FF16",
            "FFA16",
            "S5",
            "SM4"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "type",
          "valueSet": "t"
        },
        {
          "name": "value"
        },
        {
          "name": "width"
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/input"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "button",
      "description": {
        "kind": "markdown",
        "value": "The button element represents a button labeled by its contents."
      },
      "attributes": [
        {
          "name": "autofocus",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "This Boolean attribute lets you specify that the button should have input focus when the page loads, unless the user overrides it, for example by typing in a different control. Only one form-associated element in a document can have this attribute specified."
          }
        },
        {
          "name": "disabled",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": 'This Boolean attribute indicates that the user cannot interact with the button. If this attribute is not specified, the button inherits its setting from the containing element, for example [`<fieldset>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/fieldset "The HTML <fieldset> element is used to group several controls as well as labels (<label>) within a web form."); if there is no containing element with the **disabled** attribute set, then the button is enabled.\n\nFirefox will, unlike other browsers, by default, [persist the dynamic disabled state](https://stackoverflow.com/questions/5985839/bug-with-firefox-disabled-attribute-of-input-not-resetting-when-refreshing) of a [`<button>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button "The HTML <button> element represents a clickable button, which can be used in forms or anywhere in a document that needs simple, standard button functionality.") across page loads. Use the [`autocomplete`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button#attr-autocomplete) attribute to control this feature.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "form",
          "description": {
            "kind": "markdown",
            "value": 'The form element that the button is associated with (its _form owner_). The value of the attribute must be the **id** attribute of a [`<form>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form "The HTML <form> element represents a document section that contains interactive controls for submitting information to a web server.") element in the same document. If this attribute is not specified, the `<button>` element will be associated to an ancestor [`<form>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form "The HTML <form> element represents a document section that contains interactive controls for submitting information to a web server.") element, if one exists. This attribute enables you to associate `<button>` elements to [`<form>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form "The HTML <form> element represents a document section that contains interactive controls for submitting information to a web server.") elements anywhere within a document, not just as descendants of [`<form>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form "The HTML <form> element represents a document section that contains interactive controls for submitting information to a web server.") elements.'
          },
          "browsers": [
            "C9",
            "CA18",
            "E16",
            "FF4",
            "FFA4",
            "S5.1",
            "SM5"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2017-10-17",
            "baseline_high_date": "2020-04-17"
          }
        },
        {
          "name": "formaction",
          "description": {
            "kind": "markdown",
            "value": "The URI of a program that processes the information submitted by the button. If specified, it overrides the [`action`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form#attr-action) attribute of the button's form owner."
          },
          "browsers": [
            "C9",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5.1",
            "SM5"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "formenctype",
          "valueSet": "et",
          "description": {
            "kind": "markdown",
            "value": 'If the button is a submit button, this attribute specifies the type of content that is used to submit the form to the server. Possible values are:\n\n*   `application/x-www-form-urlencoded`: The default value if the attribute is not specified.\n*   `multipart/form-data`: Use this value if you are using an [`<input>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input "The HTML <input> element is used to create interactive controls for web-based forms in order to accept data from the user; a wide variety of types of input data and control widgets are available, depending on the device and user agent.") element with the [`type`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#attr-type) attribute set to `file`.\n*   `text/plain`\n\nIf this attribute is specified, it overrides the [`enctype`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form#attr-enctype) attribute of the button\'s form owner.'
          },
          "browsers": [
            "C9",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5.1",
            "SM5"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "formmethod",
          "valueSet": "fm",
          "description": {
            "kind": "markdown",
            "value": "If the button is a submit button, this attribute specifies the HTTP method that the browser uses to submit the form. Possible values are:\n\n*   `post`: The data from the form are included in the body of the form and sent to the server.\n*   `get`: The data from the form are appended to the **form** attribute URI, with a '?' as a separator, and the resulting URI is sent to the server. Use this method when the form has no side-effects and contains only ASCII characters.\n\nIf specified, this attribute overrides the [`method`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form#attr-method) attribute of the button's form owner."
          },
          "browsers": [
            "C9",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5.1",
            "SM5"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "formnovalidate",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "If the button is a submit button, this Boolean attribute specifies that the form is not to be validated when it is submitted. If this attribute is specified, it overrides the [`novalidate`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form#attr-novalidate) attribute of the button's form owner."
          },
          "browsers": [
            "C9",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5.1",
            "SM5"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "formtarget",
          "description": {
            "kind": "markdown",
            "value": "If the button is a submit button, this attribute is a name or keyword indicating where to display the response that is received after submitting the form. This is a name of, or keyword for, a _browsing context_ (for example, tab, window, or inline frame). If this attribute is specified, it overrides the [`target`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form#attr-target) attribute of the button's form owner. The following keywords have special meanings:\n\n*   `_self`: Load the response into the same browsing context as the current one. This value is the default if the attribute is not specified.\n*   `_blank`: Load the response into a new unnamed browsing context.\n*   `_parent`: Load the response into the parent browsing context of the current one. If there is no parent, this option behaves the same way as `_self`.\n*   `_top`: Load the response into the top-level browsing context (that is, the browsing context that is an ancestor of the current one, and has no parent). If there is no parent, this option behaves the same way as `_self`."
          },
          "browsers": [
            "C9",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5.1",
            "SM5"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "name",
          "description": {
            "kind": "markdown",
            "value": "The name of the button, which is submitted with the form data."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "popovertarget",
          "description": {
            "kind": "markdown",
            "value": "Turns the button into a popover control button; takes the ID of the popover element to control as its value."
          },
          "browsers": [
            "C114",
            "CA114",
            "E114",
            "FF125",
            "FFA125",
            "S17",
            "SM17"
          ],
          "status": {
            "baseline": "low",
            "baseline_low_date": "2024-04-16"
          }
        },
        {
          "name": "popovertargetaction",
          "description": {
            "kind": "markdown",
            "value": "Specifies the action to be performed on a popover element being controlled by the button."
          },
          "browsers": [
            "C114",
            "CA114",
            "E114",
            "FF125",
            "FFA125",
            "S17",
            "SM17"
          ],
          "status": {
            "baseline": "low",
            "baseline_low_date": "2024-04-16"
          }
        },
        {
          "name": "type",
          "valueSet": "bt",
          "description": {
            "kind": "markdown",
            "value": "The type of the button. Possible values are:\n\n*   `submit`: The button submits the form data to the server. This is the default if the attribute is not specified, or if the attribute is dynamically changed to an empty or invalid value.\n*   `reset`: The button resets all the controls to their initial values.\n*   `button`: The button has no default behavior. It can have client-side scripts associated with the element's events, which are triggered when the events occur."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "value",
          "description": {
            "kind": "markdown",
            "value": "The initial value of the button. It defines the value associated with the button which is submitted with the form data. This value is passed to the server in params when the form is submitted."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "autocomplete",
          "description": 'The use of this attribute on a [`<button>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button "The HTML <button> element represents a clickable button, which can be used in forms or anywhere in a document that needs simple, standard button functionality.") is nonstandard and Firefox-specific. By default, unlike other browsers, [Firefox persists the dynamic disabled state](https://stackoverflow.com/questions/5985839/bug-with-firefox-disabled-attribute-of-input-not-resetting-when-refreshing) of a [`<button>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button "The HTML <button> element represents a clickable button, which can be used in forms or anywhere in a document that needs simple, standard button functionality.") across page loads. Setting the value of this attribute to `off` (i.e. `autocomplete="off"`) disables this feature. See [bug\xA0654072](https://bugzilla.mozilla.org/show_bug.cgi?id=654072 "if disabled state is changed with javascript, the normal state doesn\'t return after refreshing the page").'
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/button"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "select",
      "description": {
        "kind": "markdown",
        "value": "The select element represents a control for selecting amongst a set of options."
      },
      "attributes": [
        {
          "name": "autocomplete",
          "valueSet": "inputautocomplete",
          "description": {
            "kind": "markdown",
            "value": 'A [`DOMString`](https://developer.mozilla.org/en-US/docs/Web/API/DOMString "DOMString is a UTF-16 String. As JavaScript already uses such strings, DOMString is mapped directly to a String.") providing a hint for a [user agent\'s](https://developer.mozilla.org/en-US/docs/Glossary/user_agent "user agent\'s: A user agent is a computer program representing a person, for example, a browser in a Web context.") autocomplete feature. See [The HTML autocomplete attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete) for a complete list of values and details on how to use autocomplete.'
          },
          "browsers": [
            "C66",
            "CA66",
            "E79",
            "FF59",
            "FFA59",
            "S9.1",
            "SM9.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-01-15",
            "baseline_high_date": "2022-07-15"
          }
        },
        {
          "name": "autofocus",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "This Boolean attribute lets you specify that a form control should have input focus when the page loads. Only one form element in a document can have the `autofocus` attribute."
          }
        },
        {
          "name": "disabled",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "This Boolean attribute indicates that the user cannot interact with the control. If this attribute is not specified, the control inherits its setting from the containing element, for example `fieldset`; if there is no containing element with the `disabled` attribute set, then the control is enabled."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "form",
          "description": {
            "kind": "markdown",
            "value": 'This attribute lets you specify the form element to\xA0which\xA0the select element is associated\xA0(that is, its "form owner"). If this attribute is specified, its value must be the same as the `id` of a form element in the same document. This enables you to place select elements anywhere within a document, not just as descendants of their form elements.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "multiple",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "This Boolean attribute indicates that multiple options can be selected in the list. If it is not specified, then only one option can be selected at a time. When `multiple` is specified, most browsers will show a scrolling list box instead of a single line dropdown."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "name",
          "description": {
            "kind": "markdown",
            "value": "This attribute is used to specify the name of the control."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "required",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "A Boolean attribute indicating that an option with a non-empty string value must be selected."
          },
          "browsers": [
            "C10",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5.1",
            "SM5"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "size",
          "description": {
            "kind": "markdown",
            "value": "If the control is presented as a scrolling list box (e.g. when `multiple` is specified), this attribute represents the number of rows in the list that should be visible at one time. Browsers are not required to present a select element as a scrolled list box. The default value is 0.\n\n**Note:** According to the HTML5 specification, the default value for size should be 1; however, in practice, this has been found to break some web sites, and no other browser currently does that, so Mozilla has opted to continue to return 0 for the time being with Firefox."
          },
          "browsers": [
            "C1",
            "E12",
            "FF1",
            "FFA4",
            "S3"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/select"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "datalist",
      "description": {
        "kind": "markdown",
        "value": "The datalist element represents a set of option elements that represent predefined options for other controls. In the rendering, the datalist element represents nothing and it, along with its children, should be hidden."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/datalist"
        }
      ],
      "browsers": [
        "C20",
        "CA33",
        "E12",
        "FF4",
        "S12.1",
        "SM12.2"
      ],
      "status": {
        "baseline": false
      }
    },
    {
      "name": "optgroup",
      "description": {
        "kind": "markdown",
        "value": "The optgroup element represents a group of option elements with a common label."
      },
      "attributes": [
        {
          "name": "disabled",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "If this Boolean attribute is set, none of the items in this option group is selectable. Often browsers grey out such control and it won't receive any browsing events, like mouse clicks or focus-related ones."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S7"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "label",
          "description": {
            "kind": "markdown",
            "value": "The name of the group of options, which the browser can use when labeling the options in the user interface. This attribute is mandatory if this element is used."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/optgroup"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "option",
      "description": {
        "kind": "markdown",
        "value": "The option element represents an option in a select element or as part of a list of suggestions in a datalist element."
      },
      "attributes": [
        {
          "name": "disabled",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": 'If this Boolean attribute is set, this option is not checkable. Often browsers grey out such control and it won\'t receive any browsing event, like mouse clicks or focus-related ones. If this attribute is not set, the element can still be disabled if one of its ancestors is a disabled [`<optgroup>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/optgroup "The HTML <optgroup> element creates a grouping of options within a <select> element.") element.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "label",
          "description": {
            "kind": "markdown",
            "value": "This attribute is text for the label indicating the meaning of the option. If the `label` attribute isn't defined, its value is that of the element text content."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "selected",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": 'If present, this Boolean attribute indicates that the option is initially selected. If the `<option>` element is the descendant of a [`<select>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/select "The HTML <select> element represents a control that provides a menu of options") element whose [`multiple`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/select#attr-multiple) attribute is not set, only one single `<option>` of this [`<select>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/select "The HTML <select> element represents a control that provides a menu of options") element may have the `selected` attribute.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "value",
          "description": {
            "kind": "markdown",
            "value": "The content of this attribute represents the value to be submitted with the form, should this option be selected.\xA0If this attribute is omitted, the value is taken from the text content of the option element."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/option"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "textarea",
      "description": {
        "kind": "markdown",
        "value": "The textarea element represents a multiline plain text edit control for the element's raw value. The contents of the control represent the control's default value."
      },
      "attributes": [
        {
          "name": "autocomplete",
          "valueSet": "inputautocomplete",
          "description": {
            "kind": "markdown",
            "value": 'This attribute indicates whether the value of the control can be automatically completed by the browser. Possible values are:\n\n*   `off`: The user must explicitly enter a value into this field for every use, or the document provides its own auto-completion method; the browser does not automatically complete the entry.\n*   `on`: The browser can automatically complete the value based on values that the user has entered during previous uses.\n\nIf the `autocomplete` attribute is not specified on a `<textarea>` element, then the browser uses the `autocomplete` attribute value of the `<textarea>` element\'s form owner. The form owner is either the [`<form>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form "The HTML <form> element represents a document section that contains interactive controls for submitting information to a web server.") element that this `<textarea>` element is a descendant of or the form element whose `id` is specified by the `form` attribute of the input element. For more information, see the [`autocomplete`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form#attr-autocomplete) attribute in [`<form>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form "The HTML <form> element represents a document section that contains interactive controls for submitting information to a web server.").'
          },
          "browsers": [
            "C66",
            "CA66",
            "E79",
            "FF59",
            "FFA59",
            "S9.1",
            "SM9.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-01-15",
            "baseline_high_date": "2022-07-15"
          }
        },
        {
          "name": "autofocus",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "This Boolean attribute lets you specify that a form control should have input focus when the page loads. Only one form-associated element in a document can have this attribute specified."
          }
        },
        {
          "name": "cols",
          "description": {
            "kind": "markdown",
            "value": "The visible width of the text control, in average character widths. If it is specified, it must be a positive integer. If it is not specified, the default value is `20`."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "dirname",
          "browsers": [
            "C17",
            "CA18",
            "E79",
            "FF116",
            "FFA116",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2023-08-01",
            "baseline_high_date": "2026-02-01"
          }
        },
        {
          "name": "disabled",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": 'This Boolean attribute indicates that the user cannot interact with the control. If this attribute is not specified, the control inherits its setting from the containing element, for example [`<fieldset>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/fieldset "The HTML <fieldset> element is used to group several controls as well as labels (<label>) within a web form."); if there is no containing element when the `disabled` attribute is set, the control is enabled.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "form",
          "description": {
            "kind": "markdown",
            "value": 'The form element that the `<textarea>` element is associated with (its "form owner"). The value of the attribute must be the `id` of a form element in the same document. If this attribute is not specified, the `<textarea>` element must be a descendant of a form element. This attribute enables you to place `<textarea>` elements anywhere within a document, not just as descendants of form elements.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "inputmode",
          "valueSet": "im"
        },
        {
          "name": "maxlength",
          "description": {
            "kind": "markdown",
            "value": "The maximum number of characters (unicode code points) that the user can enter. If this value isn't specified, the user can enter an unlimited number of characters."
          },
          "browsers": [
            "C4",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5",
            "SM4.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "minlength",
          "description": {
            "kind": "markdown",
            "value": "The minimum number of characters (unicode code points) required that the user should enter."
          },
          "browsers": [
            "C40",
            "CA40",
            "E17",
            "FF51",
            "FFA51",
            "S10.1",
            "SM10.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2018-04-30",
            "baseline_high_date": "2020-10-30"
          }
        },
        {
          "name": "name",
          "description": {
            "kind": "markdown",
            "value": "The name of the control."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "placeholder",
          "description": {
            "kind": "markdown",
            "value": 'A hint to the user of what can be entered in the control. Carriage returns or line-feeds within the placeholder text must be treated as line breaks when rendering the hint.\n\n**Note:** Placeholders should only be used to show an example of the type of data that should be entered into a form; they are _not_ a substitute for a proper [`<label>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/label "The HTML <label> element represents a caption for an item in a user interface.") element tied to the input. See [Labels and placeholders](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#Labels_and_placeholders "The HTML <input> element is used to create interactive controls for web-based forms in order to accept data from the user; a wide variety of types of input data and control widgets are available, depending on the device and user agent.") in [<input>: The Input (Form Input) element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input "The HTML <input> element is used to create interactive controls for web-based forms in order to accept data from the user; a wide variety of types of input data and control widgets are available, depending on the device and user agent.") for a full explanation.'
          },
          "browsers": [
            "C4",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5",
            "SM5"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "readonly",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "This Boolean attribute indicates that the user cannot modify the value of the control. Unlike the `disabled` attribute, the `readonly` attribute does not prevent the user from clicking or selecting in the control. The value of a read-only control is still submitted with the form."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "required",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "This attribute specifies that the user must fill in a value before submitting a form."
          },
          "browsers": [
            "C4",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S5",
            "SM5"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "rows",
          "description": {
            "kind": "markdown",
            "value": "The number of visible text lines for the control."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "wrap",
          "valueSet": "w",
          "description": {
            "kind": "markdown",
            "value": "Indicates how the control wraps text. Possible values are:\n\n*   `hard`: The browser automatically inserts line breaks (CR+LF) so that each line has no more than the width of the control; the `cols` attribute must also be specified for this to take effect.\n*   `soft`: The browser ensures that all line breaks in the value consist of a CR+LF pair, but does not insert any additional line breaks.\n*   `off` : Like `soft` but changes appearance to `white-space: pre` so line segments exceeding `cols` are not wrapped and the `<textarea>` becomes horizontally scrollable.\n\nIf this attribute is not specified, `soft` is its default value."
          },
          "browsers": [
            "C16",
            "CA18",
            "E12",
            "FF4",
            "FFA4",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "autocapitalize",
          "description": "This is a non-standard attribute supported by WebKit on iOS (therefore nearly all browsers running on iOS, including Safari, Firefox, and Chrome), which controls whether and how the text value should be automatically capitalized as it is entered/edited by the user. The non-deprecated values are available in iOS 5 and later. Possible values are:\n\n*   `none`: Completely disables automatic capitalization.\n*   `sentences`: Automatically capitalize the first letter of sentences.\n*   `words`: Automatically capitalize the first letter of words.\n*   `characters`: Automatically capitalize all characters.\n*   `on`: Deprecated since iOS 5.\n*   `off`: Deprecated since iOS 5."
        },
        {
          "name": "spellcheck",
          "description": "Specifies whether the `<textarea>` is subject to spell checking by the underlying browser/OS. the value can be:\n\n*   `true`: Indicates that the element needs to have its spelling and grammar checked.\n*   `default` : Indicates that the element is to act according to a default behavior, possibly based on the parent element's own `spellcheck` value.\n*   `false` : Indicates that the element should not be spell checked."
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/textarea"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "output",
      "description": {
        "kind": "markdown",
        "value": "The output element represents the result of a calculation performed by the application, or the result of a user action."
      },
      "attributes": [
        {
          "name": "for",
          "description": {
            "kind": "markdown",
            "value": "A space-separated list of other elements\u2019 [`id`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/id)s, indicating that those elements contributed input values to (or otherwise affected) the calculation."
          },
          "browsers": [
            "C10",
            "CA18",
            "E18",
            "FF4",
            "FFA4",
            "S7",
            "SM7"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "\u22642018-10-02",
            "baseline_high_date": "\u22642021-04-02"
          }
        },
        {
          "name": "form",
          "description": {
            "kind": "markdown",
            "value": 'The [form element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form) that this element is associated with (its "form owner"). The value of the attribute must be an `id` of a form element in the same document. If this attribute is not specified, the output element must be a descendant of a form element. This attribute enables you to place output elements anywhere within a document, not just as descendants of their form elements.'
          },
          "browsers": [
            "C10",
            "CA18",
            "E18",
            "FF4",
            "FFA4",
            "S7",
            "SM7"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "\u22642018-10-02",
            "baseline_high_date": "\u22642021-04-02"
          }
        },
        {
          "name": "name",
          "description": {
            "kind": "markdown",
            "value": 'The name of the element, exposed in the [`HTMLFormElement`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement "The HTMLFormElement interface represents a <form> element in the DOM; it allows access to and in some cases modification of aspects of the form, as well as access to its component elements.") API.'
          },
          "browsers": [
            "C10",
            "CA18",
            "E18",
            "FF4",
            "FFA4",
            "S7",
            "SM7"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "\u22642018-10-02",
            "baseline_high_date": "\u22642021-04-02"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/output"
        }
      ],
      "browsers": [
        "C10",
        "CA18",
        "E18",
        "FF4",
        "FFA4",
        "S7",
        "SM7"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "\u22642018-10-02",
        "baseline_high_date": "\u22642021-04-02"
      }
    },
    {
      "name": "progress",
      "description": {
        "kind": "markdown",
        "value": "The progress element represents the completion progress of a task. The progress is either indeterminate, indicating that progress is being made but that it is not clear how much more work remains to be done before the task is complete (e.g. because the task is waiting for a remote host to respond), or the progress is a number in the range zero to a maximum, giving the fraction of work that has so far been completed."
      },
      "attributes": [
        {
          "name": "value",
          "description": {
            "kind": "markdown",
            "value": "This attribute specifies how much of the task that has been completed. It must be a valid floating point number between 0 and `max`, or between 0 and 1 if `max` is omitted. If there is no `value` attribute, the progress bar is indeterminate; this indicates that an activity is ongoing with no indication of how long it is expected to take."
          },
          "browsers": [
            "C6",
            "CA18",
            "E12",
            "FF6",
            "FFA6",
            "S6",
            "SM7"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "max",
          "description": {
            "kind": "markdown",
            "value": "This attribute describes how much work the task indicated by the `progress` element requires. The `max` attribute, if present, must have a value greater than zero and be a valid floating point number. The default value is 1."
          },
          "browsers": [
            "C6",
            "CA18",
            "E12",
            "FF6",
            "FFA6",
            "S6",
            "SM7"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/progress"
        }
      ],
      "browsers": [
        "C6",
        "CA18",
        "E12",
        "FF6",
        "FFA6",
        "S6",
        "SM7"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "meter",
      "description": {
        "kind": "markdown",
        "value": "The meter element represents a scalar measurement within a known range, or a fractional value; for example disk usage, the relevance of a query result, or the fraction of a voting population to have selected a particular candidate."
      },
      "attributes": [
        {
          "name": "value",
          "description": {
            "kind": "markdown",
            "value": "The current numeric value. This must be between the minimum and maximum values (`min` attribute and `max` attribute) if they are specified. If unspecified or malformed, the value is 0. If specified, but not within the range given by the `min` attribute and `max` attribute, the value is equal to the nearest end of the range.\n\n**Usage note:** Unless the `value` attribute is between `0` and `1` (inclusive), the `min` and `max` attributes should define the range so that the `value` attribute's value is within it."
          },
          "browsers": [
            "C6",
            "CA18",
            "E13",
            "FF16",
            "FFA16",
            "S6",
            "SM10.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2017-03-27",
            "baseline_high_date": "2019-09-27"
          }
        },
        {
          "name": "min",
          "description": {
            "kind": "markdown",
            "value": "The lower numeric bound of the measured range. This must be less than the maximum value (`max` attribute), if specified. If unspecified, the minimum value is 0."
          },
          "browsers": [
            "C6",
            "CA18",
            "E13",
            "FF16",
            "FFA16",
            "S6",
            "SM10.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2017-03-27",
            "baseline_high_date": "2019-09-27"
          }
        },
        {
          "name": "max",
          "description": {
            "kind": "markdown",
            "value": "The upper numeric bound of the measured range. This must be greater than the minimum value (`min` attribute), if specified. If unspecified, the maximum value is 1."
          },
          "browsers": [
            "C6",
            "CA18",
            "E13",
            "FF16",
            "FFA16",
            "S6",
            "SM10.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2017-03-27",
            "baseline_high_date": "2019-09-27"
          }
        },
        {
          "name": "low",
          "description": {
            "kind": "markdown",
            "value": "The upper numeric bound of the low end of the measured range. This must be greater than the minimum value (`min` attribute), and it also must be less than the high value and maximum value (`high` attribute and `max` attribute, respectively), if any are specified. If unspecified, or if less than the minimum value, the `low` value is equal to the minimum value."
          },
          "browsers": [
            "C6",
            "CA18",
            "E13",
            "FF16",
            "FFA16",
            "S6",
            "SM10.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2017-03-27",
            "baseline_high_date": "2019-09-27"
          }
        },
        {
          "name": "high",
          "description": {
            "kind": "markdown",
            "value": "The lower numeric bound of the high end of the measured range. This must be less than the maximum value (`max` attribute), and it also must be greater than the low value and minimum value (`low` attribute and **min** attribute, respectively), if any are specified. If unspecified, or if greater than the maximum value, the `high` value is equal to the maximum value."
          },
          "browsers": [
            "C6",
            "CA18",
            "E13",
            "FF16",
            "FFA16",
            "S6",
            "SM10.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2017-03-27",
            "baseline_high_date": "2019-09-27"
          }
        },
        {
          "name": "optimum",
          "description": {
            "kind": "markdown",
            "value": "This attribute indicates the optimal numeric value. It must be within the range (as defined by the `min` attribute and `max` attribute). When used with the `low` attribute and `high` attribute, it gives an indication where along the range is considered preferable. For example, if it is between the `min` attribute and the `low` attribute, then the lower range is considered preferred."
          },
          "browsers": [
            "C6",
            "CA18",
            "E13",
            "FF16",
            "FFA16",
            "S6",
            "SM10.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2017-03-27",
            "baseline_high_date": "2019-09-27"
          }
        },
        {
          "name": "form",
          "description": "This attribute associates the element with a `form` element that has ownership of the `meter` element. For example, a `meter` might be displaying a range corresponding to an `input` element of `type` _number_. This attribute is only used if the `meter` element is being used as a form-associated element; even then, it may be omitted if the element appears as a descendant of a `form` element."
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/meter"
        }
      ],
      "browsers": [
        "C6",
        "CA18",
        "E13",
        "FF16",
        "FFA16",
        "S6",
        "SM10.3"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2017-03-27",
        "baseline_high_date": "2019-09-27"
      }
    },
    {
      "name": "fieldset",
      "description": {
        "kind": "markdown",
        "value": "The fieldset element represents a set of form controls optionally grouped under a common name."
      },
      "attributes": [
        {
          "name": "disabled",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "If this Boolean attribute is set, all form controls that are descendants of the `<fieldset>`, are disabled, meaning they are not editable and won't be submitted along with the `<form>`. They won't receive any browsing events, like mouse clicks or focus-related events. By default browsers display such controls grayed out. Note that form elements inside the [`<legend>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/legend \"The HTML <legend> element represents a caption for the content of its parent <fieldset>.\") element won't be disabled."
          },
          "browsers": [
            "C20",
            "CA25",
            "E79",
            "FF4",
            "FFA4",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-01-15",
            "baseline_high_date": "2022-07-15"
          }
        },
        {
          "name": "form",
          "description": {
            "kind": "markdown",
            "value": 'This attribute takes the value of the `id` attribute of a [`<form>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form "The HTML <form> element represents a document section that contains interactive controls for submitting information to a web server.") element you want the `<fieldset>` to be part of, even if it is not inside the form.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "name",
          "description": {
            "kind": "markdown",
            "value": 'The name associated with the group.\n\n**Note**: The caption for the fieldset is given by the first [`<legend>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/legend "The HTML <legend> element represents a caption for the content of its parent <fieldset>.") element nested inside it.'
          },
          "browsers": [
            "C19",
            "CA25",
            "E12",
            "FF4",
            "FFA4",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/fieldset"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "legend",
      "description": {
        "kind": "markdown",
        "value": "The legend element represents a caption for the rest of the contents of the legend element's parent fieldset element, if any."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/legend"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S3",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "details",
      "description": {
        "kind": "markdown",
        "value": "The details element represents a disclosure widget from which the user can obtain additional information or controls."
      },
      "attributes": [
        {
          "name": "open",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": "This Boolean attribute indicates whether or not the details \u2014 that is, the contents of the `<details>` element \u2014 are currently visible. The default, `false`, means the details are not visible."
          },
          "browsers": [
            "C12",
            "CA18",
            "E79",
            "FF49",
            "FFA49",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-01-15",
            "baseline_high_date": "2022-07-15"
          }
        },
        {
          "name": "name",
          "description": {
            "kind": "markdown",
            "value": "This attribute enables multiple `<details>` elements to be connected, with only one open at a time. This allows developers to easily create UI features such as accordions without scripting.\n\nThe `name` attribute specifies a group name \u2014 give multiple `<details>` elements the same `name` value to group them. Only one of the grouped `<details>` elements can be open at a time \u2014 opening one will cause another to close. If multiple grouped `<details>` elements are given the `open` attribute, only the first one in the source order will be rendered open.\n\n**Note**: `<details>` elements don't have to be adjacent to one another in the source to be part of the same group."
          },
          "browsers": [
            "C120",
            "CA120",
            "E120",
            "FF130",
            "FFA130",
            "S17.2",
            "SM17.2"
          ],
          "status": {
            "baseline": "low",
            "baseline_low_date": "2024-09-03"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/details"
        }
      ],
      "browsers": [
        "C12",
        "CA18",
        "E79",
        "FF49",
        "FFA49",
        "S6",
        "SM6"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2020-01-15",
        "baseline_high_date": "2022-07-15"
      }
    },
    {
      "name": "summary",
      "description": {
        "kind": "markdown",
        "value": "The summary element represents a summary, caption, or legend for the rest of the contents of the summary element's parent details element, if any."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/summary"
        }
      ],
      "browsers": [
        "C12",
        "CA18",
        "E79",
        "FF49",
        "FFA49",
        "S6",
        "SM6"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2020-01-15",
        "baseline_high_date": "2022-07-15"
      }
    },
    {
      "name": "dialog",
      "description": {
        "kind": "markdown",
        "value": "The dialog element represents a part of an application that a user interacts with to perform a task, for example a dialog box, inspector, or window."
      },
      "attributes": [
        {
          "name": "open",
          "description": "Indicates that the dialog is active and available for interaction. When the `open` attribute is not set, the dialog shouldn't be shown to the user.",
          "browsers": [
            "C37",
            "CA37",
            "E79",
            "FF98",
            "FFA98",
            "S15.4",
            "SM15.4"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2022-03-14",
            "baseline_high_date": "2024-09-14"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/dialog"
        }
      ],
      "browsers": [
        "C37",
        "CA37",
        "E79",
        "FF98",
        "FFA98",
        "S15.4",
        "SM15.4"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2022-03-14",
        "baseline_high_date": "2024-09-14"
      }
    },
    {
      "name": "script",
      "description": {
        "kind": "markdown",
        "value": "The script element allows authors to include dynamic script and data blocks in their documents. The element does not represent content for the user."
      },
      "attributes": [
        {
          "name": "src",
          "description": {
            "kind": "markdown",
            "value": "This attribute specifies the URI of an external script; this can be used as an alternative to embedding a script directly within a document.\n\nIf a `script` element has a `src` attribute specified, it should not have a script embedded inside its tags."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "type",
          "description": {
            "kind": "markdown",
            "value": 'This attribute indicates the type of script represented. The value of this attribute will be in one of the following categories:\n\n*   **Omitted or a JavaScript MIME type:** For HTML5-compliant browsers this indicates the script is JavaScript. HTML5 specification urges authors to omit the attribute rather than provide a redundant MIME type. In earlier browsers, this identified the scripting language of the embedded or imported (via the `src` attribute) code. JavaScript MIME types are [listed in the specification](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types#JavaScript_types).\n*   **`module`:** For HTML5-compliant browsers the code is treated as a JavaScript module. The processing of the script contents is not affected by the `charset` and `defer` attributes. For information on using `module`, see [ES6 in Depth: Modules](https://hacks.mozilla.org/2015/08/es6-in-depth-modules/). Code may behave differently when the `module` keyword is used.\n*   **Any other value:** The embedded content is treated as a data block which won\'t be processed by the browser. Developers must use a valid MIME type that is not a JavaScript MIME type to denote data blocks. The `src` attribute will be ignored.\n\n**Note:** in Firefox you could specify the version of JavaScript contained in a `<script>` element by including a non-standard `version` parameter inside the `type` attribute \u2014 for example `type="text/javascript;version=1.8"`. This has been removed in Firefox 59 (see [bug\xA01428745](https://bugzilla.mozilla.org/show_bug.cgi?id=1428745 "FIXED: Remove support for version parameter from script loader")).'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "charset"
        },
        {
          "name": "async",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": 'This is a Boolean attribute indicating that the browser should, if possible, load the script asynchronously.\n\nThis attribute must not be used if the `src` attribute is absent (i.e. for inline scripts). If it is included in this case it will have no effect.\n\nBrowsers usually assume the worst case scenario and load scripts synchronously, (i.e. `async="false"`) during HTML parsing.\n\nDynamically inserted scripts (using [`document.createElement()`](https://developer.mozilla.org/en-US/docs/Web/API/Document/createElement "In an HTML document, the document.createElement() method creates the HTML element specified by tagName, or an HTMLUnknownElement if tagName isn\'t recognized.")) load asynchronously by default, so to turn on synchronous loading (i.e. scripts load in the order they were inserted) set `async="false"`.\n\nSee [Browser compatibility](#Browser_compatibility) for notes on browser support. See also [Async scripts for asm.js](https://developer.mozilla.org/en-US/docs/Games/Techniques/Async_scripts).'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF3.6",
            "FFA4",
            "S4",
            "SM3.2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "defer",
          "valueSet": "v",
          "description": {
            "kind": "markdown",
            "value": 'This Boolean attribute is set to indicate to a browser that the script is meant to be executed after the document has been parsed, but before firing [`DOMContentLoaded`](https://developer.mozilla.org/en-US/docs/Web/Events/DOMContentLoaded "/en-US/docs/Web/Events/DOMContentLoaded").\n\nScripts with the `defer` attribute will prevent the `DOMContentLoaded` event from firing until the script has loaded and finished evaluating.\n\nThis attribute must not be used if the `src` attribute is absent (i.e. for inline scripts), in this case it would have no effect.\n\nTo achieve a similar effect for dynamically inserted scripts use `async="false"` instead. Scripts with the `defer` attribute will execute in the order in which they appear in the document.'
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF3.5",
            "FFA4",
            "S3",
            "SM2"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "crossorigin",
          "valueSet": "xo",
          "description": {
            "kind": "markdown",
            "value": 'Normal `script` elements pass minimal information to the [`window.onerror`](https://developer.mozilla.org/en-US/docs/Web/API/GlobalEventHandlers/onerror "The onerror property of the GlobalEventHandlers mixin is an EventHandler that processes error events.") for scripts which do not pass the standard [CORS](https://developer.mozilla.org/en-US/docs/Glossary/CORS "CORS: CORS (Cross-Origin Resource Sharing) is a system, consisting of transmitting HTTP headers, that determines whether browsers block frontend JavaScript code from accessing responses for cross-origin requests.") checks. To allow error logging for sites which use a separate domain for static media, use this attribute. See [CORS settings attributes](https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_settings_attributes) for a more descriptive explanation of its valid arguments.'
          },
          "browsers": [
            "C19",
            "CA25",
            "E14",
            "FF14",
            "FFA14",
            "S6",
            "SM6"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2016-08-02",
            "baseline_high_date": "2019-02-02"
          }
        },
        {
          "name": "nonce",
          "description": {
            "kind": "markdown",
            "value": "A cryptographic nonce (number used once) to list the allowed inline scripts in a [script-src Content-Security-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src). The server must generate a unique nonce value each time it transmits a policy. It is critical to provide a nonce that cannot be guessed as bypassing a resource's policy is otherwise trivial."
          }
        },
        {
          "name": "integrity",
          "description": "This attribute contains inline metadata that a user agent can use to verify that a fetched resource has been delivered free of unexpected manipulation. See [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity).",
          "browsers": [
            "C45",
            "CA45",
            "E17",
            "FF43",
            "FFA43",
            "S11.1",
            "SM11.3"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2018-04-30",
            "baseline_high_date": "2020-10-30"
          }
        },
        {
          "name": "nomodule",
          "description": "This Boolean attribute is set to indicate that the script should not be executed in browsers that support [ES2015 modules](https://hacks.mozilla.org/2015/08/es6-in-depth-modules/) \u2014 in effect, this can be used to serve fallback scripts to older browsers that do not support modular JavaScript code.",
          "browsers": [
            "C61",
            "CA61",
            "E16",
            "FF60",
            "FFA60",
            "S11",
            "SM11"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2018-05-09",
            "baseline_high_date": "2020-11-09"
          }
        },
        {
          "name": "referrerpolicy",
          "description": 'Indicates which [referrer](https://developer.mozilla.org/en-US/docs/Web/API/Document/referrer) to send when fetching the script, or resources fetched by the script:\n\n*   `no-referrer`: The [`Referer`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referer "The Referer request header contains the address of the previous web page from which a link to the currently requested page was followed. The Referer header allows servers to identify where people are visiting them from and may use that data for analytics, logging, or optimized caching, for example.") header will not be sent.\n*   `no-referrer-when-downgrade` (default): The [`Referer`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referer "The Referer request header contains the address of the previous web page from which a link to the currently requested page was followed. The Referer header allows servers to identify where people are visiting them from and may use that data for analytics, logging, or optimized caching, for example.") header will not be sent to [origin](https://developer.mozilla.org/en-US/docs/Glossary/origin "origin: Web content\'s origin is defined by the scheme (protocol), host (domain), and port of the URL used to access it. Two objects have the same origin only when the scheme, host, and port all match.")s without [TLS](https://developer.mozilla.org/en-US/docs/Glossary/TLS "TLS: Transport Layer Security (TLS), previously known as Secure Sockets Layer (SSL), is a protocol used by applications to communicate securely across a network, preventing tampering with and eavesdropping on email, web browsing, messaging, and other protocols.") ([HTTPS](https://developer.mozilla.org/en-US/docs/Glossary/HTTPS "HTTPS: HTTPS (HTTP Secure) is an encrypted version of the HTTP protocol. It usually uses SSL or TLS to encrypt all communication between a client and a server. This secure connection allows clients to safely exchange sensitive data with a server, for example for banking activities or online shopping.")).\n*   `origin`: The sent referrer will be limited to the origin of the referring page: its [scheme](https://developer.mozilla.org/en-US/docs/Archive/Mozilla/URIScheme), [host](https://developer.mozilla.org/en-US/docs/Glossary/host "host: A host is a device connected to the Internet (or a local network). Some hosts called servers offer additional services like serving webpages or storing files and emails."), and [port](https://developer.mozilla.org/en-US/docs/Glossary/port "port: For a computer connected to a network with an IP address, a port is a communication endpoint. Ports are designated by numbers, and below 1024 each port is associated by default with a specific protocol.").\n*   `origin-when-cross-origin`: The referrer sent to other origins will be limited to the scheme, the host, and the port. Navigations on the same origin will still include the path.\n*   `same-origin`: A referrer will be sent for [same origin](https://developer.mozilla.org/en-US/docs/Glossary/Same-origin_policy "same origin: The same-origin policy is a critical security mechanism that restricts how a document or script loaded from one origin can interact with a resource from another origin."), but cross-origin requests will contain no referrer information.\n*   `strict-origin`: Only send the origin of the document as the referrer when the protocol security level stays the same (e.g. HTTPS\u2192HTTPS), but don\'t send it to a less secure destination (e.g. HTTPS\u2192HTTP).\n*   `strict-origin-when-cross-origin`: Send a full URL when performing a same-origin request, but only send the origin when the protocol security level stays the same (e.g.HTTPS\u2192HTTPS), and send no header to a less secure destination (e.g. HTTPS\u2192HTTP).\n*   `unsafe-url`: The referrer will include the origin _and_ the path (but not the [fragment](https://developer.mozilla.org/en-US/docs/Web/API/HTMLHyperlinkElementUtils/hash), [password](https://developer.mozilla.org/en-US/docs/Web/API/HTMLHyperlinkElementUtils/password), or [username](https://developer.mozilla.org/en-US/docs/Web/API/HTMLHyperlinkElementUtils/username)). **This value is unsafe**, because it leaks origins and paths from TLS-protected resources to insecure origins.\n\n**Note**: An empty string value (`""`) is both the default value, and a fallback value if `referrerpolicy` is not supported. If `referrerpolicy` is not explicitly specified on the `<script>` element, it will adopt a higher-level referrer policy, i.e. one set on the whole document or domain. If a higher-level policy is not available,\xA0the empty string is treated as being equivalent to `no-referrer-when-downgrade`.',
          "browsers": [
            "C70",
            "CA70",
            "E79",
            "FF65",
            "FFA65",
            "S14",
            "SM14"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-09-16",
            "baseline_high_date": "2023-03-16"
          }
        },
        {
          "name": "text",
          "description": "Like the `textContent` attribute, this attribute sets the text content of the element. Unlike the `textContent` attribute, however, this attribute is evaluated as executable code after the node is inserted into the DOM."
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/script"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S3",
        "SM2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "noscript",
      "description": {
        "kind": "markdown",
        "value": "The noscript element represents nothing if scripting is enabled, and represents its children if scripting is disabled. It is used to present different markup to user agents that support scripting and those that don't support scripting, by affecting how the document is parsed."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/noscript"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S3",
        "SM2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "template",
      "description": {
        "kind": "markdown",
        "value": "The template element is used to declare fragments of HTML that can be cloned and inserted in the document by script."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/template"
        }
      ],
      "browsers": [
        "C26",
        "CA26",
        "E13",
        "FF22",
        "FFA22",
        "S8",
        "SM8"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-11-12",
        "baseline_high_date": "2018-05-12"
      }
    },
    {
      "name": "canvas",
      "description": {
        "kind": "markdown",
        "value": "The canvas element provides scripts with a resolution-dependent bitmap canvas, which can be used for rendering graphs, game graphics, art, or other visual images on the fly."
      },
      "attributes": [
        {
          "name": "width",
          "description": {
            "kind": "markdown",
            "value": "The width of the coordinate space in CSS pixels. Defaults to 300."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1.5",
            "FFA4",
            "S2",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "height",
          "description": {
            "kind": "markdown",
            "value": "The height of the coordinate space in CSS pixels. Defaults to 150."
          },
          "browsers": [
            "C1",
            "CA18",
            "E12",
            "FF1.5",
            "FFA4",
            "S2",
            "SM1"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2015-07-29",
            "baseline_high_date": "2018-01-29"
          }
        },
        {
          "name": "moz-opaque",
          "description": "Lets the canvas know whether or not translucency will be a factor. If the canvas knows there's no translucency, painting performance can be optimized. This is only supported by Mozilla-based browsers; use the standardized [`canvas.getContext('2d', { alpha: false })`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext \"The HTMLCanvasElement.getContext() method returns a drawing context on the canvas, or null if the context identifier is not supported.\") instead.",
          "browsers": [
            "FF3.5",
            "FFA4"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/canvas"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1.5",
        "FFA4",
        "S2",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "slot",
      "description": {
        "kind": "markdown",
        "value": "The slot element is a placeholder inside a web component that you can fill with your own markup, which lets you create separate DOM trees and present them together."
      },
      "attributes": [
        {
          "name": "name",
          "description": {
            "kind": "markdown",
            "value": "The slot's name.\nA **named slot** is a `<slot>` element with a `name` attribute."
          },
          "browsers": [
            "C53",
            "CA53",
            "E79",
            "FF63",
            "FFA63",
            "S10",
            "SM10"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2020-01-15",
            "baseline_high_date": "2022-07-15"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/slot"
        }
      ],
      "browsers": [
        "C53",
        "CA53",
        "E79",
        "FF63",
        "FFA63",
        "S10",
        "SM10"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2020-01-15",
        "baseline_high_date": "2022-07-15"
      }
    },
    {
      "name": "data",
      "description": {
        "kind": "markdown",
        "value": "The data element links a given piece of content with a machine-readable translation."
      },
      "attributes": [
        {
          "name": "value",
          "description": {
            "kind": "markdown",
            "value": "This attribute specifies the machine-readable translation of the content of the element."
          },
          "browsers": [
            "C62",
            "CA62",
            "E14",
            "FF22",
            "FFA22",
            "S10",
            "SM10"
          ],
          "status": {
            "baseline": "high",
            "baseline_low_date": "2017-10-24",
            "baseline_high_date": "2020-04-24"
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/data"
        }
      ],
      "browsers": [
        "C62",
        "CA62",
        "E14",
        "FF22",
        "FFA22",
        "S10",
        "SM10"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2017-10-24",
        "baseline_high_date": "2020-04-24"
      }
    },
    {
      "name": "hgroup",
      "description": {
        "kind": "markdown",
        "value": "The hgroup element represents a heading and related content. It groups a single h1\u2013h6 element with one or more p."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/hgroup"
        }
      ],
      "browsers": [
        "C5",
        "CA18",
        "E12",
        "FF4",
        "FFA4",
        "S5",
        "SM4.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "menu",
      "description": {
        "kind": "markdown",
        "value": "The menu element represents an unordered list of interactive items."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/menu"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S3",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "search",
      "description": {
        "kind": "markdown",
        "value": "The search element represents the parts of the document or application with form controls or other content related to performing a search or filtering operation."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/search"
        }
      ],
      "browsers": [
        "C118",
        "CA118",
        "E118",
        "FF118",
        "FFA118",
        "S17",
        "SM17"
      ],
      "status": {
        "baseline": "low",
        "baseline_low_date": "2023-10-13"
      }
    },
    {
      "name": "fencedframe",
      "description": {
        "kind": "markdown",
        "value": "The fencedframe element represents a nested browsing context, embedding another HTML page into the current one."
      },
      "attributes": [
        {
          "name": "allow",
          "browsers": [
            "C126",
            "CA126",
            "E126"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "height",
          "browsers": [
            "C126",
            "CA126",
            "E126"
          ],
          "status": {
            "baseline": false
          }
        },
        {
          "name": "width",
          "browsers": [
            "C126",
            "CA126",
            "E126"
          ],
          "status": {
            "baseline": false
          }
        }
      ],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/fencedframe"
        }
      ],
      "browsers": [
        "C126",
        "CA126",
        "E126"
      ],
      "status": {
        "baseline": false
      }
    },
    {
      "name": "selectedcontent",
      "description": {
        "kind": "markdown",
        "value": "The selectedcontent element can be used to display the content of the currently selected option element inside of a closed select element."
      },
      "attributes": [],
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Elements/selectedcontent"
        }
      ],
      "browsers": [
        "C135",
        "CA135",
        "E135"
      ],
      "status": {
        "baseline": false
      }
    }
  ],
  "globalAttributes": [
    {
      "name": "accesskey",
      "description": {
        "kind": "markdown",
        "value": "Provides a hint for generating a keyboard shortcut for the current element. This attribute consists of a space-separated list of characters. The browser should use the first one that exists on the computer keyboard layout."
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/accesskey"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "autocapitalize",
      "description": {
        "kind": "markdown",
        "value": "Controls whether and how text input is automatically capitalized as it is entered/edited by the user. It can have the following values:\n\n*   `off` or `none`, no autocapitalization is applied (all letters default to lowercase)\n*   `on` or `sentences`, the first letter of each sentence defaults to a capital letter; all other letters default to lowercase\n*   `words`, the first letter of each word defaults to a capital letter; all other letters default to lowercase\n*   `characters`, all letters should default to uppercase"
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/autocapitalize"
        }
      ],
      "browsers": [
        "C43",
        "CA43",
        "E79",
        "FF111",
        "FFA111",
        "SM5"
      ],
      "status": {
        "baseline": false
      }
    },
    {
      "name": "autocorrect",
      "description": {
        "kind": "markdown",
        "value": "Controls whether autocorrection of editable text is enabled for spelling and/or punctuation errors."
      },
      "valueSet": "o",
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/autocorrect"
        }
      ],
      "browsers": [
        "FF136",
        "FFA136",
        "S14.1",
        "SM14.5"
      ],
      "status": {
        "baseline": false
      }
    },
    {
      "name": "autofocus",
      "description": {
        "kind": "markdown",
        "value": "Indicates that an element should be focused on page load, or when the [`<dialog>`](https://developer.mozilla.org/docs/Web/HTML/Element/dialog) that it is part of is displayed."
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/autofocus"
        }
      ],
      "browsers": [
        "C79",
        "CA79",
        "E79",
        "FF110",
        "FFA110",
        "S15.4",
        "SM16.4"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2023-03-27",
        "baseline_high_date": "2025-09-27"
      }
    },
    {
      "name": "class",
      "description": {
        "kind": "markdown",
        "value": 'A space-separated list of the classes of the element. Classes allows CSS and JavaScript to select and access specific elements via the [class selectors](https://developer.mozilla.org/docs/Web/CSS/Class_selectors) or functions like the method [`Document.getElementsByClassName()`](https://developer.mozilla.org/docs/Web/API/Document/getElementsByClassName "returns an array-like object of all child elements which have all of the given class names.").'
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/class"
        }
      ]
    },
    {
      "name": "contenteditable",
      "description": {
        "kind": "markdown",
        "value": "An enumerated attribute indicating if the element should be editable by the user. If so, the browser modifies its widget to allow editing. The attribute must take one of the following values:\n\n*   `true` or the _empty string_, which indicates that the element must be editable;\n*   `false`, which indicates that the element must not be editable."
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/contenteditable"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF3",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "contextmenu",
      "description": {
        "kind": "markdown",
        "value": 'The `[**id**](#attr-id)` of a [`<menu>`](https://developer.mozilla.org/docs/Web/HTML/Element/menu "The HTML <menu> element represents a group of commands that a user can perform or activate. This includes both list menus, which might appear across the top of a screen, as well as context menus, such as those that might appear underneath a button after it has been clicked.") to use as the contextual menu for this element.'
      }
    },
    {
      "name": "dir",
      "description": {
        "kind": "markdown",
        "value": "An enumerated attribute indicating the directionality of the element's text. It can have the following values:\n\n*   `ltr`, which means _left to right_ and is to be used for languages that are written from the left to the right (like English);\n*   `rtl`, which means _right to left_ and is to be used for languages that are written from the right to the left (like Arabic);\n*   `auto`, which lets the user agent decide. It uses a basic algorithm as it parses the characters inside the element until it finds a character with a strong directionality, then it applies that directionality to the whole element."
      },
      "valueSet": "d",
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/dir"
        }
      ]
    },
    {
      "name": "draggable",
      "description": {
        "kind": "markdown",
        "value": "An enumerated attribute indicating whether the element can be dragged, using the [Drag and Drop API](https://developer.mozilla.org/docs/DragDrop/Drag_and_Drop). It can have the following values:\n\n*   `true`, which indicates that the element may be dragged\n*   `false`, which indicates that the element may not be dragged."
      },
      "valueSet": "b",
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/draggable"
        }
      ]
    },
    {
      "name": "dropzone",
      "description": {
        "kind": "markdown",
        "value": "An enumerated attribute indicating what types of content can be dropped on an element, using the [Drag and Drop API](https://developer.mozilla.org/docs/DragDrop/Drag_and_Drop). It can have the following values:\n\n*   `copy`, which indicates that dropping will create a copy of the element that was dragged\n*   `move`, which indicates that the element that was dragged will be moved to this new location.\n*   `link`, will create a link to the dragged data."
      }
    },
    {
      "name": "enterkeyhint",
      "description": {
        "kind": "markdown",
        "value": "An enumerated attribute defining what action label (or icon) to present for the enter key on virtual keyboards."
      },
      "valueSet": "enterkeyhint",
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/enterkeyhint"
        }
      ],
      "browsers": [
        "C77",
        "CA77",
        "E79",
        "FF94",
        "FFA94",
        "S13.1",
        "SM13.4"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2021-11-02",
        "baseline_high_date": "2024-05-02"
      }
    },
    {
      "name": "exportparts",
      "description": {
        "kind": "markdown",
        "value": "Used to transitively export shadow parts from a nested shadow tree into a containing light tree."
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/exportparts"
        }
      ],
      "browsers": [
        "C73",
        "CA73",
        "E79",
        "FF72",
        "FFA79",
        "S13.1",
        "SM13.4"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2020-07-28",
        "baseline_high_date": "2023-01-28"
      }
    },
    {
      "name": "hidden",
      "description": {
        "kind": "markdown",
        "value": "A Boolean attribute indicates that the element is not yet, or is no longer, _relevant_. For example, it can be used to hide elements of the page that can't be used until the login process has been completed. The browser won't render such elements. This attribute must not be used to hide content that could legitimately be shown."
      },
      "valueSet": "v",
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/hidden"
        }
      ]
    },
    {
      "name": "id",
      "description": {
        "kind": "markdown",
        "value": "Defines a unique identifier (ID) which must be unique in the whole document. Its purpose is to identify the element when linking (using a fragment identifier), scripting, or styling (with CSS)."
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/id"
        }
      ]
    },
    {
      "name": "inert",
      "description": {
        "kind": "markdown",
        "value": "Indicates that the element and all of its flat tree descendants become _inert_. Modal `<dialog>`s generated with [`showModal()`](https://developer.mozilla.org/docs/Web/API/HTMLDialogElement/showModal) escape inertness, meaning that they don't inherit inertness from their ancestors, but can only be made inert by having the `inert` attribute explicitly set on themselves."
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/inert"
        }
      ],
      "browsers": [
        "C102",
        "CA102",
        "E102",
        "FF112",
        "FFA112",
        "S15.5",
        "SM15.5"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2023-04-11",
        "baseline_high_date": "2025-10-11"
      }
    },
    {
      "name": "inputmode",
      "description": {
        "kind": "markdown",
        "value": 'Provides a hint to browsers as to the type of virtual keyboard configuration to use when editing this element or its contents. Used primarily on [`<input>`](https://developer.mozilla.org/docs/Web/HTML/Element/input "The HTML <input> element is used to create interactive controls for web-based forms in order to accept data from the user; a wide variety of types of input data and control widgets are available, depending on the device and user agent.") elements, but is usable on any element while in `[contenteditable](https://developer.mozilla.org/docs/Web/HTML/Global_attributes#attr-contenteditable)` mode.'
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/inputmode"
        }
      ],
      "browsers": [
        "C66",
        "CA66",
        "E79",
        "FF95",
        "FFA79",
        "S12.1",
        "SM12.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2021-12-07",
        "baseline_high_date": "2024-06-07"
      }
    },
    {
      "name": "is",
      "description": {
        "kind": "markdown",
        "value": "Allows you to specify that a standard HTML element should behave like a registered custom built-in element (see [Using custom elements](https://developer.mozilla.org/docs/Web/Web_Components/Using_custom_elements) for more details)."
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/is"
        }
      ],
      "browsers": [
        "C67",
        "CA67",
        "E79",
        "FF63",
        "FFA63"
      ],
      "status": {
        "baseline": false
      }
    },
    {
      "name": "itemid",
      "description": {
        "kind": "markdown",
        "value": "The unique, global identifier of an item."
      }
    },
    {
      "name": "itemprop",
      "description": {
        "kind": "markdown",
        "value": "Used to add properties to an item. Every HTML element may have an `itemprop` attribute specified, where an `itemprop` consists of a name and value pair."
      }
    },
    {
      "name": "itemref",
      "description": {
        "kind": "markdown",
        "value": "Properties that are not descendants of an element with the `itemscope` attribute can be associated with the item using an `itemref`. It provides a list of element ids (not `itemid`s) with additional properties elsewhere in the document."
      }
    },
    {
      "name": "itemscope",
      "description": {
        "kind": "markdown",
        "value": "`itemscope` (usually) works along with `[itemtype](https://developer.mozilla.org/docs/Web/HTML/Global_attributes#attr-itemtype)` to specify that the HTML contained in a block is about a particular item. `itemscope` creates the Item and defines the scope of the `itemtype` associated with it. `itemtype` is a valid URL of a vocabulary (such as [schema.org](https://schema.org/)) that describes the item and its properties context."
      },
      "valueSet": "v"
    },
    {
      "name": "itemtype",
      "description": {
        "kind": "markdown",
        "value": "Specifies the URL of the vocabulary that will be used to define `itemprop`s (item properties) in the data structure. `[itemscope](https://developer.mozilla.org/docs/Web/HTML/Global_attributes#attr-itemscope)` is used to set the scope of where in the data structure the vocabulary set by `itemtype` will be active."
      }
    },
    {
      "name": "lang",
      "description": {
        "kind": "markdown",
        "value": "Helps define the language of an element: the language that non-editable elements are in, or the language that editable elements should be written in by the user. The attribute contains one \u201Clanguage tag\u201D (made of hyphen-separated \u201Clanguage subtags\u201D) in the format defined in [_Tags for Identifying Languages (BCP47)_](https://www.ietf.org/rfc/bcp/bcp47.txt). [**xml:lang**](#attr-xml:lang) has priority over it."
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/lang"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "nonce",
      "description": {
        "kind": "markdown",
        "value": 'Defines a cryptographic nonce ("number used once") which can be used by [Content Security Policy](https://developer.mozilla.org/docs/Web/HTTP/Guides/CSP) to determine whether or not a given fetch will be allowed to proceed for a given element.'
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/nonce"
        }
      ],
      "browsers": [
        "C61",
        "CA61",
        "E79",
        "FF75",
        "FFA79",
        "S15.5",
        "SM15.5"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2022-05-16",
        "baseline_high_date": "2024-11-16"
      }
    },
    {
      "name": "part",
      "description": {
        "kind": "markdown",
        "value": 'A space-separated list of the part names of the element. Part names allows CSS to select and style specific elements in a shadow tree via the [`::part`](https://developer.mozilla.org/docs/Web/CSS/::part "The ::part CSS pseudo-element represents any element within a shadow tree that has a matching part attribute.") pseudo-element.'
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/part"
        }
      ],
      "browsers": [
        "C73",
        "CA73",
        "E79",
        "FF72",
        "FFA79",
        "S13.1",
        "SM13.4"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2020-07-28",
        "baseline_high_date": "2023-01-28"
      }
    },
    {
      "name": "popover",
      "description": {
        "kind": "markdown",
        "value": "Designates an element as a popover element."
      },
      "valueSet": "popover",
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/popover"
        }
      ],
      "browsers": [
        "C114",
        "CA114",
        "E114",
        "FF125",
        "FFA125",
        "S17",
        "SM17"
      ],
      "status": {
        "baseline": "low",
        "baseline_low_date": "2024-04-16"
      }
    },
    {
      "name": "role",
      "valueSet": "roles"
    },
    {
      "name": "slot",
      "description": {
        "kind": "markdown",
        "value": "Assigns a slot in a [shadow DOM](https://developer.mozilla.org/docs/Web/Web_Components/Shadow_DOM) shadow tree to an element: An element with a `slot` attribute is assigned to the slot created by the [`<slot>`](https://developer.mozilla.org/docs/Web/HTML/Element/slot \"The HTML <slot> element\u2014part of the Web Components technology suite\u2014is a placeholder inside a web component that you can fill with your own markup, which lets you create separate DOM trees and present them together.\") element whose `[name](https://developer.mozilla.org/docs/Web/HTML/Element/slot#attr-name)` attribute's value matches that `slot` attribute's value."
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/slot"
        }
      ],
      "browsers": [
        "C53",
        "CA53",
        "E79",
        "FF63",
        "FFA63",
        "S10",
        "SM10"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2020-01-15",
        "baseline_high_date": "2022-07-15"
      }
    },
    {
      "name": "spellcheck",
      "description": {
        "kind": "markdown",
        "value": "An enumerated attribute defines whether the element may be checked for spelling errors. It may have the following values:\n\n*   `true`, which indicates that the element should be, if possible, checked for spelling errors;\n*   `false`, which indicates that the element should not be checked for spelling errors."
      },
      "valueSet": "b",
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/spellcheck"
        }
      ],
      "browsers": [
        "C9",
        "CA47",
        "E12",
        "FF2",
        "FFA57",
        "S5.1",
        "SM5"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2017-11-28",
        "baseline_high_date": "2020-05-28"
      }
    },
    {
      "name": "style",
      "description": {
        "kind": "markdown",
        "value": 'Contains [CSS](https://developer.mozilla.org/docs/Web/CSS) styling declarations to be applied to the element. Note that it is recommended for styles to be defined in a separate file or files. This attribute and the [`<style>`](https://developer.mozilla.org/docs/Web/HTML/Element/style "The HTML <style> element contains style information for a document, or part of a document.") element have mainly the purpose of allowing for quick styling, for example for testing purposes.'
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/style"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S1",
        "SM1"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "tabindex",
      "description": {
        "kind": "markdown",
        "value": "An integer attribute indicating if the element can take input focus (is _focusable_), if it should participate to sequential keyboard navigation, and if so, at what position. It can take several values:\n\n*   a _negative value_ means that the element should be focusable, but should not be reachable via sequential keyboard navigation;\n*   `0` means that the element should be focusable and reachable via sequential keyboard navigation, but its relative order is defined by the platform convention;\n*   a _positive value_ means that the element should be focusable and reachable via sequential keyboard navigation; the order in which the elements are focused is the increasing value of the [**tabindex**](#attr-tabindex). If several elements share the same tabindex, their relative order follows their relative positions in the document."
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/tabindex"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1.5",
        "FFA4",
        "S3.1",
        "SM2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "title",
      "description": {
        "kind": "markdown",
        "value": "Contains a text representing advisory information related to the element it belongs to. Such information can typically, but not necessarily, be presented to the user as a tooltip."
      },
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/title"
        }
      ],
      "browsers": [
        "C1",
        "CA18",
        "E12",
        "FF1",
        "FFA4",
        "S4",
        "SM3.2"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2015-07-29",
        "baseline_high_date": "2018-01-29"
      }
    },
    {
      "name": "translate",
      "description": {
        "kind": "markdown",
        "value": "An enumerated attribute that is used to specify whether an element's attribute values and the values of its [`Text`](https://developer.mozilla.org/docs/Web/API/Text \"The Text interface represents the textual content of Element or Attr. If an element has no markup within its content, it has a single child implementing Text that contains the element's text. However, if the element contains markup, it is parsed into information items and Text nodes that form its children.\") node children are to be translated when the page is localized, or whether to leave them unchanged. It can have the following values:\n\n*   empty string and `yes`, which indicates that the element will be translated.\n*   `no`, which indicates that the element will not be translated."
      },
      "valueSet": "y",
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/translate"
        }
      ],
      "browsers": [
        "C19",
        "CA25",
        "E79",
        "FF111",
        "FFA111",
        "S6",
        "SM6"
      ],
      "status": {
        "baseline": "high",
        "baseline_low_date": "2023-03-14",
        "baseline_high_date": "2025-09-14"
      }
    },
    {
      "name": "virtualkeyboardpolicy",
      "description": {
        "kind": "markdown",
        "value": "When specified on an element that the element's content is editable (for example, it is an `<input>` or `<textarea>` element, or an element with the `contenteditable` attribute set), it controls the on-screen virtual keyboard behavior on devices such as tablets, mobile phones, or other devices where a hardware keyboard may not be available."
      },
      "valueSet": "b",
      "references": [
        {
          "name": "MDN Reference",
          "url": "https://developer.mozilla.org/docs/Web/HTML/Reference/Global_attributes/virtualkeyboardpolicy"
        }
      ],
      "browsers": [
        "C94",
        "CA94",
        "E94"
      ],
      "status": {
        "baseline": false
      }
    },
    {
      "name": "onabort",
      "description": {
        "kind": "markdown",
        "value": "The loading of a resource has been aborted."
      }
    },
    {
      "name": "onblur",
      "description": {
        "kind": "markdown",
        "value": "An element has lost focus (does not bubble)."
      }
    },
    {
      "name": "oncanplay",
      "description": {
        "kind": "markdown",
        "value": "The user agent can play the media, but estimates that not enough data has been loaded to play the media up to its end without having to stop for further buffering of content."
      }
    },
    {
      "name": "oncanplaythrough",
      "description": {
        "kind": "markdown",
        "value": "The user agent can play the media up to its end without having to stop for further buffering of content."
      }
    },
    {
      "name": "onchange",
      "description": {
        "kind": "markdown",
        "value": "The change event is fired for <input>, <select>, and <textarea> elements when a change to the element's value is committed by the user."
      }
    },
    {
      "name": "onclick",
      "description": {
        "kind": "markdown",
        "value": "A pointing device button has been pressed and released on an element."
      }
    },
    {
      "name": "oncontextmenu",
      "description": {
        "kind": "markdown",
        "value": "The right button of the mouse is clicked (before the context menu is displayed)."
      }
    },
    {
      "name": "ondblclick",
      "description": {
        "kind": "markdown",
        "value": "A pointing device button is clicked twice on an element."
      }
    },
    {
      "name": "ondrag",
      "description": {
        "kind": "markdown",
        "value": "An element or text selection is being dragged (every 350ms)."
      }
    },
    {
      "name": "ondragend",
      "description": {
        "kind": "markdown",
        "value": "A drag operation is being ended (by releasing a mouse button or hitting the escape key)."
      }
    },
    {
      "name": "ondragenter",
      "description": {
        "kind": "markdown",
        "value": "A dragged element or text selection enters a valid drop target."
      }
    },
    {
      "name": "ondragleave",
      "description": {
        "kind": "markdown",
        "value": "A dragged element or text selection leaves a valid drop target."
      }
    },
    {
      "name": "ondragover",
      "description": {
        "kind": "markdown",
        "value": "An element or text selection is being dragged over a valid drop target (every 350ms)."
      }
    },
    {
      "name": "ondragstart",
      "description": {
        "kind": "markdown",
        "value": "The user starts dragging an element or text selection."
      }
    },
    {
      "name": "ondrop",
      "description": {
        "kind": "markdown",
        "value": "An element is dropped on a valid drop target."
      }
    },
    {
      "name": "ondurationchange",
      "description": {
        "kind": "markdown",
        "value": "The duration attribute has been updated."
      }
    },
    {
      "name": "onemptied",
      "description": {
        "kind": "markdown",
        "value": "The media has become empty; for example, this event is sent if the media has already been loaded (or partially loaded), and the load() method is called to reload it."
      }
    },
    {
      "name": "onended",
      "description": {
        "kind": "markdown",
        "value": "Playback has stopped because the end of the media was reached."
      }
    },
    {
      "name": "onerror",
      "description": {
        "kind": "markdown",
        "value": "A resource failed to load."
      }
    },
    {
      "name": "onfocus",
      "description": {
        "kind": "markdown",
        "value": "An element has received focus (does not bubble)."
      }
    },
    {
      "name": "onformchange"
    },
    {
      "name": "onforminput"
    },
    {
      "name": "oninput",
      "description": {
        "kind": "markdown",
        "value": "The value of an element changes or the content of an element with the attribute contenteditable is modified."
      }
    },
    {
      "name": "oninvalid",
      "description": {
        "kind": "markdown",
        "value": "A submittable element has been checked and doesn't satisfy its constraints."
      }
    },
    {
      "name": "onkeydown",
      "description": {
        "kind": "markdown",
        "value": "A key is pressed down."
      }
    },
    {
      "name": "onkeypress",
      "description": {
        "kind": "markdown",
        "value": "A key is pressed down and that key normally produces a character value (use input instead)."
      }
    },
    {
      "name": "onkeyup",
      "description": {
        "kind": "markdown",
        "value": "A key is released."
      }
    },
    {
      "name": "onload",
      "description": {
        "kind": "markdown",
        "value": "A resource and its dependent resources have finished loading."
      }
    },
    {
      "name": "onloadeddata",
      "description": {
        "kind": "markdown",
        "value": "The first frame of the media has finished loading."
      }
    },
    {
      "name": "onloadedmetadata",
      "description": {
        "kind": "markdown",
        "value": "The metadata has been loaded."
      }
    },
    {
      "name": "onloadstart",
      "description": {
        "kind": "markdown",
        "value": "Progress has begun."
      }
    },
    {
      "name": "onmousedown",
      "description": {
        "kind": "markdown",
        "value": "A pointing device button (usually a mouse) is pressed on an element."
      }
    },
    {
      "name": "onmousemove",
      "description": {
        "kind": "markdown",
        "value": "A pointing device is moved over an element."
      }
    },
    {
      "name": "onmouseout",
      "description": {
        "kind": "markdown",
        "value": "A pointing device is moved off the element that has the listener attached or off one of its children."
      }
    },
    {
      "name": "onmouseover",
      "description": {
        "kind": "markdown",
        "value": "A pointing device is moved onto the element that has the listener attached or onto one of its children."
      }
    },
    {
      "name": "onmouseup",
      "description": {
        "kind": "markdown",
        "value": "A pointing device button is released over an element."
      }
    },
    {
      "name": "onmousewheel"
    },
    {
      "name": "onmouseenter",
      "description": {
        "kind": "markdown",
        "value": "A pointing device is moved onto the element that has the listener attached."
      }
    },
    {
      "name": "onmouseleave",
      "description": {
        "kind": "markdown",
        "value": "A pointing device is moved off the element that has the listener attached."
      }
    },
    {
      "name": "onpause",
      "description": {
        "kind": "markdown",
        "value": "Playback has been paused."
      }
    },
    {
      "name": "onplay",
      "description": {
        "kind": "markdown",
        "value": "Playback has begun."
      }
    },
    {
      "name": "onplaying",
      "description": {
        "kind": "markdown",
        "value": "Playback is ready to start after having been paused or delayed due to lack of data."
      }
    },
    {
      "name": "onprogress",
      "description": {
        "kind": "markdown",
        "value": "In progress."
      }
    },
    {
      "name": "onratechange",
      "description": {
        "kind": "markdown",
        "value": "The playback rate has changed."
      }
    },
    {
      "name": "onreset",
      "description": {
        "kind": "markdown",
        "value": "A form is reset."
      }
    },
    {
      "name": "onresize",
      "description": {
        "kind": "markdown",
        "value": "The document view has been resized."
      }
    },
    {
      "name": "onreadystatechange",
      "description": {
        "kind": "markdown",
        "value": "The readyState attribute of a document has changed."
      }
    },
    {
      "name": "onscroll",
      "description": {
        "kind": "markdown",
        "value": "The document view or an element has been scrolled."
      }
    },
    {
      "name": "onseeked",
      "description": {
        "kind": "markdown",
        "value": "A seek operation completed."
      }
    },
    {
      "name": "onseeking",
      "description": {
        "kind": "markdown",
        "value": "A seek operation began."
      }
    },
    {
      "name": "onselect",
      "description": {
        "kind": "markdown",
        "value": "Some text is being selected."
      }
    },
    {
      "name": "onshow",
      "description": {
        "kind": "markdown",
        "value": "A contextmenu event was fired on/bubbled to an element that has a contextmenu attribute"
      }
    },
    {
      "name": "onstalled",
      "description": {
        "kind": "markdown",
        "value": "The user agent is trying to fetch media data, but data is unexpectedly not forthcoming."
      }
    },
    {
      "name": "onsubmit",
      "description": {
        "kind": "markdown",
        "value": "A form is submitted."
      }
    },
    {
      "name": "onsuspend",
      "description": {
        "kind": "markdown",
        "value": "Media data loading has been suspended."
      }
    },
    {
      "name": "ontimeupdate",
      "description": {
        "kind": "markdown",
        "value": "The time indicated by the currentTime attribute has been updated."
      }
    },
    {
      "name": "onvolumechange",
      "description": {
        "kind": "markdown",
        "value": "The volume has changed."
      }
    },
    {
      "name": "onwaiting",
      "description": {
        "kind": "markdown",
        "value": "Playback has stopped because of a temporary lack of data."
      }
    },
    {
      "name": "onpointercancel",
      "description": {
        "kind": "markdown",
        "value": "The pointer is unlikely to produce any more events."
      }
    },
    {
      "name": "onpointerdown",
      "description": {
        "kind": "markdown",
        "value": "The pointer enters the active buttons state."
      }
    },
    {
      "name": "onpointerenter",
      "description": {
        "kind": "markdown",
        "value": "Pointing device is moved inside the hit-testing boundary."
      }
    },
    {
      "name": "onpointerleave",
      "description": {
        "kind": "markdown",
        "value": "Pointing device is moved out of the hit-testing boundary."
      }
    },
    {
      "name": "onpointerlockchange",
      "description": {
        "kind": "markdown",
        "value": "The pointer was locked or released."
      }
    },
    {
      "name": "onpointerlockerror",
      "description": {
        "kind": "markdown",
        "value": "It was impossible to lock the pointer for technical reasons or because the permission was denied."
      }
    },
    {
      "name": "onpointermove",
      "description": {
        "kind": "markdown",
        "value": "The pointer changed coordinates."
      }
    },
    {
      "name": "onpointerout",
      "description": {
        "kind": "markdown",
        "value": "The pointing device moved out of hit-testing boundary or leaves detectable hover range."
      }
    },
    {
      "name": "onpointerover",
      "description": {
        "kind": "markdown",
        "value": "The pointing device is moved into the hit-testing boundary."
      }
    },
    {
      "name": "onpointerup",
      "description": {
        "kind": "markdown",
        "value": "The pointer leaves the active buttons state."
      }
    },
    {
      "name": "aria-activedescendant",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-activedescendant"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Identifies the currently active element when DOM focus is on a [`composite`](https://www.w3.org/TR/wai-aria-1.1/#composite) widget, [`textbox`](https://www.w3.org/TR/wai-aria-1.1/#textbox), [`group`](https://www.w3.org/TR/wai-aria-1.1/#group), or [`application`](https://www.w3.org/TR/wai-aria-1.1/#application)."
      }
    },
    {
      "name": "aria-atomic",
      "valueSet": "b",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-atomic"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates whether [assistive technologies](https://www.w3.org/TR/wai-aria-1.1/#dfn-assistive-technology) will present all, or only parts of, the changed region based on the change notifications defined by the [`aria-relevant`](https://www.w3.org/TR/wai-aria-1.1/#aria-relevant) attribute."
      }
    },
    {
      "name": "aria-autocomplete",
      "valueSet": "autocomplete",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-autocomplete"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates whether inputting text could trigger display of one or more predictions of the user's intended value for an input and specifies how predictions would be presented if they are made."
      }
    },
    {
      "name": "aria-busy",
      "valueSet": "b",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-busy"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates an element is being modified and that assistive technologies _MAY_ want to wait until the modifications are complete before exposing them to the user."
      }
    },
    {
      "name": "aria-checked",
      "valueSet": "tristate",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-checked"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": 'Indicates the current "checked" [state](https://www.w3.org/TR/wai-aria-1.1/#dfn-state) of checkboxes, radio buttons, and other [widgets](https://www.w3.org/TR/wai-aria-1.1/#dfn-widget). See related [`aria-pressed`](https://www.w3.org/TR/wai-aria-1.1/#aria-pressed) and [`aria-selected`](https://www.w3.org/TR/wai-aria-1.1/#aria-selected).'
      }
    },
    {
      "name": "aria-colcount",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-colcount"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines the total number of columns in a [`table`](https://www.w3.org/TR/wai-aria-1.1/#table), [`grid`](https://www.w3.org/TR/wai-aria-1.1/#grid), or [`treegrid`](https://www.w3.org/TR/wai-aria-1.1/#treegrid). See related [`aria-colindex`](https://www.w3.org/TR/wai-aria-1.1/#aria-colindex)."
      }
    },
    {
      "name": "aria-colindex",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-colindex"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines an [element's](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) column index or position with respect to the total number of columns within a [`table`](https://www.w3.org/TR/wai-aria-1.1/#table), [`grid`](https://www.w3.org/TR/wai-aria-1.1/#grid), or [`treegrid`](https://www.w3.org/TR/wai-aria-1.1/#treegrid). See related [`aria-colcount`](https://www.w3.org/TR/wai-aria-1.1/#aria-colcount) and [`aria-colspan`](https://www.w3.org/TR/wai-aria-1.1/#aria-colspan)."
      }
    },
    {
      "name": "aria-colspan",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-colspan"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines the number of columns spanned by a cell or gridcell within a [`table`](https://www.w3.org/TR/wai-aria-1.1/#table), [`grid`](https://www.w3.org/TR/wai-aria-1.1/#grid), or [`treegrid`](https://www.w3.org/TR/wai-aria-1.1/#treegrid). See related [`aria-colindex`](https://www.w3.org/TR/wai-aria-1.1/#aria-colindex) and [`aria-rowspan`](https://www.w3.org/TR/wai-aria-1.1/#aria-rowspan)."
      }
    },
    {
      "name": "aria-controls",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-controls"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Identifies the [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) (or elements) whose contents or presence are controlled by the current element. See related [`aria-owns`](https://www.w3.org/TR/wai-aria-1.1/#aria-owns)."
      }
    },
    {
      "name": "aria-current",
      "valueSet": "current",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-current"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates the [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) that represents the current item within a container or set of related elements."
      }
    },
    {
      "name": "aria-describedby",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-describedby"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Identifies the [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) (or elements) that describes the [object](https://www.w3.org/TR/wai-aria-1.1/#dfn-object). See related [`aria-labelledby`](https://www.w3.org/TR/wai-aria-1.1/#aria-labelledby)."
      }
    },
    {
      "name": "aria-disabled",
      "valueSet": "b",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-disabled"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates that the [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) is [perceivable](https://www.w3.org/TR/wai-aria-1.1/#dfn-perceivable) but disabled, so it is not editable or otherwise [operable](https://www.w3.org/TR/wai-aria-1.1/#dfn-operable). See related [`aria-hidden`](https://www.w3.org/TR/wai-aria-1.1/#aria-hidden) and [`aria-readonly`](https://www.w3.org/TR/wai-aria-1.1/#aria-readonly)."
      }
    },
    {
      "name": "aria-dropeffect",
      "valueSet": "dropeffect",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-dropeffect"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "\\[Deprecated in ARIA 1.1\\] Indicates what functions can be performed when a dragged object is released on the drop target."
      }
    },
    {
      "name": "aria-errormessage",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-errormessage"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Identifies the [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) that provides an error message for the [object](https://www.w3.org/TR/wai-aria-1.1/#dfn-object). See related [`aria-invalid`](https://www.w3.org/TR/wai-aria-1.1/#aria-invalid) and [`aria-describedby`](https://www.w3.org/TR/wai-aria-1.1/#aria-describedby)."
      }
    },
    {
      "name": "aria-expanded",
      "valueSet": "u",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-expanded"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates whether the element, or another grouping element it controls, is currently expanded or collapsed."
      }
    },
    {
      "name": "aria-flowto",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-flowto"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Identifies the next [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) (or elements) in an alternate reading order of content which, at the user's discretion, allows assistive technology to override the general default of reading in document source order."
      }
    },
    {
      "name": "aria-grabbed",
      "valueSet": "u",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-grabbed"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": `\\[Deprecated in ARIA 1.1\\] Indicates an element's "grabbed" [state](https://www.w3.org/TR/wai-aria-1.1/#dfn-state) in a drag-and-drop operation.`
      }
    },
    {
      "name": "aria-haspopup",
      "valueSet": "haspopup",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-haspopup"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates the availability and type of interactive popup element, such as menu or dialog, that can be triggered by an [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element)."
      }
    },
    {
      "name": "aria-hidden",
      "valueSet": "b",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-hidden"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates whether the [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) is exposed to an accessibility API. See related [`aria-disabled`](https://www.w3.org/TR/wai-aria-1.1/#aria-disabled)."
      }
    },
    {
      "name": "aria-invalid",
      "valueSet": "invalid",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-invalid"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates the entered value does not conform to the format expected by the application. See related [`aria-errormessage`](https://www.w3.org/TR/wai-aria-1.1/#aria-errormessage)."
      }
    },
    {
      "name": "aria-label",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-label"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines a string value that labels the current element. See related [`aria-labelledby`](https://www.w3.org/TR/wai-aria-1.1/#aria-labelledby)."
      }
    },
    {
      "name": "aria-labelledby",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-labelledby"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Identifies the [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) (or elements) that labels the current element. See related [`aria-describedby`](https://www.w3.org/TR/wai-aria-1.1/#aria-describedby)."
      }
    },
    {
      "name": "aria-level",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-level"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines the hierarchical level of an [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) within a structure."
      }
    },
    {
      "name": "aria-live",
      "valueSet": "live",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-live"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates that an [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) will be updated, and describes the types of updates the [user agents](https://www.w3.org/TR/wai-aria-1.1/#dfn-user-agent), [assistive technologies](https://www.w3.org/TR/wai-aria-1.1/#dfn-assistive-technology), and user can expect from the [live region](https://www.w3.org/TR/wai-aria-1.1/#dfn-live-region)."
      }
    },
    {
      "name": "aria-modal",
      "valueSet": "b",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-modal"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates whether an [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) is modal when displayed."
      }
    },
    {
      "name": "aria-multiline",
      "valueSet": "b",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-multiline"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates whether a text box accepts multiple lines of input or only a single line."
      }
    },
    {
      "name": "aria-multiselectable",
      "valueSet": "b",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-multiselectable"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates that the user may select more than one item from the current selectable descendants."
      }
    },
    {
      "name": "aria-orientation",
      "valueSet": "orientation",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-orientation"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates whether the element's orientation is horizontal, vertical, or unknown/ambiguous."
      }
    },
    {
      "name": "aria-owns",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-owns"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Identifies an [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) (or elements) in order to define a visual, functional, or contextual parent/child [relationship](https://www.w3.org/TR/wai-aria-1.1/#dfn-relationship) between DOM elements where the DOM hierarchy cannot be used to represent the relationship. See related [`aria-controls`](https://www.w3.org/TR/wai-aria-1.1/#aria-controls)."
      }
    },
    {
      "name": "aria-placeholder",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-placeholder"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines a short hint (a word or short phrase) intended to aid the user with data entry when the control has no value. A hint could be a sample value or a brief description of the expected format."
      }
    },
    {
      "name": "aria-posinset",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-posinset"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines an [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element)'s number or position in the current set of listitems or treeitems. Not required if all elements in the set are present in the DOM. See related [`aria-setsize`](https://www.w3.org/TR/wai-aria-1.1/#aria-setsize)."
      }
    },
    {
      "name": "aria-pressed",
      "valueSet": "tristate",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-pressed"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": 'Indicates the current "pressed" [state](https://www.w3.org/TR/wai-aria-1.1/#dfn-state) of toggle buttons. See related [`aria-checked`](https://www.w3.org/TR/wai-aria-1.1/#aria-checked) and [`aria-selected`](https://www.w3.org/TR/wai-aria-1.1/#aria-selected).'
      }
    },
    {
      "name": "aria-readonly",
      "valueSet": "b",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-readonly"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates that the [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) is not editable, but is otherwise [operable](https://www.w3.org/TR/wai-aria-1.1/#dfn-operable). See related [`aria-disabled`](https://www.w3.org/TR/wai-aria-1.1/#aria-disabled)."
      }
    },
    {
      "name": "aria-relevant",
      "valueSet": "relevant",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-relevant"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates what notifications the user agent will trigger when the accessibility tree within a live region is modified. See related [`aria-atomic`](https://www.w3.org/TR/wai-aria-1.1/#aria-atomic)."
      }
    },
    {
      "name": "aria-required",
      "valueSet": "b",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-required"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates that user input is required on the [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) before a form may be submitted."
      }
    },
    {
      "name": "aria-roledescription",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-roledescription"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines a human-readable, author-localized description for the [role](https://www.w3.org/TR/wai-aria-1.1/#dfn-role) of an [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element)."
      }
    },
    {
      "name": "aria-rowcount",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-rowcount"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines the total number of rows in a [`table`](https://www.w3.org/TR/wai-aria-1.1/#table), [`grid`](https://www.w3.org/TR/wai-aria-1.1/#grid), or [`treegrid`](https://www.w3.org/TR/wai-aria-1.1/#treegrid). See related [`aria-rowindex`](https://www.w3.org/TR/wai-aria-1.1/#aria-rowindex)."
      }
    },
    {
      "name": "aria-rowindex",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-rowindex"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines an [element's](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) row index or position with respect to the total number of rows within a [`table`](https://www.w3.org/TR/wai-aria-1.1/#table), [`grid`](https://www.w3.org/TR/wai-aria-1.1/#grid), or [`treegrid`](https://www.w3.org/TR/wai-aria-1.1/#treegrid). See related [`aria-rowcount`](https://www.w3.org/TR/wai-aria-1.1/#aria-rowcount) and [`aria-rowspan`](https://www.w3.org/TR/wai-aria-1.1/#aria-rowspan)."
      }
    },
    {
      "name": "aria-rowspan",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-rowspan"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines the number of rows spanned by a cell or gridcell within a [`table`](https://www.w3.org/TR/wai-aria-1.1/#table), [`grid`](https://www.w3.org/TR/wai-aria-1.1/#grid), or [`treegrid`](https://www.w3.org/TR/wai-aria-1.1/#treegrid). See related [`aria-rowindex`](https://www.w3.org/TR/wai-aria-1.1/#aria-rowindex) and [`aria-colspan`](https://www.w3.org/TR/wai-aria-1.1/#aria-colspan)."
      }
    },
    {
      "name": "aria-selected",
      "valueSet": "u",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-selected"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": 'Indicates the current "selected" [state](https://www.w3.org/TR/wai-aria-1.1/#dfn-state) of various [widgets](https://www.w3.org/TR/wai-aria-1.1/#dfn-widget). See related [`aria-checked`](https://www.w3.org/TR/wai-aria-1.1/#aria-checked) and [`aria-pressed`](https://www.w3.org/TR/wai-aria-1.1/#aria-pressed).'
      }
    },
    {
      "name": "aria-setsize",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-setsize"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines the number of items in the current set of listitems or treeitems. Not required if all elements in the set are present in the DOM. See related [`aria-posinset`](https://www.w3.org/TR/wai-aria-1.1/#aria-posinset)."
      }
    },
    {
      "name": "aria-sort",
      "valueSet": "sort",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-sort"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Indicates if items in a table or grid are sorted in ascending or descending order."
      }
    },
    {
      "name": "aria-valuemax",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-valuemax"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines the maximum allowed value for a range [widget](https://www.w3.org/TR/wai-aria-1.1/#dfn-widget)."
      }
    },
    {
      "name": "aria-valuemin",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-valuemin"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines the minimum allowed value for a range [widget](https://www.w3.org/TR/wai-aria-1.1/#dfn-widget)."
      }
    },
    {
      "name": "aria-valuenow",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-valuenow"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines the current value for a range [widget](https://www.w3.org/TR/wai-aria-1.1/#dfn-widget). See related [`aria-valuetext`](https://www.w3.org/TR/wai-aria-1.1/#aria-valuetext)."
      }
    },
    {
      "name": "aria-valuetext",
      "references": [
        {
          "name": "WAI-ARIA Reference",
          "url": "https://www.w3.org/TR/wai-aria-1.1/#aria-valuetext"
        }
      ],
      "description": {
        "kind": "markdown",
        "value": "Defines the human readable text alternative of [`aria-valuenow`](https://www.w3.org/TR/wai-aria-1.1/#aria-valuenow) for a range [widget](https://www.w3.org/TR/wai-aria-1.1/#dfn-widget)."
      }
    },
    {
      "name": "aria-details",
      "description": {
        "kind": "markdown",
        "value": "Identifies the [element](https://www.w3.org/TR/wai-aria-1.1/#dfn-element) that provides a detailed, extended description for the [object](https://www.w3.org/TR/wai-aria-1.1/#dfn-object). See related [`aria-describedby`](https://www.w3.org/TR/wai-aria-1.1/#aria-describedby)."
      }
    },
    {
      "name": "aria-keyshortcuts",
      "description": {
        "kind": "markdown",
        "value": "Indicates keyboard shortcuts that an author has implemented to activate or give focus to an element."
      }
    }
  ],
  "valueSets": [
    {
      "name": "b",
      "values": [
        {
          "name": "true"
        },
        {
          "name": "false"
        }
      ]
    },
    {
      "name": "u",
      "values": [
        {
          "name": "true"
        },
        {
          "name": "false"
        },
        {
          "name": "undefined"
        }
      ]
    },
    {
      "name": "o",
      "values": [
        {
          "name": "on"
        },
        {
          "name": "off"
        }
      ]
    },
    {
      "name": "y",
      "values": [
        {
          "name": "yes"
        },
        {
          "name": "no"
        }
      ]
    },
    {
      "name": "w",
      "values": [
        {
          "name": "soft"
        },
        {
          "name": "hard"
        }
      ]
    },
    {
      "name": "d",
      "values": [
        {
          "name": "ltr"
        },
        {
          "name": "rtl"
        },
        {
          "name": "auto"
        }
      ]
    },
    {
      "name": "m",
      "values": [
        {
          "name": "get",
          "description": {
            "kind": "markdown",
            "value": "Corresponds to the HTTP [GET method](https://www.w3.org/Protocols/rfc2616/rfc2616-sec9.html#sec9.3); form data are appended to the `action` attribute URI with a '?' as separator, and the resulting URI is sent to the server. Use this method when the form has no side-effects and contains only ASCII characters."
          }
        },
        {
          "name": "post",
          "description": {
            "kind": "markdown",
            "value": "Corresponds to the HTTP [POST method](https://www.w3.org/Protocols/rfc2616/rfc2616-sec9.html#sec9.5); form data are included in the body of the form and sent to the server."
          }
        },
        {
          "name": "dialog",
          "description": {
            "kind": "markdown",
            "value": "Use when the form is inside a [`<dialog>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog) element to close the dialog when submitted."
          }
        }
      ]
    },
    {
      "name": "fm",
      "values": [
        {
          "name": "get"
        },
        {
          "name": "post"
        }
      ]
    },
    {
      "name": "s",
      "values": [
        {
          "name": "row"
        },
        {
          "name": "col"
        },
        {
          "name": "rowgroup"
        },
        {
          "name": "colgroup"
        }
      ]
    },
    {
      "name": "t",
      "values": [
        {
          "name": "hidden"
        },
        {
          "name": "text"
        },
        {
          "name": "search"
        },
        {
          "name": "tel"
        },
        {
          "name": "url"
        },
        {
          "name": "email"
        },
        {
          "name": "password"
        },
        {
          "name": "datetime"
        },
        {
          "name": "date"
        },
        {
          "name": "month"
        },
        {
          "name": "week"
        },
        {
          "name": "time"
        },
        {
          "name": "datetime-local"
        },
        {
          "name": "number"
        },
        {
          "name": "range"
        },
        {
          "name": "color"
        },
        {
          "name": "checkbox"
        },
        {
          "name": "radio"
        },
        {
          "name": "file"
        },
        {
          "name": "submit"
        },
        {
          "name": "image"
        },
        {
          "name": "reset"
        },
        {
          "name": "button"
        }
      ]
    },
    {
      "name": "im",
      "values": [
        {
          "name": "verbatim"
        },
        {
          "name": "latin"
        },
        {
          "name": "latin-name"
        },
        {
          "name": "latin-prose"
        },
        {
          "name": "full-width-latin"
        },
        {
          "name": "kana"
        },
        {
          "name": "kana-name"
        },
        {
          "name": "katakana"
        },
        {
          "name": "numeric"
        },
        {
          "name": "tel"
        },
        {
          "name": "email"
        },
        {
          "name": "url"
        }
      ]
    },
    {
      "name": "bt",
      "values": [
        {
          "name": "button"
        },
        {
          "name": "submit"
        },
        {
          "name": "reset"
        }
      ]
    },
    {
      "name": "lt",
      "values": [
        {
          "name": "1"
        },
        {
          "name": "a"
        },
        {
          "name": "A"
        },
        {
          "name": "i"
        },
        {
          "name": "I"
        }
      ]
    },
    {
      "name": "mt",
      "values": [
        {
          "name": "context"
        },
        {
          "name": "toolbar"
        }
      ]
    },
    {
      "name": "mit",
      "values": [
        {
          "name": "command"
        },
        {
          "name": "checkbox"
        },
        {
          "name": "radio"
        }
      ]
    },
    {
      "name": "et",
      "values": [
        {
          "name": "application/x-www-form-urlencoded"
        },
        {
          "name": "multipart/form-data"
        },
        {
          "name": "text/plain"
        }
      ]
    },
    {
      "name": "tk",
      "values": [
        {
          "name": "subtitles"
        },
        {
          "name": "captions"
        },
        {
          "name": "descriptions"
        },
        {
          "name": "chapters"
        },
        {
          "name": "metadata"
        }
      ]
    },
    {
      "name": "pl",
      "values": [
        {
          "name": "none"
        },
        {
          "name": "metadata"
        },
        {
          "name": "auto"
        }
      ]
    },
    {
      "name": "sh",
      "values": [
        {
          "name": "circle"
        },
        {
          "name": "default"
        },
        {
          "name": "poly"
        },
        {
          "name": "rect"
        }
      ]
    },
    {
      "name": "xo",
      "values": [
        {
          "name": "anonymous"
        },
        {
          "name": "use-credentials"
        }
      ]
    },
    {
      "name": "target",
      "values": [
        {
          "name": "_self"
        },
        {
          "name": "_blank"
        },
        {
          "name": "_parent"
        },
        {
          "name": "_top"
        }
      ]
    },
    {
      "name": "sb",
      "values": [
        {
          "name": "allow-forms"
        },
        {
          "name": "allow-modals"
        },
        {
          "name": "allow-pointer-lock"
        },
        {
          "name": "allow-popups"
        },
        {
          "name": "allow-popups-to-escape-sandbox"
        },
        {
          "name": "allow-same-origin"
        },
        {
          "name": "allow-scripts"
        },
        {
          "name": "allow-top-navigation"
        }
      ]
    },
    {
      "name": "tristate",
      "values": [
        {
          "name": "true"
        },
        {
          "name": "false"
        },
        {
          "name": "mixed"
        },
        {
          "name": "undefined"
        }
      ]
    },
    {
      "name": "inputautocomplete",
      "values": [
        {
          "name": "additional-name"
        },
        {
          "name": "address-level1"
        },
        {
          "name": "address-level2"
        },
        {
          "name": "address-level3"
        },
        {
          "name": "address-level4"
        },
        {
          "name": "address-line1"
        },
        {
          "name": "address-line2"
        },
        {
          "name": "address-line3"
        },
        {
          "name": "bday"
        },
        {
          "name": "bday-year"
        },
        {
          "name": "bday-day"
        },
        {
          "name": "bday-month"
        },
        {
          "name": "billing"
        },
        {
          "name": "cc-additional-name"
        },
        {
          "name": "cc-csc"
        },
        {
          "name": "cc-exp"
        },
        {
          "name": "cc-exp-month"
        },
        {
          "name": "cc-exp-year"
        },
        {
          "name": "cc-family-name"
        },
        {
          "name": "cc-given-name"
        },
        {
          "name": "cc-name"
        },
        {
          "name": "cc-number"
        },
        {
          "name": "cc-type"
        },
        {
          "name": "country"
        },
        {
          "name": "country-name"
        },
        {
          "name": "current-password"
        },
        {
          "name": "email"
        },
        {
          "name": "family-name"
        },
        {
          "name": "fax"
        },
        {
          "name": "given-name"
        },
        {
          "name": "home"
        },
        {
          "name": "honorific-prefix"
        },
        {
          "name": "honorific-suffix"
        },
        {
          "name": "impp"
        },
        {
          "name": "language"
        },
        {
          "name": "mobile"
        },
        {
          "name": "name"
        },
        {
          "name": "new-password"
        },
        {
          "name": "nickname"
        },
        {
          "name": "off"
        },
        {
          "name": "on"
        },
        {
          "name": "organization"
        },
        {
          "name": "organization-title"
        },
        {
          "name": "pager"
        },
        {
          "name": "photo"
        },
        {
          "name": "postal-code"
        },
        {
          "name": "sex"
        },
        {
          "name": "shipping"
        },
        {
          "name": "street-address"
        },
        {
          "name": "tel-area-code"
        },
        {
          "name": "tel"
        },
        {
          "name": "tel-country-code"
        },
        {
          "name": "tel-extension"
        },
        {
          "name": "tel-local"
        },
        {
          "name": "tel-local-prefix"
        },
        {
          "name": "tel-local-suffix"
        },
        {
          "name": "tel-national"
        },
        {
          "name": "transaction-amount"
        },
        {
          "name": "transaction-currency"
        },
        {
          "name": "url"
        },
        {
          "name": "username"
        },
        {
          "name": "work"
        }
      ]
    },
    {
      "name": "autocomplete",
      "values": [
        {
          "name": "inline"
        },
        {
          "name": "list"
        },
        {
          "name": "both"
        },
        {
          "name": "none"
        }
      ]
    },
    {
      "name": "current",
      "values": [
        {
          "name": "page"
        },
        {
          "name": "step"
        },
        {
          "name": "location"
        },
        {
          "name": "date"
        },
        {
          "name": "time"
        },
        {
          "name": "true"
        },
        {
          "name": "false"
        }
      ]
    },
    {
      "name": "dropeffect",
      "values": [
        {
          "name": "copy"
        },
        {
          "name": "move"
        },
        {
          "name": "link"
        },
        {
          "name": "execute"
        },
        {
          "name": "popup"
        },
        {
          "name": "none"
        }
      ]
    },
    {
      "name": "invalid",
      "values": [
        {
          "name": "grammar"
        },
        {
          "name": "false"
        },
        {
          "name": "spelling"
        },
        {
          "name": "true"
        }
      ]
    },
    {
      "name": "live",
      "values": [
        {
          "name": "off"
        },
        {
          "name": "polite"
        },
        {
          "name": "assertive"
        }
      ]
    },
    {
      "name": "orientation",
      "values": [
        {
          "name": "vertical"
        },
        {
          "name": "horizontal"
        },
        {
          "name": "undefined"
        }
      ]
    },
    {
      "name": "relevant",
      "values": [
        {
          "name": "additions"
        },
        {
          "name": "removals"
        },
        {
          "name": "text"
        },
        {
          "name": "all"
        },
        {
          "name": "additions text"
        }
      ]
    },
    {
      "name": "sort",
      "values": [
        {
          "name": "ascending"
        },
        {
          "name": "descending"
        },
        {
          "name": "none"
        },
        {
          "name": "other"
        }
      ]
    },
    {
      "name": "roles",
      "values": [
        {
          "name": "alert"
        },
        {
          "name": "alertdialog"
        },
        {
          "name": "button"
        },
        {
          "name": "checkbox"
        },
        {
          "name": "dialog"
        },
        {
          "name": "gridcell"
        },
        {
          "name": "link"
        },
        {
          "name": "log"
        },
        {
          "name": "marquee"
        },
        {
          "name": "menuitem"
        },
        {
          "name": "menuitemcheckbox"
        },
        {
          "name": "menuitemradio"
        },
        {
          "name": "option"
        },
        {
          "name": "progressbar"
        },
        {
          "name": "radio"
        },
        {
          "name": "scrollbar"
        },
        {
          "name": "searchbox"
        },
        {
          "name": "slider"
        },
        {
          "name": "spinbutton"
        },
        {
          "name": "status"
        },
        {
          "name": "switch"
        },
        {
          "name": "tab"
        },
        {
          "name": "tabpanel"
        },
        {
          "name": "textbox"
        },
        {
          "name": "timer"
        },
        {
          "name": "tooltip"
        },
        {
          "name": "treeitem"
        },
        {
          "name": "combobox"
        },
        {
          "name": "grid"
        },
        {
          "name": "listbox"
        },
        {
          "name": "menu"
        },
        {
          "name": "menubar"
        },
        {
          "name": "radiogroup"
        },
        {
          "name": "tablist"
        },
        {
          "name": "tree"
        },
        {
          "name": "treegrid"
        },
        {
          "name": "application"
        },
        {
          "name": "article"
        },
        {
          "name": "cell"
        },
        {
          "name": "columnheader"
        },
        {
          "name": "definition"
        },
        {
          "name": "directory"
        },
        {
          "name": "document"
        },
        {
          "name": "feed"
        },
        {
          "name": "figure"
        },
        {
          "name": "group"
        },
        {
          "name": "heading"
        },
        {
          "name": "img"
        },
        {
          "name": "list"
        },
        {
          "name": "listitem"
        },
        {
          "name": "math"
        },
        {
          "name": "none"
        },
        {
          "name": "note"
        },
        {
          "name": "presentation"
        },
        {
          "name": "region"
        },
        {
          "name": "row"
        },
        {
          "name": "rowgroup"
        },
        {
          "name": "rowheader"
        },
        {
          "name": "separator"
        },
        {
          "name": "table"
        },
        {
          "name": "term"
        },
        {
          "name": "text"
        },
        {
          "name": "toolbar"
        },
        {
          "name": "banner"
        },
        {
          "name": "complementary"
        },
        {
          "name": "contentinfo"
        },
        {
          "name": "form"
        },
        {
          "name": "main"
        },
        {
          "name": "navigation"
        },
        {
          "name": "region"
        },
        {
          "name": "search"
        },
        {
          "name": "doc-abstract"
        },
        {
          "name": "doc-acknowledgments"
        },
        {
          "name": "doc-afterword"
        },
        {
          "name": "doc-appendix"
        },
        {
          "name": "doc-backlink"
        },
        {
          "name": "doc-biblioentry"
        },
        {
          "name": "doc-bibliography"
        },
        {
          "name": "doc-biblioref"
        },
        {
          "name": "doc-chapter"
        },
        {
          "name": "doc-colophon"
        },
        {
          "name": "doc-conclusion"
        },
        {
          "name": "doc-cover"
        },
        {
          "name": "doc-credit"
        },
        {
          "name": "doc-credits"
        },
        {
          "name": "doc-dedication"
        },
        {
          "name": "doc-endnote"
        },
        {
          "name": "doc-endnotes"
        },
        {
          "name": "doc-epigraph"
        },
        {
          "name": "doc-epilogue"
        },
        {
          "name": "doc-errata"
        },
        {
          "name": "doc-example"
        },
        {
          "name": "doc-footnote"
        },
        {
          "name": "doc-foreword"
        },
        {
          "name": "doc-glossary"
        },
        {
          "name": "doc-glossref"
        },
        {
          "name": "doc-index"
        },
        {
          "name": "doc-introduction"
        },
        {
          "name": "doc-noteref"
        },
        {
          "name": "doc-notice"
        },
        {
          "name": "doc-pagebreak"
        },
        {
          "name": "doc-pagelist"
        },
        {
          "name": "doc-part"
        },
        {
          "name": "doc-preface"
        },
        {
          "name": "doc-prologue"
        },
        {
          "name": "doc-pullquote"
        },
        {
          "name": "doc-qna"
        },
        {
          "name": "doc-subtitle"
        },
        {
          "name": "doc-tip"
        },
        {
          "name": "doc-toc"
        }
      ]
    },
    {
      "name": "metanames",
      "values": [
        {
          "name": "application-name"
        },
        {
          "name": "author"
        },
        {
          "name": "description"
        },
        {
          "name": "format-detection"
        },
        {
          "name": "generator"
        },
        {
          "name": "keywords"
        },
        {
          "name": "publisher"
        },
        {
          "name": "referrer"
        },
        {
          "name": "robots"
        },
        {
          "name": "theme-color"
        },
        {
          "name": "viewport"
        }
      ]
    },
    {
      "name": "haspopup",
      "values": [
        {
          "name": "false",
          "description": {
            "kind": "markdown",
            "value": "(default) Indicates the element does not have a popup."
          }
        },
        {
          "name": "true",
          "description": {
            "kind": "markdown",
            "value": "Indicates the popup is a menu."
          }
        },
        {
          "name": "menu",
          "description": {
            "kind": "markdown",
            "value": "Indicates the popup is a menu."
          }
        },
        {
          "name": "listbox",
          "description": {
            "kind": "markdown",
            "value": "Indicates the popup is a listbox."
          }
        },
        {
          "name": "tree",
          "description": {
            "kind": "markdown",
            "value": "Indicates the popup is a tree."
          }
        },
        {
          "name": "grid",
          "description": {
            "kind": "markdown",
            "value": "Indicates the popup is a grid."
          }
        },
        {
          "name": "dialog",
          "description": {
            "kind": "markdown",
            "value": "Indicates the popup is a dialog."
          }
        }
      ]
    },
    {
      "name": "decoding",
      "values": [
        {
          "name": "sync"
        },
        {
          "name": "async"
        },
        {
          "name": "auto"
        }
      ]
    },
    {
      "name": "loading",
      "values": [
        {
          "name": "eager",
          "description": {
            "kind": "markdown",
            "value": "Loads the image immediately, regardless of whether or not the image is currently within the visible viewport (this is the default value)."
          }
        },
        {
          "name": "lazy",
          "description": {
            "kind": "markdown",
            "value": "Defers loading the image until it reaches a calculated distance from the viewport, as defined by the browser. The intent is to avoid the network and storage bandwidth needed to handle the image until it's reasonably certain that it will be needed. This generally improves the performance of the content in most typical use cases."
          }
        }
      ]
    },
    {
      "name": "referrerpolicy",
      "values": [
        {
          "name": "no-referrer"
        },
        {
          "name": "no-referrer-when-downgrade"
        },
        {
          "name": "origin"
        },
        {
          "name": "origin-when-cross-origin"
        },
        {
          "name": "same-origin"
        },
        {
          "name": "strict-origin"
        },
        {
          "name": "strict-origin-when-cross-origin"
        },
        {
          "name": "unsafe-url"
        }
      ]
    },
    {
      "name": "enterkeyhint",
      "values": [
        {
          "name": "enter"
        },
        {
          "name": "done"
        },
        {
          "name": "go"
        },
        {
          "name": "next"
        },
        {
          "name": "previous"
        },
        {
          "name": "search"
        },
        {
          "name": "send"
        }
      ]
    },
    {
      "name": "popover",
      "values": [
        {
          "name": "auto"
        },
        {
          "name": "hint"
        },
        {
          "name": "manual"
        }
      ]
    },
    {
      "name": "fetchpriority",
      "values": [
        {
          "name": "high"
        },
        {
          "name": "low"
        },
        {
          "name": "auto"
        }
      ]
    }
  ]
};

// node_modules/vscode-html-languageservice/lib/esm/languageFacts/dataManager.js
var HTMLDataManager = class {
  constructor(options) {
    this.dataProviders = [];
    this.setDataProviders(options.useDefaultDataProvider !== false, options.customDataProviders || []);
  }
  setDataProviders(builtIn, providers) {
    this.dataProviders = [];
    if (builtIn) {
      this.dataProviders.push(new HTMLDataProvider("html5", htmlData));
    }
    this.dataProviders.push(...providers);
  }
  getDataProviders() {
    return this.dataProviders;
  }
  isVoidElement(e, voidElements) {
    return !!e && binarySearch(voidElements, e.toLowerCase(), (s1, s2) => s1.localeCompare(s2)) >= 0;
  }
  getVoidElements(languageOrProviders) {
    const dataProviders = Array.isArray(languageOrProviders) ? languageOrProviders : this.getDataProviders().filter((p) => p.isApplicable(languageOrProviders));
    const voidTags = [];
    dataProviders.forEach((provider) => {
      provider.provideTags().filter((tag) => tag.void).forEach((tag) => voidTags.push(tag.name));
    });
    return voidTags.sort();
  }
  isPathAttribute(tag, attr) {
    if (attr === "src" || attr === "href") {
      return true;
    }
    const a = PATH_TAG_AND_ATTR[tag];
    if (a) {
      if (typeof a === "string") {
        return a === attr;
      } else {
        return a.indexOf(attr) !== -1;
      }
    }
    return false;
  }
};
var PATH_TAG_AND_ATTR = {
  // HTML 4
  a: "href",
  area: "href",
  body: "background",
  blockquote: "cite",
  del: "cite",
  form: "action",
  frame: ["src", "longdesc"],
  img: ["src", "longdesc"],
  ins: "cite",
  link: "href",
  object: "data",
  q: "cite",
  script: "src",
  // HTML 5
  audio: "src",
  button: "formaction",
  command: "icon",
  embed: "src",
  html: "manifest",
  input: ["src", "formaction"],
  source: "src",
  track: "src",
  video: ["src", "poster"]
};

// node_modules/vscode-html-languageservice/lib/esm/htmlLanguageService.js
var defaultLanguageServiceOptions = {};
function getLanguageService(options = defaultLanguageServiceOptions) {
  const dataManager = new HTMLDataManager(options);
  const htmlHover = new HTMLHover(options, dataManager);
  const htmlCompletion = new HTMLCompletion(options, dataManager);
  const htmlParser = new HTMLParser(dataManager);
  const htmlSelectionRange = new HTMLSelectionRange(htmlParser);
  const htmlFolding = new HTMLFolding(dataManager);
  const htmlDocumentLinks = new HTMLDocumentLinks(dataManager);
  return {
    setDataProviders: dataManager.setDataProviders.bind(dataManager),
    createScanner,
    parseHTMLDocument: htmlParser.parseDocument.bind(htmlParser),
    doComplete: htmlCompletion.doComplete.bind(htmlCompletion),
    doComplete2: htmlCompletion.doComplete2.bind(htmlCompletion),
    setCompletionParticipants: htmlCompletion.setCompletionParticipants.bind(htmlCompletion),
    doHover: htmlHover.doHover.bind(htmlHover),
    format: format2,
    findDocumentHighlights,
    findDocumentLinks: htmlDocumentLinks.findDocumentLinks.bind(htmlDocumentLinks),
    findDocumentSymbols,
    findDocumentSymbols2,
    getFoldingRanges: htmlFolding.getFoldingRanges.bind(htmlFolding),
    getSelectionRanges: htmlSelectionRange.getSelectionRanges.bind(htmlSelectionRange),
    doQuoteComplete: htmlCompletion.doQuoteComplete.bind(htmlCompletion),
    doTagComplete: htmlCompletion.doTagComplete.bind(htmlCompletion),
    doRename,
    findMatchingTagPosition,
    findOnTypeRenameRanges: findLinkedEditingRanges,
    findLinkedEditingRanges
  };
}
function newHTMLDataProvider(id, customData) {
  return new HTMLDataProvider(id, customData);
}

// src/lsp/html/embedded-support.ts
var cache = /* @__PURE__ */ new Map();
function getDocumentRegions(languageService, document) {
  const regions = [];
  const importedScripts = [];
  const cacheKey = document.uri;
  const cachedRegions = cache.get(document.uri);
  if (cachedRegions && cachedRegions[2] === document.version && cachedRegions[3] > Date.now()) {
    regions.push(...cachedRegions[0]);
    importedScripts.push(...cachedRegions[1]);
  } else {
    const scanner = languageService.createScanner(document.getText());
    let lastTagName = "";
    let lastAttributeName = null;
    let lastLauguageId = void 0;
    let token = scanner.scan();
    while (token !== TokenType.EOS) {
      switch (token) {
        case TokenType.StartTag:
          lastTagName = scanner.getTokenText();
          lastAttributeName = null;
          lastLauguageId = "javascript";
          break;
        case TokenType.Styles:
          regions.push({
            languageId: "css",
            start: scanner.getTokenOffset(),
            end: scanner.getTokenEnd()
          });
          break;
        case TokenType.Script:
          regions.push({
            languageId: lastLauguageId,
            start: scanner.getTokenOffset(),
            end: scanner.getTokenEnd()
          });
          break;
        case TokenType.AttributeName:
          lastAttributeName = scanner.getTokenText();
          break;
        case TokenType.AttributeValue:
          if (lastAttributeName === "src" && lastTagName.toLowerCase() === "script") {
            let src = scanner.getTokenText();
            if (src[0] === "'" || src[0] === '"') {
              src = src.slice(1, -1);
            }
            importedScripts.push({
              start: scanner.getTokenOffset(),
              end: scanner.getTokenEnd(),
              src
            });
          } else if (lastAttributeName === "type" && lastTagName.toLowerCase() === "script") {
            const tokenText = scanner.getTokenText();
            if (/["'](module|(text|application)\/(java|ecma)script|text\/babel)["']/.test(tokenText)) {
              lastLauguageId = "javascript";
            } else if (/["']importmap["']/.test(tokenText)) {
              lastLauguageId = "importmap";
            } else {
              lastLauguageId = void 0;
            }
          } else {
            const attributeLanguageId = getAttributeLanguage(lastAttributeName);
            if (attributeLanguageId) {
              let start = scanner.getTokenOffset();
              let end = scanner.getTokenEnd();
              const firstChar = document.getText()[start];
              if (firstChar === "'" || firstChar === '"') {
                start++;
                end--;
              }
              regions.push({
                languageId: attributeLanguageId,
                start,
                end,
                attributeValue: true
              });
            }
          }
          lastAttributeName = null;
          break;
      }
      token = scanner.scan();
    }
    cache.set(cacheKey, [regions, importedScripts, document.version, Date.now() + 30 * 1e3]);
  }
  return {
    regions,
    importedScripts,
    getEmbeddedDocument: (languageId, ignoreAttributeValues) => getEmbeddedDocument(document, regions, languageId, ignoreAttributeValues),
    getEmbeddedLanguages: (ignoreAttributeValues) => getEmbeddedLanguages(regions, ignoreAttributeValues),
    getEmbeddedLanguageAtPosition: (position) => getEmbeddedLanguageAtPosition(document, regions, position),
    hasEmbeddedLanguage: (languageId, ignoreAttributeValues) => regions.some((r) => r.languageId === languageId && (!ignoreAttributeValues || !r.attributeValue))
  };
}
function getEmbeddedLanguages(regions, ignoreAttributeValues) {
  const result = [];
  for (const { languageId, attributeValue } of regions) {
    if (languageId && (!ignoreAttributeValues || !attributeValue) && result.indexOf(languageId) === -1) {
      result.push(languageId);
    }
  }
  return result;
}
function getEmbeddedLanguageAtPosition(document, regions, position) {
  const offset = document.offsetAt(position);
  for (const region of regions) {
    if (region.start > offset) {
      break;
    }
    if (offset <= region.end) {
      return region.languageId;
    }
  }
}
function getEmbeddedDocument(document, contents, languageId, ignoreAttributeValues) {
  const docText = document.getText();
  let currentPos = 0;
  let result = "";
  let lastSuffix = "";
  let hasAny = false;
  for (const c of contents) {
    if (c.languageId === languageId && (!ignoreAttributeValues || !c.attributeValue)) {
      result = substituteWithWhitespace(
        result,
        currentPos,
        c.start,
        docText,
        lastSuffix,
        getPrefix(c)
      );
      result += updateContent(c, docText.substring(c.start, c.end));
      currentPos = c.end;
      lastSuffix = getSuffix(c);
      hasAny = true;
    }
  }
  if (!hasAny) {
    return null;
  }
  return result + lastSuffix;
}
function getPrefix(c) {
  if (c.attributeValue) {
    switch (c.languageId) {
      case "css":
        return "__{";
    }
  }
  return "";
}
function getSuffix(c) {
  if (c.attributeValue) {
    switch (c.languageId) {
      case "css":
        return "}";
      case "javascript":
        return ";";
    }
  }
  return "";
}
function updateContent(c, content) {
  if (!c.attributeValue && c.languageId === "javascript") {
    return content.replace(`<!--`, `/* `).replace(`-->`, ` */`);
  }
  return content;
}
function substituteWithWhitespace(result, start, end, oldContent, before, after) {
  result += before;
  let accumulatedWS = -before.length;
  for (let i = start; i < end; i++) {
    const ch = oldContent[i];
    if (ch === "\n" || ch === "\r") {
      accumulatedWS = 0;
      result += ch;
    } else {
      accumulatedWS++;
    }
  }
  result = append(result, " ", accumulatedWS - after.length);
  result += after;
  return result;
}
function append(result, str, n) {
  while (n > 0) {
    if (n & 1) {
      result += str;
    }
    n >>= 1;
    str += str;
  }
  return result;
}
function getAttributeLanguage(attributeName) {
  if (attributeName === "style") {
    return "css";
  }
  if (attributeName.startsWith("on") && /^[a-z]+$/.test(attributeName.slice(2))) {
    return "javascript";
  }
  return null;
}

// src/lsp/worker-base.ts
var WorkerBase = class {
  #ctx;
  #fs;
  #documentCache = /* @__PURE__ */ new Map();
  #createLanguageDocument;
  constructor(ctx, createData, createLanguageDocument) {
    this.#ctx = ctx;
    if (createData.fs) {
      const dirs = /* @__PURE__ */ new Set(["/"]);
      this.#fs = new Map(createData.fs.map((path) => {
        const dir = path.slice(0, path.lastIndexOf("/"));
        if (dir) {
          dirs.add(dir);
        }
        return ["file://" + path, 1];
      }));
      for (const dir of dirs) {
        this.#fs.set("file://" + dir, 2);
      }
      createData.fs.length = 0;
    }
    this.#createLanguageDocument = createLanguageDocument;
  }
  get hasFileSystemProvider() {
    return !!this.#fs;
  }
  get host() {
    return this.#ctx.host;
  }
  getMirrorModels() {
    return this.#ctx.getMirrorModels();
  }
  hasModel(fileName) {
    const models = this.getMirrorModels();
    for (let i = 0; i < models.length; i++) {
      const uri = models[i].uri;
      if (uri.toString() === fileName || uri.toString(true) === fileName) {
        return true;
      }
    }
    return false;
  }
  getModel(fileName) {
    const models = this.getMirrorModels();
    for (let i = 0; i < models.length; i++) {
      const uri = models[i].uri;
      if (uri.toString() === fileName || uri.toString(true) === fileName) {
        return models[i];
      }
    }
    return null;
  }
  getTextDocument(uri) {
    const model = this.getModel(uri);
    if (!model) {
      return null;
    }
    const cached = this.#documentCache.get(uri);
    if (cached && cached[0] === model.version) {
      return cached[1];
    }
    const document = TextDocument2.create(uri, "-", model.version, model.getValue());
    this.#documentCache.set(uri, [model.version, document, void 0]);
    return document;
  }
  getLanguageDocument(document) {
    const { uri, version } = document;
    const cached = this.#documentCache.get(uri);
    if (cached && cached[0] === version && cached[2]) {
      return cached[2];
    }
    if (!this.#createLanguageDocument) {
      throw new Error("createLanguageDocument is not provided");
    }
    const languageDocument = this.#createLanguageDocument(document);
    this.#documentCache.set(uri, [version, document, languageDocument]);
    return languageDocument;
  }
  readDir(uri, extensions) {
    const entries = [];
    if (this.#fs) {
      for (const [path, type] of this.#fs) {
        if (path.startsWith(uri)) {
          const name = path.slice(uri.length);
          if (!name.includes("/")) {
            if (type === 1) {
              if (!extensions || extensions.some((ext) => name.endsWith(ext))) {
                entries.push([name, 1]);
              }
            } else if (type === 2) {
              entries.push([name, 2]);
            }
          }
        }
      }
    }
    return entries;
  }
  getFileSystemProvider() {
    if (this.#fs) {
      const host = this.#ctx.host;
      return {
        readDirectory: (uri) => {
          return Promise.resolve(this.readDir(uri));
        },
        stat: (uri) => {
          return host.fs_stat(uri);
        },
        getContent: (uri, encoding) => {
          return host.fs_getContent(uri);
        }
      };
    }
    return void 0;
  }
  // resolveReference implementes the `DocumentContext` interface
  resolveReference(ref, baseUrl) {
    const { protocol, pathname, href } = new URL(ref, baseUrl);
    if (protocol === "file:" && pathname !== "/" && this.#fs && !this.#fs.has(href.endsWith("/") ? href.slice(0, -1) : href)) {
      return void 0;
    }
    return href;
  }
  // #region methods used by the host
  async releaseDocument(uri) {
    this.#documentCache.delete(uri);
  }
  async fsNotify(kind, path, type) {
    const fs = this.#fs ?? (this.#fs = /* @__PURE__ */ new Map());
    if (kind === "create") {
      if (type) {
        fs.set(path, type);
      }
    } else if (kind === "remove") {
      if (fs.get(path) === 1) {
        this.#documentCache.delete(path);
      }
      fs.delete(path);
    }
  }
  // #endregion
};

// src/lsp/html/worker.ts
import { initializeWorker } from "../../editor-worker.mjs";
var HTMLWorker = class extends WorkerBase {
  _formatSettings;
  _suggestSettings;
  _languageService;
  constructor(ctx, createData) {
    super(ctx, createData, (document) => this._languageService.parseHTMLDocument(document));
    const data = createData.data;
    const useDefaultDataProvider = data?.useDefaultDataProvider;
    const fileSystemProvider = this.getFileSystemProvider();
    const customDataProviders = [];
    if (data?.dataProviders) {
      for (const id in data.dataProviders) {
        customDataProviders.push(
          newHTMLDataProvider(id, data.dataProviders[id])
        );
      }
    }
    this._formatSettings = createData.format ?? {};
    this._suggestSettings = createData.suggest ?? {};
    this._languageService = getLanguageService({ customDataProviders, useDefaultDataProvider, fileSystemProvider });
  }
  async doValidation(uri) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return null;
    }
    const diagnostic = [];
    const rs = getDocumentRegions(this._languageService, document);
    if (rs.hasEmbeddedLanguage("importmap")) {
      const imr = rs.regions.find((region) => region.languageId === "importmap");
      const addDiagnostic = (r) => diagnostic.push({
        severity: 1,
        // Error
        range: {
          start: document.positionAt(r.start),
          end: document.positionAt(r.end)
        },
        message: "Scripts are not allowed before the import map.",
        source: "html"
      });
      for (const script of rs.importedScripts) {
        if (script.end < imr.start) {
          addDiagnostic(script);
        } else {
          break;
        }
      }
      for (const r of rs.regions) {
        if (r.languageId === "javascript" && r.end < imr.start) {
          addDiagnostic(r);
        } else {
          break;
        }
      }
    }
    const rsls = rs.getEmbeddedLanguages();
    if (rsls.length > 0) {
      return {
        $embedded: {
          languageIds: rsls,
          origin: diagnostic
        }
      };
    }
    return diagnostic;
  }
  async doAutoComplete(uri, position, ch) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return null;
    }
    const htmlDocument = this.getLanguageDocument(document);
    if (ch === ">" || ch === "/") {
      return this._languageService.doTagComplete(document, position, htmlDocument);
    } else if (ch === "=") {
      const insertText = this._languageService.doQuoteComplete(document, position, htmlDocument, this._suggestSettings);
      if (!insertText) {
        return null;
      }
      return insertText.replaceAll("$1", "$0");
    }
    return null;
  }
  async doComplete(uri, position) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return null;
    }
    const rs = getDocumentRegions(this._languageService, document);
    const rsl = rs.getEmbeddedLanguageAtPosition(position);
    if (rsl) {
      return { $embedded: rsl };
    }
    const htmlDocument = this.getLanguageDocument(document);
    return this._languageService.doComplete2(
      document,
      position,
      htmlDocument,
      this,
      this._suggestSettings
    );
  }
  async doHover(uri, position) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return null;
    }
    const rs = getDocumentRegions(this._languageService, document);
    const rsl = rs.getEmbeddedLanguageAtPosition(position);
    if (rsl) {
      return { $embedded: rsl };
    }
    const htmlDocument = this.getLanguageDocument(document);
    return this._languageService.doHover(document, position, htmlDocument);
  }
  async doFormat(uri, formatRange, options) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return null;
    }
    const contentUnformatted = this._formatSettings.contentUnformatted ?? "";
    const formattingOptions = {
      ...this._formatSettings,
      ...options,
      // remove last newline to allow embedded css to be formatted with newline
      endWithNewline: false,
      // unformat `<script>` tag
      contentUnformatted: contentUnformatted + ", script"
    };
    const edits = this._languageService.format(document, formatRange, formattingOptions);
    if (this._formatSettings.endWithNewline) {
      const text = document.getText();
      edits.push({
        range: {
          start: document.positionAt(text.length),
          end: document.positionAt(text.length)
        },
        newText: "\n"
      });
    }
    return edits;
  }
  async doRename(uri, position, newName) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return null;
    }
    const rs = getDocumentRegions(this._languageService, document);
    const rsl = rs.getEmbeddedLanguageAtPosition(position);
    if (rsl) {
      return { $embedded: rsl };
    }
    const htmlDocument = this.getLanguageDocument(document);
    return this._languageService.doRename(document, position, newName, htmlDocument);
  }
  async findDefinition(uri, position) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return null;
    }
    const rs = getDocumentRegions(this._languageService, document);
    const rsl = rs.getEmbeddedLanguageAtPosition(position);
    if (rsl) {
      return { $embedded: rsl };
    }
    return null;
  }
  async findReferences(uri, position) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return null;
    }
    const rs = getDocumentRegions(this._languageService, document);
    const rsl = rs.getEmbeddedLanguageAtPosition(position);
    if (rsl) {
      return { $embedded: rsl };
    }
    return null;
  }
  async findDocumentLinks(uri) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return null;
    }
    return this._languageService.findDocumentLinks(document, this);
  }
  async findDocumentSymbols(uri) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return null;
    }
    const htmlDocument = this.getLanguageDocument(document);
    return this._languageService.findDocumentSymbols2(
      document,
      htmlDocument
    );
  }
  async findDocumentHighlights(uri, position) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return [];
    }
    const rs = getDocumentRegions(this._languageService, document);
    const rsl = rs.getEmbeddedLanguageAtPosition(position);
    if (rsl) {
      return { $embedded: rsl };
    }
    const htmlDocument = this.getLanguageDocument(document);
    return this._languageService.findDocumentHighlights(
      document,
      position,
      htmlDocument
    );
  }
  async getFoldingRanges(uri, context) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return null;
    }
    const ranges = this._languageService.getFoldingRanges(document, context);
    const rs = getDocumentRegions(this._languageService, document);
    const rsls = rs.getEmbeddedLanguages(true);
    if (rsls.length > 0) {
      return {
        $embedded: {
          languageIds: rsls,
          origin: ranges
        }
      };
    }
    return ranges;
  }
  async getSelectionRanges(uri, positions) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return [];
    }
    return this._languageService.getSelectionRanges(document, positions);
  }
  async findDocumentColors(uri) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return null;
    }
    const rs = getDocumentRegions(this._languageService, document);
    if (rs.hasEmbeddedLanguage("css")) {
      return { $embedded: "css" };
    }
    return null;
  }
  async getColorPresentations(uri, color, range) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return null;
    }
    const rs = getDocumentRegions(this._languageService, document);
    if (rs.hasEmbeddedLanguage("css")) {
      return { $embedded: "css" };
    }
    return null;
  }
  async getEmbeddedDocument(uri, languageId) {
    const document = this.getTextDocument(uri);
    if (!document) {
      return null;
    }
    const rs = getDocumentRegions(this._languageService, document);
    const content = rs.getEmbeddedDocument(languageId, false);
    if (content) {
      return { content };
    }
    return null;
  }
};
initializeWorker(HTMLWorker);
export {
  HTMLWorker
};
