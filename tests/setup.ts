import { loadDotEnv } from '../server/env.js';

// Lets credential-gated tests (tests/sandbox) pick up a developer's local .env.
loadDotEnv();
