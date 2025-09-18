const translation = {
  creation: {
    createFromScratch: {
      title: 'Prazen cevovod znanja',
      description: 'Ustvarite cevovod po meri iz nič s popolnim nadzorom nad obdelavo in strukturo podatkov.',
    },
    caution: 'Previdnost',
    backToKnowledge: 'Nazaj na Znanje',
    importDSL: 'Uvoz iz datoteke DSL',
    createKnowledge: 'Ustvarite znanje',
    successTip: 'Uspešno ustvarjena baza znanja',
    errorTip: 'Ustvarjanje zbirke znanja ni uspelo',
  },
  templates: {
    customized: 'Prilagojene',
  },
  operations: {
    convert: 'Pretvoriti',
    preview: 'Predogled',
    details: 'Podrobnosti',
    choose: 'Izbrati',
    editInfo: 'Urejanje podatkov',
    process: 'Proces',
    backToDataSource: 'Nazaj na vir podatkov',
    exportPipeline: 'Izvozni cevovod',
    dataSource: 'Vir podatkov',
    useTemplate: 'Uporabite ta cevovod znanja',
    saveAndProcess: 'Shranjevanje in obdelava',
  },
  deletePipeline: {
    content: 'Brisanje predloge cevovoda je nepovratno.',
    title: 'Ali ste prepričani, da boste izbrisali to predlogo cevovoda?',
  },
  publishPipeline: {
    success: {
      message: 'Objavljen Knowledge Pipeline',
    },
    error: {
      message: 'Objava cevovoda znanja ni uspela',
    },
  },
  publishTemplate: {
    success: {
      learnMore: 'Izvedi več',
      message: 'Objavljena predloga cevovoda',
      tip: 'To predlogo lahko uporabite na strani za ustvarjanje.',
    },
    error: {
      message: 'Ni bilo mogoče objaviti predloge cevovoda',
    },
  },
  exportDSL: {
    errorTip: 'Izvoz cevovoda DSL ni uspel',
    successTip: 'Uspešno izvozite DSL',
  },
  details: {
    structure: 'Struktura',
    structureTooltip: 'Struktura kosov določa, kako so dokumenti razdeljeni in indeksirani – ponuja načine Splošno, Nadrejeno-podrejeno in Vprašanja in odgovori – in je edinstvena za vsako zbirko znanja.',
  },
  testRun: {
    steps: {
      documentProcessing: 'Obdelava dokumentov',
      dataSource: 'Vir podatkov',
    },
    dataSource: {
      localFiles: 'Lokalne datoteke',
    },
    notion: {
      docTitle: 'Dokumenti o pojmih',
      title: 'Izberite Notion Pages',
    },
    title: 'Preskusni zagon',
    tooltip: 'V načinu preskusnega zagona je dovoljeno uvoziti samo en dokument naenkrat za lažje odpravljanje napak in opazovanje.',
  },
  inputFieldPanel: {
    uniqueInputs: {
      title: 'Edinstveni vhodi za vsak vhod',
      tooltip: 'Enolični vhodi so dostopni samo izbranemu viru podatkov in njegovim nadaljnjim vozliščem. Uporabnikom ga ne bo treba izpolniti pri izbiri drugih virov podatkov. V prvem koraku (Vir podatkov) bodo prikazana samo vhodna polja, na katera se sklicujejo spremenljivke vira podatkov. Vsa druga polja bodo prikazana v drugem koraku (Obdelava dokumentov).',
    },
    globalInputs: {
      title: 'Globalni vložki za vse vhode',
      tooltip: 'Globalni vhodi so v skupni rabi med vsemi vozlišči. Uporabniki jih bodo morali izpolniti pri izbiri katerega koli vira podatkov. Polja, kot sta ločilo in največja dolžina kosa, lahko na primer enakomerno uporabite v več virih podatkov. V prvem koraku (Vir podatkov) so prikazana le vhodna polja, na katera se sklicujejo spremenljivke vira podatkov. Vsa druga polja so prikazana v drugem koraku (Obdelava dokumentov).',
    },
    preview: {
      stepOneTitle: 'Vir podatkov',
      stepTwoTitle: 'Obdelava dokumentov',
    },
    error: {
      variableDuplicate: 'Ime spremenljivke že obstaja. Prosimo, izberite drugo ime.',
    },
    editInputField: 'Uredi vnosno polje',
    title: 'Uporabniška vnosna polja',
    addInputField: 'Dodajanje vhodnega polja',
    description: 'Uporabniška vnosna polja se uporabljajo za določanje in zbiranje spremenljivk, ki so potrebne med postopkom izvajanja cevovoda. Uporabniki lahko prilagodijo vrsto polja in prilagodljivo konfigurirajo vhodno vrednost, da ustreza potrebam različnih virov podatkov ali korakov obdelave dokumentov.',
  },
  addDocuments: {
    steps: {
      processingDocuments: 'Obdelava dokumentov',
      processDocuments: 'Obdelava dokumentov',
      chooseDatasource: 'Izbira vira podatkov',
    },
    stepOne: {
      preview: 'Predogled',
    },
    stepTwo: {
      chunkSettings: 'Nastavitve kosov',
      previewChunks: 'Predogled kosov',
    },
    stepThree: {
      learnMore: 'Izvedi več',
    },
    characters: 'Znakov',
    backToDataSource: 'Vir podatkov',
    title: 'Dodajanje dokumentov',
  },
  documentSettings: {
    title: 'Nastavitve dokumenta',
  },
  onlineDocument: {},
  onlineDrive: {
    breadcrumbs: {
      allFiles: 'Vse datoteke',
      searchPlaceholder: 'Iskanje datotek ...',
      allBuckets: 'Vsa vedra za shranjevanje v oblaku',
    },
    resetKeywords: 'Ponastavitev ključnih besed',
    emptyFolder: 'Ta mapa je prazna',
    emptySearchResult: 'Predmeti niso bili najdeni',
    notSupportedFileType: 'Ta vrsta datoteke ni podprta',
  },
  credentialSelector: {},
  conversion: {
    confirm: {
      title: 'Potrditev',
      content: 'To dejanje je trajno. Ne boste se mogli vrniti na prejšnjo metodo. Prosimo, potrdite za pretvorbo.',
    },
    title: 'Pretvori v cevovod znanja',
    errorMessage: 'Pretvorba nabora podatkov v cevovod ni uspela',
    warning: 'Tega dejanja ni mogoče razveljaviti.',
    successMessage: 'Uspešno pretvorba nabora podatkov v cevovod',
    descriptionChunk2: '- bolj odprt in prilagodljiv pristop z dostopom do vtičnikov z našega trga. To bo uporabilo novo metodo obdelave za vse prihodnje dokumente.',
    descriptionChunk1: 'Zdaj lahko obstoječo zbirko znanja pretvorite tako, da za obdelavo dokumentov uporabljate cevovod znanja',
  },
  knowledgePermissions: 'Dovoljenja',
  pipelineNameAndIcon: 'Ime in ikona cevovoda',
  knowledgeNameAndIconPlaceholder: 'Prosimo, vnesite ime baze znanja',
  inputField: 'Vnosno polje',
  knowledgeDescription: 'Opis znanja',
  knowledgeNameAndIcon: 'Ime in ikona znanja',
  editPipelineInfo: 'Urejanje informacij o cevovodu',
  knowledgeDescriptionPlaceholder: 'Opišite, kaj je v tej bazi znanja. Podroben opis omogoča umetni inteligenci natančnejši dostop do vsebine nabora podatkov. Če je prazen, bo Dify uporabil privzeto strategijo zadetkov. (Neobvezno)',
}

export default translation
