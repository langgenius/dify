# Contributing

Thanks for your interest in [Dify](https://dify.ai) and for wanting to contribute! Before you begin, read the
[code of conduct](https://github.com/langgenius/.github/blob/main/CODE_OF_CONDUCT.md) and check out the
[existing issues](https://github.com/langgenius/langgenius-gateway/issues).
This document describes how to set up your development environment to build and test [Dify](https://dify.ai).

### Install dependencies

You need to install and configure the following dependencies on your machine to build [Dify](https://dify.ai):

- [Git](http://git-scm.com/)
- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- [Node.js v18.x (LTS)](http://nodejs.org)
- [npm](https://www.npmjs.com/) version 8.x.x or [Yarn](https://yarnpkg.com/)
- [Python](https://www.python.org/) version 3.10.x

## Local development

To set up a working development environment, just fork the project git repository and install the backend and frontend dependencies using the proper package manager and create run the docker-compose stack.

### Fork the repository

you need to fork the [repository](https://github.com/langgenius/dify).

### Clone the repo

Clone your GitHub forked repository:

```
git clone git@github.com:<github_username>/dify.git
```

### Install backend

To learn how to install the backend application, please refer to the [Backend README](api/README.md).

### Install frontend

To learn how to install the frontend application, please refer to the [Frontend README](web/README.md).

### Visit dify in your browser

Finally, you can now visit [http://localhost:3000](http://localhost:3000) to view the [Dify](https://dify.ai) in local environment.


## Create a pull request

After making your changes, open a pull request (PR). Once you submit your pull request, others from the Dify team/community will review it with you.

Did you have an issue, like a merge conflict, or don't know how to open a pull request? Check out [GitHub's pull request tutorial](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests) on how to resolve merge conflicts and other issues. Once your PR has been merged, you will be proudly listed as a contributor in the [contributor chart](https://github.com/langgenius/langgenius-gateway/graphs/contributors).

## Community channels

Stuck somewhere? Have any questions? Join the [Discord Community Server](https://discord.gg/AhzKf7dNgk). We are here to help!

### i18n (Internationalization) Support

We are looking for contributors to help with translations in other languages. If you are interested in helping, please join the [Discord Community Server](https://discord.gg/AhzKf7dNgk) and let us know.  
Also check out the [Frontend i18n README]((web/i18n/README_EN.md)) for more information.