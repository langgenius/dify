const translation = {
  creation: {
    createFromScratch: {
      title: 'Leere Wissenspipeline',
      description: 'Erstellen Sie eine benutzerdefinierte Pipeline von Grund auf neu mit vollständiger Kontrolle über die Datenverarbeitung und -struktur.',
    },
    caution: 'Vorsicht',
    backToKnowledge: 'Zurück zu Wissen',
    createKnowledge: 'Wissen schaffen',
    importDSL: 'Importieren aus einer DSL-Datei',
    successTip: 'Erfolgreich eine Wissensdatenbank erstellt',
    errorTip: 'Fehler beim Erstellen einer Wissensdatenbank',
  },
  templates: {
    customized: 'Angepasst',
  },
  operations: {
    dataSource: 'Datenquelle',
    details: 'Details',
    process: 'Prozess',
    preview: 'Vorschau',
    convert: 'Umwandeln',
    useTemplate: 'Verwenden dieser Wissenspipeline',
    backToDataSource: 'Zurück zur Datenquelle',
    exportPipeline: 'Pipeline exportieren',
    editInfo: 'Info bearbeiten',
    choose: 'Wählen',
    saveAndProcess: 'Speichern & Verarbeiten',
  },
  deletePipeline: {
    title: 'Sind Sie sicher, dass Sie diese Pipeline-Vorlage löschen möchten?',
    content: 'Das Löschen der Pipelinevorlage kann nicht rückgängig gemacht werden.',
  },
  publishPipeline: {
    success: {
      message: 'Knowledge Pipeline veröffentlicht',
    },
    error: {
      message: 'Fehler beim Veröffentlichen der Wissenspipeline',
    },
  },
  publishTemplate: {
    success: {
      learnMore: 'Weitere Informationen',
      tip: 'Sie können diese Vorlage auf der Erstellungsseite verwenden.',
      message: 'Pipeline-Vorlage veröffentlicht',
    },
    error: {
      message: 'Fehler beim Veröffentlichen der Pipeline-Vorlage',
    },
  },
  exportDSL: {
    successTip: 'Pipeline-DSL erfolgreich exportieren',
    errorTip: 'Fehler beim Exportieren der Pipeline-DSL',
  },
  details: {
    structure: 'Struktur',
    structureTooltip: 'Die Blockstruktur bestimmt, wie Dokumente aufgeteilt und indiziert werden, und bietet die Modi "Allgemein", "Über-Eltern-Kind" und "Q&A" und ist für jede Wissensdatenbank einzigartig.',
  },
  testRun: {
    steps: {
      documentProcessing: 'Verarbeitung von Dokumenten',
      dataSource: 'Datenquelle',
    },
    dataSource: {
      localFiles: 'Lokale Dateien',
    },
    notion: {
      docTitle: 'Notion docs',
      title: 'Wählen Sie Notion Pages',
    },
    title: 'Testlauf',
    tooltip: 'Im Testlaufmodus darf jeweils nur ein Dokument importiert werden, um das Debuggen und Beobachten zu vereinfachen.',
  },
  inputFieldPanel: {
    uniqueInputs: {
      title: 'Einzigartige Eingänge für jeden Eingang',
      tooltip: 'Eindeutige Eingaben sind nur für die ausgewählte Datenquelle und ihre Downstream-Knoten zugänglich. Benutzer müssen sie nicht ausfüllen, wenn sie andere Datenquellen auswählen. Im ersten Schritt (Datenquelle) werden nur Eingabefelder angezeigt, auf die von Datenquellenvariablen verwiesen wird. Alle anderen Felder werden im zweiten Schritt (Dokumente bearbeiten) angezeigt.',
    },
    globalInputs: {
      title: 'Globale Eingänge für alle Eingänge',
      tooltip: 'Globale Eingaben werden von allen Knoten gemeinsam genutzt. Benutzer müssen sie ausfüllen, wenn sie eine Datenquelle auswählen. Beispielsweise können Felder wie Trennzeichen und maximale Blocklänge einheitlich auf mehrere Datenquellen angewendet werden. Im ersten Schritt (Datenquelle) werden nur Eingabefelder angezeigt, die von Datenquellenvariablen referenziert werden. Alle anderen Felder werden im zweiten Schritt (Dokumente bearbeiten) angezeigt.',
    },
    preview: {
      stepTwoTitle: 'Dokumente verarbeiten',
      stepOneTitle: 'Datenquelle',
    },
    error: {
      variableDuplicate: 'Der Variablenname ist bereits vorhanden. Bitte wählen Sie einen anderen Namen.',
    },
    editInputField: 'Eingabefeld bearbeiten',
    addInputField: 'Eingabefeld hinzufügen',
    title: 'Eingabefelder für Benutzer',
    description: 'Benutzereingabefelder werden verwendet, um Variablen zu definieren und zu erfassen, die während des Pipeline-Ausführungsprozesses erforderlich sind. Benutzer können den Feldtyp anpassen und den Eingabewert flexibel konfigurieren, um den Anforderungen verschiedener Datenquellen oder Dokumentverarbeitungsschritte gerecht zu werden.',
  },
  addDocuments: {
    steps: {
      processDocuments: 'Dokumente verarbeiten',
      processingDocuments: 'Verarbeiten von Dokumenten',
      chooseDatasource: 'Auswählen einer Datenquelle',
    },
    stepOne: {
      preview: 'Vorschau',
    },
    stepTwo: {
      previewChunks: 'Vorschau von Chunks',
      chunkSettings: 'Chunk-Einstellungen',
    },
    stepThree: {
      learnMore: 'Weitere Informationen',
    },
    characters: 'Zeichen',
    backToDataSource: 'Datenquelle',
    title: 'Dokumente hinzufügen',
  },
  documentSettings: {
    title: 'Dokument-Einstellungen',
  },
  onlineDocument: {},
  onlineDrive: {
    breadcrumbs: {
      allFiles: 'Alle Dateien',
      allBuckets: 'Alle Cloud Storage-Buckets',
      searchPlaceholder: 'Dateien suchen...',
    },
    emptySearchResult: 'Es wurden keine Gegenstände gefunden',
    resetKeywords: 'Schlüsselwörter zurücksetzen',
    notSupportedFileType: 'Dieser Dateityp wird nicht unterstützt',
    emptyFolder: 'Dieser Ordner ist leer',
  },
  credentialSelector: {},
  conversion: {
    confirm: {
      title: 'Bestätigung',
      content: 'Diese Aktion ist dauerhaft. Sie können die vorherige Methode nicht wiederherstellen. Bitte bestätigen Sie, um umzurechnen.',
    },
    title: 'In Wissenspipeline konvertieren',
    successMessage: 'Erfolgreiches Konvertieren des Datasets in eine Pipeline',
    errorMessage: 'Fehler beim Konvertieren des Datasets in eine Pipeline.',
    warning: 'Diese Aktion kann nicht rückgängig gemacht werden.',
    descriptionChunk1: 'Sie können jetzt Ihre vorhandene Wissensdatenbank konvertieren, um die Knowledge Pipeline für die Dokumentenverarbeitung zu verwenden',
    descriptionChunk2: '– ein offenerer und flexiblerer Ansatz mit Zugang zu Plugins aus unserem Marktplatz. Dadurch wird die neue Verarbeitungsmethode auf alle zukünftigen Dokumente angewendet.',
  },
  knowledgePermissions: 'Erlaubnisse',
  inputField: 'Eingabefeld',
  knowledgeDescription: 'Beschreibung des Wissens',
  editPipelineInfo: 'Bearbeiten von Pipeline-Informationen',
  knowledgeNameAndIcon: 'Name und Symbol des Wissens',
  pipelineNameAndIcon: 'Name und Symbol der Pipeline',
  knowledgeDescriptionPlaceholder: 'Beschreiben Sie, was in dieser Wissensdatenbank enthalten ist. Eine detaillierte Beschreibung ermöglicht es der KI, genauer auf den Inhalt des Datensatzes zuzugreifen. Wenn das Feld leer ist, verwendet Dify die Standard-Trefferstrategie. (Fakultativ)',
  knowledgeNameAndIconPlaceholder: 'Bitte geben Sie den Namen der Knowledge Base ein.',
}

export default translation
