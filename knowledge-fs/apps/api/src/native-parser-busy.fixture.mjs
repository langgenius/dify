// Test-only bounded by the parent process deadline; deliberately cannot service its event loop.
process.once("message", () => {
  process.send({ started: true });
  while (true) Math.sqrt(2);
});
