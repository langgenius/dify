import { serve } from "@hono/node-server";

import app from "./index";
import { resolveApiPort } from "./server-options";

const port = resolveApiPort();

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Knowledge API listening on http://0.0.0.0:${info.port}`);
  },
);
