So you're looking to contribute to Dify - that's awesome, we can't wait to see what you do. As a startup with limited headcount and funding, we have grand ambitions to design the most intuitive workflow for building and managing LLM applications. Any help from the community counts, truly.

We need to be nimble and ship fast given where we are, but we also want to make sure that contributors like you get as smooth an experience at contributing as possible. We've assembled this contribution guide for that purpose, aiming at getting you familiarized with the codebase & how we work with contributors, so you could quickly jump to the fun part. 

This guide, like Dify itself, is a constant work in progress. We highly appreciate your understanding if at times it lags behind the actual project, and welcome any feedback for us to improve.

In terms of licensing, please take a minute to read our short [License and Contributor Agreement](./LICENSE). The community also adheres to the [code of conduct](https://github.com/langgenius/.github/blob/main/CODE_OF_CONDUCT.md).

## Before you jump in

[Find](https://github.com/langgenius/dify/issues?q=is:issue+is:open) an existing issue, or [open](https://github.com/langgenius/dify/issues/new/choose) a new one. We categorize issues into 2 types:

### Feature requests:

* If you're opening a new feature request, we'd like you to explain what the proposed feature achieves, and include as much context as possible. [@perzeusss](https://github.com/perzeuss) has made a solid [Feature Request Copilot](https://udify.app/chat/MK2kVSnw1gakVwMX) that helps you draft out your needs. Feel free to give it a try.

* If you want to pick one up from the existing issues, simply drop a comment below it saying so.

  

  A team member working in the related direction will be looped in. If all looks good, they will give the go-ahead for you to start coding. We ask that you hold off working on the feature until then, so none of your work goes to waste should we propose changes.

  Depending on whichever area the proposed feature falls under, you might talk to different team members. Here's rundown of the areas each our team members are working on at the moment:

  | Member                                                       | Scope                                                |
  | ------------------------------------------------------------ | ---------------------------------------------------- |
  | [@yeuoly](https://github.com/Yeuoly)                         | Architecting Agents                                  |
  | [@jyong](https://github.com/JohnJyong)                       | RAG pipeline design                                  |
  | [@GarfieldDai](https://github.com/GarfieldDai)               | Building workflow orchestrations                     |
  | [@iamjoel](https://github.com/iamjoel) & [@zxhlyh](https://github.com/zxhlyh) | Making our frontend a breeze to use                  |
  | [@guchenhe](https://github.com/guchenhe) & [@crazywoola](https://github.com/crazywoola) | Developer experience, points of contact for anything |
  | [@takatost](https://github.com/takatost)                     | Overall product direction and architecture           |

  How we prioritize:

  | Feature Type                                                 | Priority        |
  | ------------------------------------------------------------ | --------------- |
  | High-Priority Features as being labeled by a team member     | High Priority   |
  | Popular feature requests from our [community feedback board](https://github.com/langgenius/dify/discussions/categories/feedbacks) | Medium Priority |
  | Non-core features and minor enhancements                     | Low Priority    |
  | Valuable but not immediate                                   | Future-Feature  |

### Anything else (e.g. bug report, performance optimization, typo correction):

* Start coding right away.

  How we prioritize:

  | Issue Type                                                   | Priority        |
  | ------------------------------------------------------------ | --------------- |
  | Bugs in core functions (cannot login, applications not working, security loopholes) | Critical        |
  | Non-critical bugs, performance boosts                        | Medium Priority |
  | Minor fixes (typos, confusing but working UI)                | Low Priority    |


## Installing

Here are the steps to set up Dify for development:

### 1. Fork this repository

### 2. Clone the repo

 Clone the forked repository from your terminal:

```
git clone git@github.com:<github_username>/dify.git
```

### 3. Verify dependencies

Dify requires the following dependencies to build, make sure they're installed on your system:

- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- [Node.js v18.x (LTS)](http://nodejs.org)
- [npm](https://www.npmjs.com/) version 8.x.x or [Yarn](https://yarnpkg.com/)
- [Python](https://www.python.org/) version 3.10.x

### 4. Installations

Dify is composed of a backend and a frontend. Navigate to the backend directory by `cd api/`, then follow the [Backend README](api/README.md) to install it. In a separate terminal, navigate to the frontend directory by `cd web/`, then follow the [Frontend README](web/README.md) to install.

Check the [installation FAQ](https://docs.dify.ai/learn-more/faq/self-host-faq) for a list of common issues and steps to troubleshoot.

### 5. Visit dify in your browser

To validate your set up, head over to [http://localhost:3000](http://localhost:3000) (the default, or your self-configured URL and port) in your browser. You should now see Dify up and running. 

## Developing

If you are adding a model provider, [this guide](https://github.com/langgenius/dify/blob/main/api/core/model_runtime/README.md) is for you.

If you are adding a tool provider to Agent or Workflow, [this guide](./api/core/tools/README.md) is for you.

To help you quickly navigate where your contribution fits, a brief, annotated outline of Dify's backend & frontend is as follows:

### Backend

Dify’s backend is written in Python using [Flask](https://flask.palletsprojects.com/en/3.0.x/). It uses [SQLAlchemy](https://www.sqlalchemy.org/) for ORM and [Celery](https://docs.celeryq.dev/en/stable/getting-started/introduction.html) for task queueing. Authorization logic goes via Flask-login. 

```
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

```
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

## Submitting your PR

At last, time to open a pull request (PR) to our repo. For major features, we first merge them into the `deploy/dev` branch for testing, before they go into the `main` branch. If you run into issues like merge conflicts or don't know how to open a pull request, check out [GitHub's pull request tutorial](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests). 

And that's it! Once your PR is merged, you will be featured as a contributor in our [README](https://github.com/langgenius/dify/blob/main/README.md).

## Getting Help

If you ever get stuck or got a burning question while contributing, simply shoot your queries our way via the related GitHub issue, or hop onto our [Discord](https://discord.gg/8Tpq4AcN9c) for a quick chat. 
