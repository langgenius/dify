# Document deletion task identity and progress

- Persist a single logical document's title in its durable background task so the console does not
  replace the deleted filename with the batch size.
- Project durable deletion checkpoints into user-visible progress instead of reporting zero until
  the entire item is terminal.
- Remove duplicate whole-space writer cancellation statements from quiescing and raise the bounded,
  configurable deletion-step timeout from 5 seconds to 30 seconds by default.
- Add regression coverage for title projection, checkpoint progress, timeout bounds, and one-pass
  writer cancellation.
