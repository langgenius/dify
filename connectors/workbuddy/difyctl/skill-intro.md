# Dify in WorkBuddy

This connector installs difyctl but does not log it in. Before the first Dify task in a conversation, check the login:

1. Run `difyctl login --resume --json`. If it prints an `email`, you are logged in. Go on with the task.
2. If it fails with `not_logged_in`, ask the human for their Dify console address: the URL they open in a browser to use Dify. For Dify Cloud it is `https://cloud.dify.ai`. For self-hosted Dify it is their own address, such as `https://dify.example.com`. Never guess one.
3. Log in to that address as [`references/setup.md`](references/setup.md) describes: start with `--no-wait`, give the human the link and the code, end your turn, and run `--resume` once when they say they approved.

Talk to the human in their language.
