import { existsSync } from 'node:fs';

/**
 * Load a local `.env` file for development (Node's built-in parser). Variables already present in
 * the environment win, so hosted deployments are unaffected; production never needs the file.
 */
export function loadDotEnv(file = '.env'): void {
  if (!existsSync(file)) return;
  const before = { ...process.env };
  process.loadEnvFile(file);
  for (const [k, v] of Object.entries(before)) process.env[k] = v;
}
