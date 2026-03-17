// node_modules/vscode-languageserver-types/lib/esm/main.js
var DocumentUri;
(function(DocumentUri2) {
  function is(value) {
    return typeof value === "string";
  }
  DocumentUri2.is = is;
})(DocumentUri || (DocumentUri = {}));
var URI;
(function(URI2) {
  function is(value) {
    return typeof value === "string";
  }
  URI2.is = is;
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
(function(Position2) {
  function create(line, character) {
    if (line === Number.MAX_VALUE) {
      line = uinteger.MAX_VALUE;
    }
    if (character === Number.MAX_VALUE) {
      character = uinteger.MAX_VALUE;
    }
    return { line, character };
  }
  Position2.create = create;
  function is(value) {
    let candidate = value;
    return Is.objectLiteral(candidate) && Is.uinteger(candidate.line) && Is.uinteger(candidate.character);
  }
  Position2.is = is;
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
    var _a;
    let candidate = value;
    return Is.defined(candidate) && Range.is(candidate.range) && Is.string(candidate.message) && (Is.number(candidate.severity) || Is.undefined(candidate.severity)) && (Is.integer(candidate.code) || Is.string(candidate.code) || Is.undefined(candidate.code)) && (Is.undefined(candidate.codeDescription) || Is.string((_a = candidate.codeDescription) === null || _a === void 0 ? void 0 : _a.href)) && (Is.string(candidate.source) || Is.undefined(candidate.source)) && (Is.undefined(candidate.relatedInformation) || Is.typedArray(candidate.relatedInformation, DiagnosticRelatedInformation.is));
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
(function(TextDocument2) {
  function create(uri, languageId, version, content) {
    return new FullTextDocument(uri, languageId, version, content);
  }
  TextDocument2.create = create;
  function is(value) {
    let candidate = value;
    return Is.defined(candidate) && Is.string(candidate.uri) && (Is.undefined(candidate.languageId) || Is.string(candidate.languageId)) && Is.uinteger(candidate.lineCount) && Is.func(candidate.getText) && Is.func(candidate.positionAt) && Is.func(candidate.offsetAt) ? true : false;
  }
  TextDocument2.is = is;
  function applyEdits(document, edits) {
    let text = document.getText();
    let sortedEdits = mergeSort(edits, (a, b) => {
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
  TextDocument2.applyEdits = applyEdits;
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

// src/lsp/client.ts
import { cache } from "../cache.mjs";
var monaco;
function init(monacoNS) {
  monaco = monacoNS;
}
function createHost(workspace) {
  return workspace ? {
    fs_readDirectory: (uri) => {
      return workspace.fs.readDirectory(uri);
    },
    fs_stat: (uri) => {
      return workspace.fs.stat(uri);
    },
    fs_getContent: (uri) => {
      return workspace.fs.readTextFile(uri);
    }
  } : /* @__PURE__ */ Object.create(null);
}
async function walkFS(fs, dir = "/") {
  const entries = [];
  for (const [name, type] of await fs.readDirectory(dir || "/")) {
    const path = (dir.endsWith("/") ? dir.slice(0, -1) : dir) + "/" + name;
    if (type === 2) {
      entries.push(...await walkFS(fs, path));
    } else {
      entries.push(path);
    }
  }
  return entries;
}
function lspRequest(req, token) {
  return new Promise((resolve, reject) => {
    if (token.isCancellationRequested) {
      resolve(void 0);
      return;
    }
    token.onCancellationRequested(() => {
      resolve(void 0);
    });
    const ret = req();
    if (ret) {
      ret.then(resolve, reject);
    } else {
      resolve(void 0);
    }
  });
}
var registry = /* @__PURE__ */ new Map();
function registerBasicFeatures(languageId, worker, completionTriggerCharacters, workspace, diagnosticsOptions) {
  const { editor, languages } = monaco;
  const onDispose = async (model) => {
    const workerProxy = await worker.withSyncedResources([]);
    workerProxy.releaseDocument(model.uri.toString());
  };
  editor.onDidChangeModelLanguage(({ model, oldLanguage }) => {
    if (oldLanguage === languageId) {
      onDispose(model);
    }
  });
  editor.onWillDisposeModel((model) => {
    if (model.getLanguageId() === languageId) {
      onDispose(model);
    }
  });
  if (diagnosticsOptions?.validate ?? true) {
    registerDiagnostics(languageId, worker, diagnosticsOptions);
  }
  languages.registerCompletionItemProvider(languageId, new CompletionAdapter(worker, completionTriggerCharacters));
  languages.registerHoverProvider(languageId, new HoverAdapter(worker));
  languages.registerDocumentSymbolProvider(languageId, new DocumentSymbolAdapter(worker));
  languages.registerDefinitionProvider(languageId, new DefinitionAdapter(worker));
  languages.registerReferenceProvider(languageId, new ReferenceAdapter(worker));
  languages.registerRenameProvider(languageId, new RenameAdapter(worker));
  languages.registerDocumentFormattingEditProvider(languageId, new DocumentFormattingEditProvider(worker));
  languages.registerDocumentRangeFormattingEditProvider(languageId, new DocumentRangeFormattingEditProvider(worker));
  languages.registerFoldingRangeProvider(languageId, new FoldingRangeAdapter(worker));
  languages.registerDocumentHighlightProvider(languageId, new DocumentHighlightAdapter(worker));
  languages.registerSelectionRangeProvider(languageId, new SelectionRangeAdapter(worker));
  registry.set(languageId, worker);
  const embeddedExtname = getEmbeddedExtname(languageId);
  monaco.editor.getModels().forEach((model) => {
    const uri = model.uri.toString(true);
    if (uri.endsWith(embeddedExtname)) {
      const masterModel = monaco.editor.getModel(uri.slice(0, -embeddedExtname.length));
      if (masterModel) {
        Reflect.get(masterModel, "refreshDiagnostics")?.();
      }
    }
  });
  if (workspace) {
    workspace.fs.watch("/", { recursive: true }, (kind, path, type) => {
      if (kind !== "modify") {
        worker.getProxy().then((proxy) => proxy.fsNotify(kind, path, type));
      }
    });
  }
}
function registerDiagnostics(languageId, worker, options) {
  const { editor } = monaco;
  const modelChangeListeners = /* @__PURE__ */ new Map();
  const doValidate = async (model) => {
    const workerProxy = await worker.withSyncedResources([model.uri]);
    const diagnostics = await workerProxy.doValidation(model.uri.toString());
    if (diagnostics && !model.isDisposed()) {
      let markers = diagnostics.map(diagnosticToMarker);
      if (options?.filter) {
        markers = markers.filter(options.filter);
      }
      if (options?.codesToIgnore) {
        markers = markers.filter((marker) => {
          const code = typeof marker.code === "string" ? marker.code : marker.code?.value;
          for (const codeToIgnore of options.codesToIgnore) {
            if (code && code === String(codeToIgnore)) {
              return false;
            }
          }
          return true;
        });
      }
      monaco.editor.setModelMarkers(model, languageId, markers);
    }
  };
  const validateModel = (model) => {
    const modelLanugageId = model.getLanguageId();
    const uri = model.uri.toString();
    if (modelLanugageId !== languageId || uri.includes(".(embedded).")) {
      return;
    }
    let timer = null;
    const validate = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        doValidate(model);
      }, 500);
    };
    modelChangeListeners.set(uri, model.onDidChangeContent(validate));
    Reflect.set(model, "refreshDiagnostics", validate);
    doValidate(model);
  };
  const onModelDispose = (model) => {
    const uri = model.uri.toString();
    if (modelChangeListeners.has(uri)) {
      modelChangeListeners.get(uri).dispose();
      modelChangeListeners.delete(uri);
    }
    Reflect.deleteProperty(model, "refreshDiagnostics");
    editor.setModelMarkers(model, languageId, []);
  };
  editor.onDidCreateModel(validateModel);
  editor.onWillDisposeModel(onModelDispose);
  editor.onDidChangeModelLanguage(({ model }) => {
    onModelDispose(model);
    validateModel(model);
  });
  editor.getModels().forEach(validateModel);
}
function diagnosticToMarker(diag) {
  const { range, severity, code, message, source, tags, relatedInformation } = diag;
  const { start, end } = range;
  return {
    startLineNumber: start.line + 1,
    startColumn: start.character + 1,
    endLineNumber: end.line + 1,
    endColumn: end.character + 1,
    severity: convertSeverity(severity),
    code: code?.toString(),
    message,
    source,
    tags,
    relatedInformation: relatedInformation?.map(convertRelatedInformation)
  };
}
function convertSeverity(lsSeverity) {
  switch (lsSeverity) {
    case DiagnosticSeverity.Error:
      return monaco.MarkerSeverity.Error;
    case DiagnosticSeverity.Warning:
      return monaco.MarkerSeverity.Warning;
    case DiagnosticSeverity.Information:
      return monaco.MarkerSeverity.Info;
    case DiagnosticSeverity.Hint:
    default:
      return monaco.MarkerSeverity.Hint;
  }
}
function convertRelatedInformation(info) {
  const { location: { uri, range }, message } = info;
  const { start, end } = range;
  return {
    resource: monaco.Uri.parse(uri),
    startLineNumber: start.line + 1,
    startColumn: start.character + 1,
    endLineNumber: end.line + 1,
    endColumn: end.character + 1,
    message
  };
}
var CompletionAdapter = class {
  constructor(_worker, _triggerCharacters) {
    this._worker = _worker;
    this._triggerCharacters = _triggerCharacters;
  }
  get triggerCharacters() {
    return this._triggerCharacters;
  }
  async provideCompletionItems(model, position, context, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const info = await lspRequest(() => worker?.doComplete(model.uri.toString(), fromPosition(position)), token);
    if (!info) {
      return;
    }
    const wordInfo = model.getWordUntilPosition(position);
    const wordRange = new monaco.Range(
      position.lineNumber,
      wordInfo.startColumn,
      position.lineNumber,
      wordInfo.endColumn
    );
    const items = info.items.map((entry) => {
      const item = {
        command: entry.command && convertCommand(entry.command),
        data: entry.data,
        detail: entry.detail,
        documentation: entry.documentation,
        filterText: entry.filterText,
        insertText: entry.insertText || entry.label,
        kind: convertCompletionItemKind(entry.kind),
        label: entry.label,
        range: wordRange,
        sortText: entry.sortText,
        tags: entry.tags
      };
      if (entry.textEdit) {
        if (isInsertReplaceEdit(entry.textEdit)) {
          item.range = {
            insert: convertRange(entry.textEdit.insert),
            replace: convertRange(entry.textEdit.replace)
          };
        } else {
          item.range = convertRange(entry.textEdit.range);
        }
        item.insertText = entry.textEdit.newText;
      }
      if (entry.additionalTextEdits) {
        item.additionalTextEdits = entry.additionalTextEdits.map(convertTextEdit);
      }
      if (entry.insertTextFormat === InsertTextFormat.Snippet) {
        item.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
      }
      return item;
    });
    return {
      suggestions: items,
      incomplete: info.isIncomplete
    };
  }
  async resolveCompletionItem(item, token) {
    const workerProxy = await lspRequest(() => this._worker.withSyncedResources([]), token);
    const details = await lspRequest(() => workerProxy?.doResolveCompletionItem?.(item), token);
    if (details) {
      item.detail = details.detail;
      item.documentation = details.documentation;
      item.additionalTextEdits = details.additionalTextEdits?.map(convertTextEdit);
    }
    return item;
  }
};
function fromPosition(position) {
  return { character: position.column - 1, line: position.lineNumber - 1 };
}
function fromRange(range) {
  return {
    start: {
      line: range.startLineNumber - 1,
      character: range.startColumn - 1
    },
    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 }
  };
}
function convertRange(range) {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1
  );
}
function isInsertReplaceEdit(edit) {
  return typeof edit.insert !== "undefined" && typeof edit.replace !== "undefined";
}
function convertCompletionItemKind(kind) {
  const CompletionItemKind2 = monaco.languages.CompletionItemKind;
  switch (kind) {
    case CompletionItemKind.Text:
      return CompletionItemKind2.Text;
    case CompletionItemKind.Method:
      return CompletionItemKind2.Method;
    case CompletionItemKind.Function:
      return CompletionItemKind2.Function;
    case CompletionItemKind.Constructor:
      return CompletionItemKind2.Constructor;
    case CompletionItemKind.Field:
      return CompletionItemKind2.Field;
    case CompletionItemKind.Variable:
      return CompletionItemKind2.Variable;
    case CompletionItemKind.Class:
      return CompletionItemKind2.Class;
    case CompletionItemKind.Interface:
      return CompletionItemKind2.Interface;
    case CompletionItemKind.Module:
      return CompletionItemKind2.Module;
    case CompletionItemKind.Property:
      return CompletionItemKind2.Property;
    case CompletionItemKind.Unit:
      return CompletionItemKind2.Unit;
    case CompletionItemKind.Value:
      return CompletionItemKind2.Value;
    case CompletionItemKind.Enum:
      return CompletionItemKind2.Enum;
    case CompletionItemKind.Keyword:
      return CompletionItemKind2.Keyword;
    case CompletionItemKind.Snippet:
      return CompletionItemKind2.Snippet;
    case CompletionItemKind.Color:
      return CompletionItemKind2.Color;
    case CompletionItemKind.File:
      return CompletionItemKind2.File;
    case CompletionItemKind.Reference:
      return CompletionItemKind2.Reference;
    case CompletionItemKind.Folder:
      return CompletionItemKind2.Folder;
    case CompletionItemKind.EnumMember:
      return CompletionItemKind2.EnumMember;
    case CompletionItemKind.Constant:
      return CompletionItemKind2.Constant;
    case CompletionItemKind.Struct:
      return CompletionItemKind2.Struct;
    case CompletionItemKind.Event:
      return CompletionItemKind2.Event;
    case CompletionItemKind.Operator:
      return CompletionItemKind2.Operator;
    case CompletionItemKind.TypeParameter:
      return CompletionItemKind2.TypeParameter;
    default:
      return CompletionItemKind2.Property;
  }
}
function convertTextEdit(textEdit) {
  return {
    range: convertRange(textEdit.range),
    text: textEdit.newText
  };
}
function convertCommand(c) {
  return c ? { id: c.command ?? Reflect.get(c, "id"), title: c.title, arguments: c.arguments } : void 0;
}
var HoverAdapter = class {
  constructor(_worker) {
    this._worker = _worker;
  }
  async provideHover(model, position, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const info = await lspRequest(() => worker?.doHover(model.uri.toString(), fromPosition(position)), token);
    if (info) {
      return {
        range: info.range ? convertRange(info.range) : void 0,
        contents: convertMarkedStringArray(info.contents)
      };
    }
  }
};
function isMarkupContent(v) {
  return v && typeof v === "object" && typeof v.kind === "string";
}
function convertMarkdownString(entry) {
  if (typeof entry === "string") {
    return { value: entry };
  }
  if (isMarkupContent(entry)) {
    if (entry.kind === "plaintext") {
      return { value: entry.value.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&") };
    }
    return { value: entry.value };
  }
  return { value: "```" + entry.language + "\n" + entry.value + "\n```\n" };
}
function convertMarkedStringArray(contents) {
  if (Array.isArray(contents)) {
    return contents.map(convertMarkdownString);
  }
  return [convertMarkdownString(contents)];
}
function registerSignatureHelp(languageId, worker, triggerCharacters) {
  monaco.languages.registerSignatureHelpProvider(
    languageId,
    new SignatureHelpAdapter(worker, triggerCharacters)
  );
}
var SignatureHelpAdapter = class {
  constructor(_worker, _triggerCharacters) {
    this._worker = _worker;
    this._triggerCharacters = _triggerCharacters;
  }
  get signatureHelpTriggerCharacters() {
    return this._triggerCharacters;
  }
  async provideSignatureHelp(model, position, token, context) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const helpInfo = await lspRequest(() => worker?.doSignatureHelp(model.uri.toString(), model.getOffsetAt(position), context), token);
    if (!helpInfo || model.isDisposed()) {
      return void 0;
    }
    helpInfo.signatures?.forEach((s) => {
      if (typeof s.documentation === "string") {
        s.documentation = { kind: "markdown", value: s.documentation };
      }
    });
    return {
      value: helpInfo,
      dispose() {
      }
    };
  }
};
function registerCodeAction(languageId, worker) {
  monaco.languages.registerCodeActionProvider(languageId, new CodeActionAdaptor(worker));
}
var CodeActionAdaptor = class {
  constructor(_worker) {
    this._worker = _worker;
  }
  async provideCodeActions(model, range, context, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const codeActions = await lspRequest(
      () => {
        const modelOptions = model.getOptions();
        const formatOptions = {
          tabSize: modelOptions.tabSize,
          insertSpaces: modelOptions.insertSpaces,
          trimTrailingWhitespace: modelOptions.trimAutoWhitespace
        };
        return worker?.doCodeAction(model.uri.toString(), fromRange(range), fromCodeActionContext(context), formatOptions);
      },
      token
    );
    if (codeActions) {
      return {
        actions: codeActions.map((action) => ({
          kind: action.kind ?? "quickfix",
          title: action.title,
          edit: action.edit && convertWorkspaceEdit(action.edit),
          diagnostics: context.markers,
          command: action.command && convertCommand(action.command)
        })),
        dispose: () => {
        }
      };
    }
  }
};
function fromCodeActionContext(context) {
  return {
    diagnostics: context.markers.map(fromMarkerToDiagnostic),
    only: context.only ? [context.only] : void 0,
    triggerKind: context.trigger
  };
}
function fromMarkerToDiagnostic(marker) {
  return {
    code: typeof marker.code === "string" ? marker.code : marker.code?.value,
    message: marker.message,
    range: fromRange(marker),
    severity: fromDiagnosticSeverity(marker.severity),
    source: marker.source,
    tags: marker.tags
  };
}
function fromDiagnosticSeverity(severity) {
  switch (severity) {
    case monaco.MarkerSeverity.Error:
      return DiagnosticSeverity.Error;
    case monaco.MarkerSeverity.Warning:
      return DiagnosticSeverity.Warning;
    case monaco.MarkerSeverity.Hint:
      return DiagnosticSeverity.Hint;
    default:
      return DiagnosticSeverity.Information;
  }
}
var RenameAdapter = class {
  constructor(_worker) {
    this._worker = _worker;
  }
  async provideRenameEdits(model, position, newName, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const edit = await lspRequest(() => worker?.doRename(model.uri.toString(), fromPosition(position), newName), token);
    if (edit) {
      return convertWorkspaceEdit(edit);
    }
  }
};
function convertWorkspaceEdit(edit) {
  if (!edit.changes) {
    return void 0;
  }
  let resourceEdits = [];
  for (let uri in edit.changes) {
    const resource = monaco.Uri.parse(uri);
    for (let change of edit.changes[uri]) {
      resourceEdits.push({
        resource,
        versionId: void 0,
        textEdit: {
          range: convertRange(change.range),
          text: change.newText
        }
      });
    }
  }
  return { edits: resourceEdits };
}
var DocumentFormattingEditProvider = class {
  constructor(_worker) {
    this._worker = _worker;
  }
  async provideDocumentFormattingEdits(model, options, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const edits = await lspRequest(() => worker?.doFormat(model.uri.toString(), null, options), token);
    if (edits) {
      return edits.map(convertTextEdit);
    }
  }
};
var DocumentRangeFormattingEditProvider = class {
  constructor(_worker) {
    this._worker = _worker;
  }
  async provideDocumentRangeFormattingEdits(model, range, options, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const edits = await lspRequest(() => worker?.doFormat(model.uri.toString(), fromRange(range), options), token);
    if (edits) {
      return edits.map(convertTextEdit);
    }
  }
};
function registerAutoComplete(langaugeId, worker, triggerCharacters) {
  const { editor } = monaco;
  const listeners = /* @__PURE__ */ new Map();
  const validateModel = async (model) => {
    if (model.getLanguageId() !== langaugeId) {
      return;
    }
    const modelUri = model.uri.toString();
    listeners.set(
      modelUri,
      model.onDidChangeContent(async (e) => {
        const lastChange = e.changes[e.changes.length - 1];
        const lastCharacter = lastChange.text[lastChange.text.length - 1];
        if (triggerCharacters.includes(lastCharacter)) {
          const lastRange = lastChange.range;
          const position = new monaco.Position(lastRange.endLineNumber, lastRange.endColumn + lastChange.text.length);
          const workerProxy = await worker.withSyncedResources([model.uri]);
          const snippet = await workerProxy.doAutoComplete(modelUri, fromPosition(position), lastCharacter);
          if (snippet) {
            const cursor = snippet.indexOf("$0");
            const insertText = cursor >= 0 ? snippet.replace("$0", "") : snippet;
            const range = new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column);
            model.pushEditOperations([], [{ range, text: insertText }], () => []);
            if (cursor >= 0) {
              const focusEditor = editor.getEditors().find((e2) => e2.hasTextFocus());
              focusEditor?.setPosition(position.delta(0, cursor));
            }
          }
        }
      })
    );
  };
  editor.onDidCreateModel(validateModel);
  editor.onDidChangeModelLanguage(({ model, oldLanguage }) => {
    const modelUri = model.uri.toString();
    if (oldLanguage === langaugeId && listeners.has(modelUri)) {
      listeners.get(modelUri)?.dispose();
      listeners.delete(modelUri);
    }
    validateModel(model);
  });
  editor.onWillDisposeModel((model) => {
    const modelUri = model.uri.toString();
    if (model.getLanguageId() === langaugeId && listeners.has(modelUri)) {
      listeners.get(modelUri)?.dispose();
      listeners.delete(modelUri);
    }
  });
  editor.getModels().forEach(validateModel);
}
var DocumentSymbolAdapter = class {
  constructor(_worker) {
    this._worker = _worker;
  }
  async provideDocumentSymbols(model, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const items = await lspRequest(() => worker?.findDocumentSymbols(model.uri.toString()), token);
    if (items) {
      return items.map((item) => {
        if (isDocumentSymbol(item)) {
          return convertDocumentSymbol(item);
        }
        return {
          name: item.name,
          detail: "",
          containerName: item.containerName,
          kind: convertSymbolKind(item.kind),
          range: convertRange(item.location.range),
          selectionRange: convertRange(item.location.range),
          tags: item.tags ?? []
        };
      });
    }
  }
};
function isDocumentSymbol(symbol) {
  return "children" in symbol;
}
function convertDocumentSymbol(symbol) {
  return {
    name: symbol.name,
    detail: symbol.detail ?? "",
    kind: convertSymbolKind(symbol.kind),
    range: convertRange(symbol.range),
    selectionRange: convertRange(symbol.selectionRange),
    tags: symbol.tags ?? [],
    children: (symbol.children ?? []).map((item) => convertDocumentSymbol(item)),
    containerName: Reflect.get(symbol, "containerName")
  };
}
function convertSymbolKind(kind) {
  const mKind = monaco.languages.SymbolKind;
  switch (kind) {
    case SymbolKind.File:
      return mKind.File;
    case SymbolKind.Module:
      return mKind.Module;
    case SymbolKind.Namespace:
      return mKind.Namespace;
    case SymbolKind.Package:
      return mKind.Package;
    case SymbolKind.Class:
      return mKind.Class;
    case SymbolKind.Method:
      return mKind.Method;
    case SymbolKind.Property:
      return mKind.Property;
    case SymbolKind.Field:
      return mKind.Field;
    case SymbolKind.Constructor:
      return mKind.Constructor;
    case SymbolKind.Enum:
      return mKind.Enum;
    case SymbolKind.Interface:
      return mKind.Interface;
    case SymbolKind.Function:
      return mKind.Function;
    case SymbolKind.Variable:
      return mKind.Variable;
    case SymbolKind.Constant:
      return mKind.Constant;
    case SymbolKind.String:
      return mKind.String;
    case SymbolKind.Number:
      return mKind.Number;
    case SymbolKind.Boolean:
      return mKind.Boolean;
    case SymbolKind.Array:
      return mKind.Array;
  }
  return mKind.Function;
}
var DefinitionAdapter = class {
  constructor(_worker) {
    this._worker = _worker;
  }
  async provideDefinition(model, position, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const definition = await lspRequest(() => worker?.findDefinition(model.uri.toString(), fromPosition(position)), token);
    if (definition) {
      const links = (Array.isArray(definition) ? definition : [definition]).map(convertLocationLink);
      await ensureHttpModels(links);
      return links;
    }
  }
};
function isLocationLink(location) {
  return "targetUri" in location && "targetRange" in location;
}
function convertLocationLink(location) {
  let uri;
  let range;
  let targetSelectionRange;
  let originSelectionRange;
  if (isLocationLink(location)) {
    uri = location.targetUri;
    range = location.targetRange;
    targetSelectionRange = location.targetSelectionRange;
    originSelectionRange = location.originSelectionRange;
  } else {
    uri = location.uri;
    range = location.range;
  }
  if (uri.includes(".(embedded).")) {
    uri = uri.slice(0, uri.lastIndexOf(".(embedded)."));
  }
  return {
    uri: monaco.Uri.parse(uri),
    range: convertRange(range),
    targetSelectionRange: targetSelectionRange ? convertRange(targetSelectionRange) : void 0,
    originSelectionRange: originSelectionRange ? convertRange(originSelectionRange) : void 0
  };
}
async function ensureHttpModels(links) {
  const { editor, Uri } = monaco;
  const httpUrls = new Set(
    links.map((link) => link.uri).filter((uri) => !editor.getModel(uri) && (uri.scheme === "https" || uri.scheme === "http")).map((uri) => uri.toString())
  );
  await Promise.all(
    [...httpUrls].map(async (url) => {
      const text = await cache.fetch(url).then((res) => res.text());
      const uri = Uri.parse(url);
      if (!editor.getModel(uri)) {
        editor.createModel(text, void 0, uri);
      }
    })
  );
}
var ReferenceAdapter = class {
  constructor(_worker) {
    this._worker = _worker;
  }
  async provideReferences(model, position, context, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const references = await lspRequest(() => worker?.findReferences(model.uri.toString(), fromPosition(position)), token);
    if (references) {
      const links = references.map(convertLocationLink);
      await ensureHttpModels(links);
      return links;
    }
  }
};
function registerDocumentLinks(langaugeId, worker) {
  monaco.languages.registerLinkProvider(langaugeId, new DocumentLinkAdapter(worker));
}
var DocumentLinkAdapter = class {
  constructor(_worker) {
    this._worker = _worker;
  }
  async provideLinks(model, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const items = await lspRequest(() => worker?.findDocumentLinks(model.uri.toString()), token);
    if (items) {
      const links = items.map((item) => ({
        range: convertRange(item.range),
        url: item.target
      }));
      return { links };
    }
  }
};
function registerColorPresentation(langaugeId, worker) {
  monaco.languages.registerColorProvider(langaugeId, new DocumentColorAdapter(worker));
}
var DocumentColorAdapter = class {
  constructor(_worker) {
    this._worker = _worker;
  }
  async provideDocumentColors(model, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const colors = await lspRequest(() => worker?.findDocumentColors(model.uri.toString()), token);
    if (colors) {
      return colors.map((item) => ({
        color: item.color,
        range: convertRange(item.range)
      }));
    }
  }
  async provideColorPresentations(model, info, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const presentations = await lspRequest(
      () => worker?.getColorPresentations(model.uri.toString(), info.color, fromRange(info.range)),
      token
    );
    if (presentations) {
      return presentations.map((presentation) => ({
        label: presentation.label,
        textEdit: presentation.textEdit ? convertTextEdit(presentation.textEdit) : void 0,
        additionalTextEdits: presentation.additionalTextEdits?.map(convertTextEdit)
      }));
    }
  }
};
var DocumentHighlightAdapter = class {
  constructor(_worker) {
    this._worker = _worker;
  }
  async provideDocumentHighlights(model, position, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const entries = await lspRequest(() => worker?.findDocumentHighlights(model.uri.toString(), fromPosition(position)), token);
    if (entries) {
      return entries.map((entry) => {
        return {
          range: convertRange(entry.range),
          kind: convertDocumentHighlightKind(entry.kind)
        };
      });
    }
  }
};
function convertDocumentHighlightKind(kind) {
  switch (kind) {
    case DocumentHighlightKind.Read:
      return monaco.languages.DocumentHighlightKind.Read;
    case DocumentHighlightKind.Write:
      return monaco.languages.DocumentHighlightKind.Write;
    case DocumentHighlightKind.Text:
      return monaco.languages.DocumentHighlightKind.Text;
  }
  return monaco.languages.DocumentHighlightKind.Text;
}
var FoldingRangeAdapter = class {
  constructor(_worker) {
    this._worker = _worker;
  }
  async provideFoldingRanges(model, context, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const ranges = await lspRequest(() => worker?.getFoldingRanges(model.uri.toString(), context), token);
    if (ranges) {
      return ranges.map((range) => {
        const result = {
          start: range.startLine + 1,
          end: range.endLine + 1
        };
        if (typeof range.kind !== "undefined") {
          result.kind = convertFoldingRangeKind(range.kind);
        }
        return result;
      });
    }
  }
};
function convertFoldingRangeKind(kind) {
  switch (kind) {
    case FoldingRangeKind.Comment:
      return monaco.languages.FoldingRangeKind.Comment;
    case FoldingRangeKind.Imports:
      return monaco.languages.FoldingRangeKind.Imports;
    case FoldingRangeKind.Region:
      return monaco.languages.FoldingRangeKind.Region;
  }
  return void 0;
}
var SelectionRangeAdapter = class {
  constructor(_worker) {
    this._worker = _worker;
  }
  async provideSelectionRanges(model, positions, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const selectionRanges = await lspRequest(() => worker?.getSelectionRanges(model.uri.toString(), positions.map(fromPosition)), token);
    if (selectionRanges) {
      return selectionRanges.map(
        (selectionRange) => {
          const result = [];
          while (selectionRange) {
            result.push({ range: convertRange(selectionRange.range) });
            selectionRange = selectionRange.parent;
          }
          return result;
        }
      );
    }
  }
};
var LinkedEditingRangeAdapter = class {
  constructor(_worker) {
    this._worker = _worker;
  }
  async provideLinkedEditingRanges(model, position, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const editingRange = await lspRequest(
      () => worker?.getLinkedEditingRangeAtPosition(model.uri.toString(), fromPosition(position)),
      token
    );
    if (editingRange) {
      const { wordPattern, ranges } = editingRange;
      return {
        ranges: ranges.map((range) => convertRange(range)),
        wordPattern: wordPattern ? new RegExp(wordPattern) : void 0
      };
    }
  }
};
var InlayHintsAdapter = class {
  constructor(_worker) {
    this._worker = _worker;
  }
  async provideInlayHints(model, range, token) {
    const worker = await lspRequest(() => this._worker.withSyncedResources([model.uri]), token);
    const hints = await lspRequest(() => worker?.provideInlayHints(model.uri.toString(), fromRange(range)), token);
    return { hints: hints?.map(convertInlayHint) ?? [], dispose: () => {
    } };
  }
};
function convertInlayHint(hint) {
  return {
    label: convertLabelText(hint.label),
    tooltip: hint.tooltip,
    textEdits: hint.textEdits?.map(convertTextEdit),
    position: convertPosition(hint.position),
    kind: hint.kind,
    paddingLeft: hint.paddingLeft,
    paddingRight: hint.paddingRight
  };
}
function convertLabelText(label) {
  if (typeof label === "string") {
    return label;
  }
  return label.map(convertInlayHintLabelPart);
}
function convertInlayHintLabelPart(part) {
  return {
    label: part.value,
    tooltip: part.tooltip,
    command: convertCommand(part.command),
    location: part.location ? convertLocationLink(part.location) : void 0
  };
}
function convertPosition(position) {
  return new monaco.Position(position.line + 1, position.character + 1);
}
function registerEmbedded(languageId, mainWorker, languages) {
  const { editor, Uri } = monaco;
  const listeners = /* @__PURE__ */ new Map();
  const validateModel = async (model) => {
    if (model.getLanguageId() !== languageId) {
      return;
    }
    const modelUri = model.uri.toString();
    const getEmbeddedDocument = async (rsl) => {
      const workerProxy = await mainWorker.withSyncedResources([model.uri]);
      return workerProxy.getEmbeddedDocument(modelUri, rsl);
    };
    const attachEmbeddedLanguage = async (languageId2) => {
      const uri = Uri.parse(model.uri.path + getEmbeddedExtname(languageId2));
      const doc = await getEmbeddedDocument(languageId2);
      if (doc) {
        let embeddedModel = editor.getModel(uri);
        if (!embeddedModel) {
          embeddedModel = editor.createModel(doc.content, normalizeLanguageId(languageId2), uri);
          Reflect.set(embeddedModel, "_versionId", model.getVersionId());
        } else {
          embeddedModel.setValue(doc.content);
        }
      } else {
        const embeddedModel = editor.getModel(uri);
        if (embeddedModel) {
          embeddedModel.dispose();
        }
      }
    };
    const attachAll = () => languages.forEach(attachEmbeddedLanguage);
    listeners.set(modelUri, model.onDidChangeContent(attachAll));
    attachAll();
  };
  const cleanUp = (model) => {
    const uri = model.uri.toString();
    if (listeners.has(uri)) {
      listeners.get(uri).dispose();
      listeners.delete(uri);
    }
    languages.forEach((languageId2) => {
      const uri2 = Uri.parse(model.uri.path + getEmbeddedExtname(languageId2));
      editor.getModel(uri2)?.dispose();
    });
  };
  editor.onDidCreateModel(validateModel);
  editor.onWillDisposeModel((model) => {
    if (model.getLanguageId() === languageId) {
      cleanUp(model);
    }
  });
  editor.onDidChangeModelLanguage(({ model, oldLanguage }) => {
    if (oldLanguage === languageId) {
      cleanUp(model);
    }
    validateModel(model);
  });
  editor.getModels().forEach(validateModel);
}
function createWorkerWithEmbeddedLanguages(mainWorker) {
  const redirectLSPRequest = async (rsl, method, uri, ...args) => {
    const langaugeId = normalizeLanguageId(rsl);
    const worker = registry.get(langaugeId);
    if (worker) {
      const embeddedUri = monaco.Uri.parse(uri + getEmbeddedExtname(rsl));
      return worker.withSyncedResources([embeddedUri]).then((worker2) => worker2[method]?.(embeddedUri.toString(), ...args));
    }
    return null;
  };
  return {
    withSyncedResources: async (resources) => {
      const workerProxy = await mainWorker.withSyncedResources(resources);
      return new Proxy(workerProxy, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value === "function") {
            return async (uri, ...args) => {
              const ret = await value(uri, ...args);
              if (typeof ret === "object" && ret != null && !Array.isArray(ret) && "$embedded" in ret) {
                const embedded = ret.$embedded;
                if (typeof embedded === "string") {
                  return redirectLSPRequest(embedded, prop, uri, ...args);
                } else if (typeof embedded === "object" && embedded != null) {
                  const { languageIds, data, origin } = embedded;
                  const promises = languageIds.map(
                    (rsl, i) => redirectLSPRequest(rsl, prop, uri, ...args, data?.[i])
                  );
                  const results = await Promise.all(promises);
                  return origin.concat(...results.filter((r) => Array.isArray(r)));
                }
                return null;
              }
              return ret;
            };
          }
          return value;
        }
      });
    },
    dispose: () => mainWorker.dispose(),
    getProxy: () => mainWorker.getProxy()
  };
}
function normalizeLanguageId(languageId) {
  return languageId === "importmap" ? "json" : languageId;
}
function getEmbeddedExtname(rsl) {
  return ".(embedded)." + (rsl === "javascript" ? "js" : rsl);
}
export {
  CodeActionAdaptor,
  CompletionAdapter,
  DefinitionAdapter,
  DocumentColorAdapter,
  DocumentFormattingEditProvider,
  DocumentHighlightAdapter,
  DocumentLinkAdapter,
  DocumentRangeFormattingEditProvider,
  DocumentSymbolAdapter,
  FoldingRangeAdapter,
  HoverAdapter,
  InlayHintsAdapter,
  LinkedEditingRangeAdapter,
  ReferenceAdapter,
  RenameAdapter,
  SelectionRangeAdapter,
  SignatureHelpAdapter,
  convertRange,
  convertTextEdit,
  createHost,
  createWorkerWithEmbeddedLanguages,
  fromPosition,
  fromRange,
  init,
  registerAutoComplete,
  registerBasicFeatures,
  registerCodeAction,
  registerColorPresentation,
  registerDocumentLinks,
  registerEmbedded,
  registerSignatureHelp,
  walkFS
};
