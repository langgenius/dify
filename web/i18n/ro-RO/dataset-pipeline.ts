const translation = {
  creation: {
    createFromScratch: {
      description: 'Creați o conductă personalizată de la zero, cu control deplin asupra procesării și structurii datelor.',
      title: 'Conductă de cunoștințe goală',
    },
    caution: 'Prudență',
    backToKnowledge: 'Înapoi la cunoștințe',
    importDSL: 'Importul dintr-un fișier DSL',
    createKnowledge: 'Creați cunoștințe',
    errorTip: 'Nu s-a reușit crearea unei baze de cunoștințe',
    successTip: 'Crearea cu succes a unei baze de cunoștințe',
  },
  templates: {
    customized: 'Personalizate',
  },
  operations: {
    convert: 'Converti',
    preview: 'Previzualizare',
    details: 'Detalii',
    process: 'Proces',
    editInfo: 'Editați informațiile',
    backToDataSource: 'Înapoi la sursa de date',
    dataSource: 'Sursa datelor',
    choose: 'Alege',
    exportPipeline: 'Export Pipeline',
    useTemplate: 'Utilizați această conductă de cunoștințe',
    saveAndProcess: 'Salvați și procesați',
  },
  deletePipeline: {
    title: 'Sunteți sigur că ștergeți acest șablon de conductă?',
    content: 'Ștergerea șablonului de conductă este ireversibilă.',
  },
  publishPipeline: {
    success: {
      message: 'Fluxul de cunoștințe publicat',
    },
    error: {
      message: 'Nu s-a reușit publicarea canalului de cunoștințe',
    },
  },
  publishTemplate: {
    success: {
      learnMore: 'Află mai multe',
      tip: 'Puteți utiliza acest șablon pe pagina de creare.',
      message: 'Șablon de conductă publicat',
    },
    error: {
      message: 'Nu s-a reușit publicarea șablonului de conductă',
    },
  },
  exportDSL: {
    errorTip: 'Nu s-a reușit exportul DSL al conductei',
    successTip: 'Exportați cu succes DSL',
  },
  details: {
    structure: 'Structură',
    structureTooltip: 'Structura de bucăți determină modul în care documentele sunt împărțite și indexate - oferind modurile General, Părinte-Copil și Întrebări și răspunsuri - și este unică pentru fiecare bază de cunoștințe.',
  },
  testRun: {
    steps: {
      dataSource: 'Sursa datelor',
      documentProcessing: 'Procesarea documentelor',
    },
    dataSource: {
      localFiles: 'Fișiere locale',
    },
    notion: {
      docTitle: 'Documente Notion',
      title: 'Alegeți paginile Notion',
    },
    tooltip: 'În modul de testare, este permis importul unui singur document la un moment dat pentru o depanare și o observare mai ușoară.',
    title: 'Rulare de testare',
  },
  inputFieldPanel: {
    uniqueInputs: {
      title: 'Intrări unice pentru fiecare intrare',
      tooltip: 'Intrările unice sunt accesibile numai sursei de date selectate și nodurilor sale din aval. Utilizatorii nu vor trebui să-l completeze atunci când aleg alte surse de date. Numai câmpurile de intrare la care se face referire variabilele sursei de date vor apărea în primul pas (Sursă de date). Toate celelalte câmpuri vor fi afișate în al doilea pas (Procesați documente).',
    },
    globalInputs: {
      tooltip: 'Intrările globale sunt partajate între toate nodurile. Utilizatorii vor trebui să le completeze atunci când selectează orice sursă de date. De exemplu, câmpuri precum delimitatorul și lungimea maximă a bucății pot fi aplicate uniform în mai multe surse de date. Numai câmpurile de intrare la care se face referire variabilele Sursă de date apar în primul pas (Sursă de date). Toate celelalte câmpuri apar în al doilea pas (Procesare documente).',
      title: 'Intrări globale pentru toate intrările',
    },
    preview: {
      stepOneTitle: 'Sursa datelor',
      stepTwoTitle: 'Procesați documente',
    },
    error: {
      variableDuplicate: 'Numele variabilei există deja. Vă rugăm să alegeți un alt nume.',
    },
    title: 'Câmpuri de introducere a utilizatorului',
    editInputField: 'Editați câmpul de intrare',
    addInputField: 'Adăugați câmp de intrare',
    description: 'Câmpurile de introducere ale utilizatorului sunt utilizate pentru a defini și colecta variabilele necesare în timpul procesului de execuție a conductei. Utilizatorii pot personaliza tipul de câmp și pot configura flexibil valoarea de intrare pentru a satisface nevoile diferitelor surse de date sau etape de procesare a documentelor.',
  },
  addDocuments: {
    steps: {
      processDocuments: 'Procesați documente',
      processingDocuments: 'Procesarea documentelor',
      chooseDatasource: 'Alegeți o sursă de date',
    },
    stepOne: {
      preview: 'Previzualizare',
    },
    stepTwo: {
      chunkSettings: 'Setări bucăți',
      previewChunks: 'Previzualizați bucăți',
    },
    stepThree: {
      learnMore: 'Află mai multe',
    },
    characters: 'Caractere',
    backToDataSource: 'Sursa datelor',
    title: 'Adăugarea documentelor',
  },
  documentSettings: {
    title: 'Setări document',
  },
  onlineDocument: {},
  onlineDrive: {
    breadcrumbs: {
      allFiles: 'Toate fișierele',
      allBuckets: 'Toate gălețile de stocare în cloud',
      searchPlaceholder: 'Căutați fișiere...',
    },
    resetKeywords: 'Resetați cuvintele cheie',
    emptyFolder: 'Acest folder este gol',
    notSupportedFileType: 'Acest tip de fișier nu este acceptat',
    emptySearchResult: 'Nu au fost găsite obiecte',
  },
  credentialSelector: {},
  conversion: {
    confirm: {
      title: 'Confirmare',
      content: 'Această acțiune este permanentă. Nu veți putea reveni la metoda anterioară. Vă rugăm să confirmați pentru a converti.',
    },
    warning: 'Această acțiune nu poate fi anulată.',
    title: 'Conversia în Knowledge Pipeline',
    errorMessage: 'Nu s-a reușit să se convertească setul de date într-o conductă',
    successMessage: 'Conversia cu succes a setului de date într-o conductă',
    descriptionChunk2: '— o abordare mai deschisă și mai flexibilă, cu acces la plugin-uri de pe piața noastră. Aceasta va aplica noua metodă de procesare tuturor documentelor viitoare.',
    descriptionChunk1: 'Acum puteți converti baza de cunoștințe existentă pentru a utiliza Pipeline de cunoștințe pentru procesarea documentelor',
  },
  knowledgePermissions: 'Permisiuni',
  knowledgeDescription: 'Descrierea cunoștințelor',
  pipelineNameAndIcon: 'Numele și pictograma conductei',
  knowledgeNameAndIcon: 'Nume și pictogramă de cunoștințe',
  editPipelineInfo: 'Editați informațiile despre conductă',
  knowledgeNameAndIconPlaceholder: 'Vă rugăm să introduceți numele bazei de cunoștințe',
  knowledgeDescriptionPlaceholder: 'Descrieți ce este în această bază de cunoștințe. O descriere detaliată permite AI să acceseze mai precis conținutul setului de date. Dacă este gol, Dify va folosi strategia implicită de accesare. (Opțional)',
  inputField: 'Câmp de intrare',
}

export default translation
