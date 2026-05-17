// evals/env.ts
//
// MUST BE IMPORTED FIRST in run.ts. Loads .env.local before any other
// module (e.g. lib/dealwave-client.ts) reads process.env at import time.
//
// JavaScript hoists ALL imports to the top of a module's evaluation,
// so calling dotenv.config() in the BODY of run.ts runs too late —
// dealwave-client.ts has already thrown at import-time because
// DEALWAVE_API_BASE was undefined.
//
// By isolating env loading into this side-effect module and importing
// it first, we guarantee config() fires before any other import is
// evaluated.

import { config } from "dotenv";

config({ path: ".env.local" });
