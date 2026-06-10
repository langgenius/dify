# CONTRIBUTING

So you're looking to contribute to Dify - that's awesome, we can't wait to see what you do. As a startup with limited headcount and funding, we have grand ambitions to design the most intuitive workflow for building and managing LLM applications. Any help from the community counts, truly.

We need to be nimble and ship fast given where we are, but we also want to make sure that contributors like you get as smooth an experience at contributing as possible. We've assembled this contribution guide for that purpose, aiming at getting you familiarized with the codebase & how we work with contributors, so you could quickly jump to the fun part.

This guide, like Dify itself, is a constant work in progress. We highly appreciate your understanding if at times it lags behind the actual project, and welcome any feedback for us to improve.

In terms of licensing, please take a minute to read our short [License and Contributor Agreement](./LICENSE). The community also adheres to the [code of conduct](https://github.com/langgenius/.github/blob/main/CODE_OF_CONDUCT.md).

## Before you jump in

Looking for something to tackle? Browse our [good first issues](https://github.com/langgenius/dify/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22) and pick one to get started!

Got a cool new model runtime or tool to add? Open a PR in our [plugin repo](https://github.com/langgenius/dify-plugins) and show us what you've built.

Need to update an existing model runtime, tool, or squash some bugs? Head over to our [official plugin repo](https://github.com/langgenius/dify-official-plugins) and make your magic happen!

Join the fun, contribute, and let's build something awesome together! 💡✨

Don't forget to link an existing issue or open a new issue in the PR's description.

### Bug reports

> [!IMPORTANT]
> Please make sure to include the following information when submitting a bug report:

- A clear and descriptive title
- A detailed description of the bug, including any error messages
- Steps to reproduce the bug
- Expected behavior
- **Logs**, if available, for backend issues, this is really important, you can find them in docker-compose logs
- Screenshots or videos, if applicable

How we prioritize:

| Issue Type | Priority |
| ------------------------------------------------------------ | --------------- |
| Bugs in core functions (cloud service, cannot login, applications not working, security loopholes) | Critical |
| Non-critical bugs, performance boosts | Medium Priority |
| Minor fixes (typos, confusing but working UI) | Low Priority |

### Feature requests

> [!NOTE]
> Please make sure to include the following information when submitting a feature request:

- A clear and descriptive title
- A detailed description of the feature
- A use case for the feature
- Any other context or screenshots about the feature request

How we prioritize:

| Feature Type | Priority |
| ------------------------------------------------------------ | --------------- |
| High-Priority Features as being labeled by a team member | High Priority |
| Popular feature requests from our [community feedback board](https://github.com/langgenius/dify/discussions/categories/feedbacks) | Medium Priority |
| Non-core features and minor enhancements | Low Priority |
| Valuable but not immediate | Future-Feature |

## Submitting your PR

### Pull Request Process

1. Fork the repository
1. Before you draft a PR, please create an issue to discuss the changes you want to make
1. Create a new branch for your changes
1. Please add tests for your changes accordingly
1. Ensure your code passes the existing tests
1. Please link the issue in the PR description, `fixes #<issue_number>`
1. Get merged!

### Setup the project

#### Frontend

For setting up the frontend service, please refer to our comprehensive [guide](https://github.com/langgenius/dify/blob/main/web/README.md) in the `web/README.md` file. This document provides detailed instructions to help you set up the frontend environment properly.

**Testing**: All React components must have comprehensive test coverage. See [web/docs/test.md](https://github.com/langgenius/dify/blob/main/web/docs/test.md) for the canonical frontend testing guidelines and follow every requirement described there.

#### Backend

For setting up the backend service, kindly refer to our detailed [instructions](https://github.com/langgenius/dify/blob/main/api/README.md) in the `api/README.md` file. This document contains step-by-step guidance to help you get the backend up and running smoothly.

#### Other things to note

We recommend reviewing this document carefully before proceeding with the setup, as it contains essential information about:

- Prerequisites and dependencies
- Installation steps
- Configuration details
- Common troubleshooting tips

Feel free to reach out if you encounter any issues during the setup process.

## Getting Help

If you ever get stuck or get a burning question while contributing, simply shoot your queries our way via the related GitHub issue, or hop onto our [Discord](https://discord.gg/8Tpq4AcN9c) for a quick chat.
