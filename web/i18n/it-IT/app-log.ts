const translation = {
  title: 'Registri',
  description:
    'I registri registrano lo stato di esecuzione dell\'applicazione, inclusi input degli utenti e risposte AI.',
  dateTimeFormat: 'MM/DD/YYYY hh:mm A',
  table: {
    header: {
      time: 'Ora',
      endUser: 'Utente Finale',
      input: 'Input',
      output: 'Output',
      summary: 'Titolo',
      messageCount: 'Conteggio Messaggi',
      userRate: 'Valutazione Utente',
      adminRate: 'Valutazione Op.',
      startTime: 'ORA INIZIO',
      status: 'STATO',
      runtime: 'TEMPO DI ESECUZIONE',
      tokens: 'TOKEN',
      user: 'UTENTE FINALE',
      version: 'VERSIONE',
    },
    pagination: {
      previous: 'Prec',
      next: 'Succ',
    },
    empty: {
      noChat: 'Nessuna conversazione ancora',
      noOutput: 'Nessun output',
      element: {
        title: 'C\'è qualcuno?',
        content:
          'Osserva e annota le interazioni tra gli utenti finali e le applicazioni AI qui per migliorare continuamente l\'accuratezza dell\'AI. Puoi provare a <shareLink>condividere</shareLink> o a <testLink>testare</testLink> l\'app Web tu stesso, quindi tornare a questa pagina.',
      },
    },
  },
  detail: {
    time: 'Ora',
    conversationId: 'ID Conversazione',
    promptTemplate: 'Template Prompt',
    promptTemplateBeforeChat:
      'Template Prompt Prima della Chat · Come Messaggio di Sistema',
    annotationTip: 'Miglioramenti Segnalati da {{user}}',
    timeConsuming: 'Tempo Trascorso',
    second: 's',
    tokenCost: 'Token spesi',
    loading: 'caricamento',
    operation: {
      like: 'mi piace',
      dislike: 'non mi piace',
      addAnnotation: 'Aggiungi Miglioramento',
      editAnnotation: 'Modifica Miglioramento',
      annotationPlaceholder:
        'Inserisci la risposta prevista che desideri che l\'AI dia, che può essere utilizzata per il perfezionamento del modello e il miglioramento continuo della qualità della generazione di testo in futuro.',
    },
    variables: 'Variabili',
    uploadImages: 'Immagini Caricate',
  },
  filter: {
    period: {
      today: 'Oggi',
      last7days: 'Ultimi 7 Giorni',
      last4weeks: 'Ultime 4 settimane',
      last3months: 'Ultimi 3 mesi',
      last12months: 'Ultimi 12 mesi',
      monthToDate: 'Mese corrente',
      quarterToDate: 'Trimestre corrente',
      yearToDate: 'Anno corrente',
      allTime: 'Tutto il tempo',
    },
    annotation: {
      all: 'Tutti',
      annotated: 'Miglioramenti Annotati ({{count}} elementi)',
      not_annotated: 'Non Annotati',
    },
  },
  workflowTitle: 'Registri del Workflow',
  workflowSubtitle: 'Il registro ha registrato il funzionamento di Automate.',
  runDetail: {
    title: 'Registro Conversazione',
    workflowTitle: 'Dettagli Registro',
  },
  promptLog: 'Registro Prompt',
  agentLog: 'Registro Agente',
  viewLog: 'Visualizza Registro',
  agentLogDetail: {
    agentMode: 'Modalità Agente',
    toolUsed: 'Strumento Usato',
    iterations: 'Iterazioni',
    iteration: 'Iterazione',
    finalProcessing: 'Elaborazione Finale',
  },
}

export default translation
