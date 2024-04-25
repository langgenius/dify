const translation = {
  knowledge: 'Wissen',
  documentCount: ' Dokumente',
  wordCount: ' k Wörter',
  appCount: ' verknüpfte Apps',
  createDataset: 'Wissen erstellen',
  createDatasetIntro: 'Importiere deine eigenen Textdaten oder schreibe Daten in Echtzeit über Webhook für die LLM-Kontextverbesserung.',
  deleteDatasetConfirmTitle: 'Dieses Wissen löschen?',
  deleteDatasetConfirmContent:
    'Das Löschen des Wissens ist unwiderruflich. Benutzer werden nicht mehr auf Ihr Wissen zugreifen können und alle Eingabeaufforderungen, Konfigurationen und Protokolle werden dauerhaft gelöscht.',
  datasetDeleted: 'Wissen gelöscht',
  datasetDeleteFailed: 'Löschen des Wissens fehlgeschlagen',
  didYouKnow: 'Wusstest du schon?',
  intro1: 'Das Wissen kann in die Dify-Anwendung ',
  intro2: 'als Kontext',
  intro3: ',',
  intro4: 'oder es ',
  intro5: 'kann erstellt werden',
  intro6: ' als ein eigenständiges ChatGPT-Index-Plugin zum Veröffentlichen',
  unavailable: 'Nicht verfügbar',
  unavailableTip: 'Einbettungsmodell ist nicht verfügbar, das Standard-Einbettungsmodell muss konfiguriert werden',
  datasets: 'WISSEN',
  datasetsApi: 'API',
  retrieval: {
    semantic_search: {
      title: 'Vektorsuche',
      description: 'Erzeuge Abfrage-Einbettungen und suche nach dem Textstück, das seiner Vektorrepräsentation am ähnlichsten ist.',
    },
    full_text_search: {
      title: 'Volltextsuche',
      description: 'Indiziere alle Begriffe im Dokument, sodass Benutzer jeden Begriff suchen und den relevanten Textabschnitt finden können, der diese Begriffe enthält.',
    },
    hybrid_search: {
      title: 'Hybridsuche',
      description: 'Führe Volltextsuche und Vektorsuchen gleichzeitig aus, ordne neu, um die beste Übereinstimmung für die Abfrage des Benutzers auszuwählen. Konfiguration des Rerank-Modell-APIs ist notwendig.',
      recommend: 'Empfehlen',
    },
    invertedIndex: {
      title: 'Invertierter Index',
      description: 'Ein invertierter Index ist eine Struktur, die für effiziente Abfragen verwendet wird. Organisiert nach Begriffen, zeigt jeder Begriff auf Dokumente oder Webseiten, die ihn enthalten.',
    },
    change: 'Ändern',
    changeRetrievalMethod: 'Abfragemethode ändern',
  },
  docsFailedNotice: 'Dokumente konnten nicht indiziert werden',
  retry: 'Wiederholen',
}

export default translation
