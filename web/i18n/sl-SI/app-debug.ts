const translation = {
  pageTitle: {
    line1: 'PROMPT',
    line2: 'Inženiring',
  },
  orchestrate: 'Orkestriraj',
  promptMode: {
    simple: 'Preklopi na strokovni način, da urejaš celoten PROMPT',
    advanced: 'Strokovni način',
    switchBack: 'Preklopi nazaj',
    advancedWarning: {
      title: 'Preklopil si na strokovni način. Ko spremeniš PROMPT, ne moreš več preklopiti nazaj v osnovni način.',
      description: 'V strokovnem načinu lahko urejaš celoten PROMPT.',
      learnMore: 'Preberi več',
      ok: 'V redu',
    },
    operation: {
      addMessage: 'Dodaj sporočilo',
    },
    contextMissing: 'Manjka komponenta konteksta, zato učinkovitost PROMPT-a morda ne bo najboljša.',
  },
  operation: {
    applyConfig: 'Objavi',
    resetConfig: 'Ponastavi',
    debugConfig: 'Odpravljanje napak',
    addFeature: 'Dodaj funkcionalnost',
    automatic: 'Generiraj',
    stopResponding: 'Prenehaj odgovarjati',
    agree: 'všeč',
    disagree: 'ni všeč',
    cancelAgree: 'Prekliči všeček',
    cancelDisagree: 'Prekliči nevšečnost',
    userAction: 'Uporabnik ',
  },
  notSetAPIKey: {
    title: 'Ključ ponudnika LLM ni nastavljen',
    trailFinished: 'Preizkus končan',
    description: 'Ključ ponudnika LLM ni nastavljen. Pred odpravljanjem napak je treba nastaviti ključ.',
    settingBtn: 'Pojdi v nastavitve',
  },
  trailUseGPT4Info: {
    title: 'GPT-4 trenutno ni podprt',
    description: 'Za uporabo GPT-4 je treba nastaviti API ključ.',
  },
  feature: {
    groupChat: {
      title: 'Izboljšanje klepeta',
      description: 'Dodajanje prednastavitev klepeta lahko izboljša uporabniško izkušnjo.',
    },
    groupExperience: {
      title: 'Izboljšanje izkušnje',
    },
    conversationOpener: {
      title: 'Začetek pogovora',
      description: 'V klepetu AI običajno začne pogovor z uporabnikom z dobrodošlico.',
    },
    suggestedQuestionsAfterAnswer: {
      title: 'Nadaljnja vprašanja',
      description: 'Nastavitev predlogov za naslednja vprašanja lahko uporabnikom izboljša klepet.',
      resDes: '3 predlogi za naslednje vprašanje uporabnika.',
      tryToAsk: 'Poskusi vprašati',
    },
    moreLikeThis: {
      title: 'Več takšnih',
      description: 'Ustvari več besedil naenkrat, nato pa jih urejaj in nadaljuj z ustvarjanjem.',
      generateNumTip: 'Število generacij vsakič',
      tip: 'Uporaba te funkcije povzroča dodatno porabo žetonov.',
    },
    speechToText: {
      title: 'Govor v besedilo',
      description: 'Ko je omogočeno, lahko uporabljaš glasovni vnos.',
      resDes: 'Glasovni vnos je omogočen.',
    },
    textToSpeech: {
      title: 'Besedilo v govor',
      description: 'Ko je omogočeno, lahko besedilo pretvoriš v govor.',
      resDes: 'Pretvorba besedila v zvok je omogočena.',
    },
    citation: {
      title: 'Citati in pripisovanja',
      description: 'Ko je omogočeno, prikaži izvorni dokument in pripisani del generirane vsebine.',
      resDes: 'Citati in pripisovanja so omogočeni.',
    },
    annotation: {
      title: 'Odgovor z opombami',
      description: 'Ročno lahko dodate visokokakovostne odgovore v predpomnilnik za prednostno ujemanje s podobnimi vprašanji uporabnikov.',
      resDes: 'Odgovor z opombami je omogočen.',
      scoreThreshold: {
        title: 'Prag ujemanja',
        description: 'Uporabljeno za nastavitev praga podobnosti za odgovor z opombami.',
        easyMatch: 'Lahko ujemanje',
        accurateMatch: 'Natančno ujemanje',
      },
      matchVariable: {
        title: 'Spremenljivka za ujemanje',
        choosePlaceholder: 'Izberi spremenljivko za ujemanje',
      },
      cacheManagement: 'Upravljanje opomb',
      cached: 'Z opombo',
      remove: 'Odstrani',
      removeConfirm: 'Izbrisati to opombo?',
      add: 'Dodaj opombo',
      edit: 'Uredi opombo',
    },
    dataSet: {
      title: 'Kontekst',
      noData: 'Uvozi znanje kot kontekst',
      words: 'Besede',
      textBlocks: 'Bloki besedila',
      selectTitle: 'Izberi referenčno znanje',
      selected: 'Izbrano znanje',
      noDataSet: 'Znanje ni bilo najdeno',
      toCreate: 'Pojdi na ustvarjanje',
      notSupportSelectMulti: 'Trenutno je podprto le eno znanje',
      queryVariable: {
        title: 'Spremenljivka poizvedbe',
        tip: 'Ta spremenljivka bo uporabljena kot vnos poizvedbe za pridobitev kontekstnih informacij.',
        choosePlaceholder: 'Izberi spremenljivko poizvedbe',
        noVar: 'Ni spremenljivk',
        noVarTip: 'ustvari spremenljivko v razdelku Spremenljivke',
        unableToQueryDataSet: 'Neuspešna poizvedba po znanju',
        unableToQueryDataSetTip: 'Neuspešna poizvedba po znanju, izberi spremenljivko poizvedbe v razdelku kontekst.',
        ok: 'V redu',
        contextVarNotEmpty: 'Spremenljivka poizvedbe ne sme biti prazna',
        deleteContextVarTitle: 'Izbrisati spremenljivko “{{varName}}”?',
        deleteContextVarTip: 'Ta spremenljivka je nastavljena kot spremenljivka za poizvedbo po kontekstu. Če jo odstraniš, bo to vplivalo na uporabo znanja. Če jo želiš izbrisati, ponovno izberi v razdelku kontekst.',
      },
    },
    tools: {
      title: 'Orodja',
      tips: 'Orodja nudijo standardiziran način klicanja API-jev, pri čemer se uporabniški vnos ali spremenljivke uporabijo kot parametri za poizvedovanje zunanjih podatkov.',
      toolsInUse: '{{count}} orodij v uporabi',
      modal: {
        title: 'Orodje',
        toolType: {
          title: 'Tip orodja',
          placeholder: 'Izberi tip orodja',
        },
        name: {
          title: 'Ime',
          placeholder: 'Vnesi ime',
        },
        variableName: {
          title: 'Ime spremenljivke',
          placeholder: 'Vnesi ime spremenljivke',
        },
      },
    },
    conversationHistory: {
      title: 'Zgodovina pogovorov',
      description: 'Nastavi predpone imen za vloge v pogovoru',
      tip: 'Zgodovina pogovorov ni omogočena. Dodaj <histories> v zgornji PROMPT.',
      learnMore: 'Preberi več',
      editModal: {
        title: 'Uredi imena vlog v pogovoru',
        userPrefix: 'Predpona uporabnika',
        assistantPrefix: 'Predpona pomočnika',
      },
    },
    toolbox: {
      title: 'ORODJA',
    },
    moderation: {
      title: 'Moderiranje vsebine',
      description: 'Zagotovi varno izhodno vsebino s pomočjo API-ja za moderiranje ali vzdrževanja seznama občutljivih besed.',
      allEnabled: 'VSEBINA VNOSA/IZHODA omogočena',
      inputEnabled: 'VSEBINA VNOSA omogočena',
      outputEnabled: 'VSEBINA IZHODA omogočena',
      modal: {
        title: 'Nastavitve moderiranja vsebine',
        provider: {
          title: 'Ponudnik',
          openai: 'OpenAI Moderiranje',
          openaiTip: {
            prefix: 'OpenAI Moderiranje zahteva nastavljen API ključ pri ',
            suffix: '.',
          },
          keywords: 'Ključne besede',
        },
        keywords: {
          tip: 'Vsaka beseda na lastni vrstici, ločena z vrsticami. Največ 100 znakov na vrstico.',
          placeholder: 'Vsaka beseda na lastni vrstici, ločena z vrsticami',
          line: 'Vrstica',
        },
        content: {
          input: 'Moderiraj VSEBINO VNOSA',
          output: 'Moderiraj VSEBINO IZHODA',
        },
      },
    },
    debug: {
      title: 'Odpravljanje napak',
      description: 'Debugiranje omogoča pregled podrobnih informacij, kot so podatki API-jev, vklop dnevnikov, opozorila in še več.',
    },
    agent: {
      title: 'Pomočnik',
      description: 'Osnovne informacije in odgovorne naloge pomočnika.',
      prompts: 'Temeljni PROMPT',
      message: {
        title: 'Vrstice sporočila',
        user: 'Uporabnik',
        assistant: 'Pomočnik',
      },
    },
    history: {
      title: 'Zgodovina',
      notFound: 'Zgodovina ni bila najdena',
      notOpen: 'Zgodovina ni odprta',
    },
    prompt: {
      title: 'Vsebina PROMPT-a',
    },
    message: {
      title: 'Sporočilo',
      description: 'Način nastavitve formatiranega pogovora.',
      tryChat: 'Preizkusi klepet',
    },
    theme: {
      title: 'Tema',
      themes: {
        default: 'Osnovna tema',
        light: 'Svetla tema',
        dark: 'Temna tema',
        custom: 'Prilagodi temo',
      },
      modal: {
        title: 'Nastavitve teme',
        primaryColor: {
          title: 'Primarna barva',
          placeholder: 'Izberi primarno barvo',
        },
        textColor: {
          title: 'Barva besedila',
          placeholder: 'Izberi barvo besedila',
        },
        ok: 'V redu',
      },
    },
  },
}

module.exports = translation
