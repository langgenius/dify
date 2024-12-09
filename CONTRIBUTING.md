## Developing

If you are adding a model provider, [this guide](https://github.com/langgenius/dify/blob/main/api/core/model_runtime/README.md) is for you.

If you are adding a tool provider to Agent or Workflow, [this guide](./api/core/tools/README.md) is for you.

To help you quickly navigate where your contribution fits, a brief, annotated outline of Dify's backend & frontend is as follows:

### Backend

Dify’s backend is written in Python using [Flask](https://flask.palletsprojects.com/en/3.0.x/). It uses [SQLAlchemy](https://www.sqlalchemy.org/) for ORM and [Celery](https://docs.celeryq.dev/en/stable/getting-started/introduction.html) for task queueing. Authorization logic goes via Flask-login.

```text
[api/]
├── constants             // Constant settings used throughout code base.
├── controllers           // API route definitions and request handling logic.           
├── core                  // Core application orchestration, model integrations, and tools.
├── docker                // Docker & containerization related configurations.
├── events                // Event handling and processing
├── extensions            // Extensions with 3rd party frameworks/platforms.
├── fields                // field definitions for serialization/marshalling.
├── libs                  // Reusable libraries and helpers.
├── migrations            // Scripts for database migration.
├── models                // Database models & schema definitions.
├── services              // Specifies business logic.
├── storage               // Private key storage.      
├── tasks                 // Handling of async tasks and background jobs.
└── tests
```

### Frontend

The website is bootstrapped on [Next.js](https://nextjs.org/) boilerplate in Typescript and uses [Tailwind CSS](https://tailwindcss.com/) for styling. [React-i18next](https://react.i18next.com/) is used for internationalization.

```text
[web/]
├── app                   // layouts, pages, and components
│   ├── (commonLayout)    // common layout used throughout the app
│   ├── (shareLayout)     // layouts specifically shared across token-specific sessions 
│   ├── activate          // activate page
│   ├── components        // shared by pages and layouts
│   ├── install           // install page
│   ├── signin            // signin page
│   └── styles            // globally shared styles
├── assets                // Static assets
├── bin                   // scripts ran at build step
├── config                // adjustable settings and options 
├── context               // shared contexts used by different portions of the app
├── dictionaries          // Language-specific translate files 
├── docker                // container configurations
├── hooks                 // Reusable hooks
├── i18n                  // Internationalization configuration
├── models                // describes data models & shapes of API responses
├── public                // meta assets like favicon
├── service               // specifies shapes of API actions
├── test                  
├── types                 // descriptions of function params and return values
└── utils                 // Shared utility functions
```
