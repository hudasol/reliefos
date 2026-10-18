import { z } from 'zod';

// All configuration comes from the environment. Optional integrations degrade to clearly labelled
// fallbacks; nothing here ever invents a credential.

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  PUBLIC_BASE_URL: optionalString,
  RENDER_EXTERNAL_URL: optionalString,
  DATABASE_URL: optionalString,
  PGLITE_DATA_DIR: optionalString,
  SESSION_SECRET: optionalString,
  PAYPAL_CLIENT_ID: optionalString,
  PAYPAL_CLIENT_SECRET: optionalString,
  PAYPAL_ENVIRONMENT: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  CHANNEL3_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),
  AG_STUDIO_LICENSE_KEY: optionalString,
  AG_GRID_LICENSE_KEY: optionalString,
  RENDER_API_KEY: optionalString,
  RENDER_WORKFLOW_SLUG: optionalString,
  RENDER_GIT_COMMIT: optionalString,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  if (parsed.PAYPAL_ENVIRONMENT === 'live') {
    // This project is a hackathon build. Refuse to move real money.
    throw new Error('PAYPAL_ENVIRONMENT=live is not supported by RELIEFOS. Use sandbox.');
  }
  if (parsed.NODE_ENV === 'production' && !parsed.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required in production.');
  }
  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    publicBaseUrl: parsed.PUBLIC_BASE_URL ?? parsed.RENDER_EXTERNAL_URL ?? null,
    databaseUrl: parsed.DATABASE_URL ?? null,
    pgliteDataDir: parsed.PGLITE_DATA_DIR ?? null,
    sessionSecret: parsed.SESSION_SECRET ?? 'reliefos-dev-only-secret-do-not-use-in-production',
    paypal:
      parsed.PAYPAL_CLIENT_ID && parsed.PAYPAL_CLIENT_SECRET
        ? {
            clientId: parsed.PAYPAL_CLIENT_ID,
            clientSecret: parsed.PAYPAL_CLIENT_SECRET,
            environment: parsed.PAYPAL_ENVIRONMENT,
            timeoutMs: parsed.PAYPAL_TIMEOUT_MS,
          }
        : null,
    channel3ApiKey: parsed.CHANNEL3_API_KEY ?? null,
    anthropic: parsed.ANTHROPIC_API_KEY
      ? { apiKey: parsed.ANTHROPIC_API_KEY, model: parsed.ANTHROPIC_MODEL }
      : null,
    agStudioLicenseKey: parsed.AG_STUDIO_LICENSE_KEY ?? null,
    agGridLicenseKey: parsed.AG_GRID_LICENSE_KEY ?? parsed.AG_STUDIO_LICENSE_KEY ?? null,
    renderWorkflows:
      parsed.RENDER_API_KEY && parsed.RENDER_WORKFLOW_SLUG
        ? { apiKey: parsed.RENDER_API_KEY, slug: parsed.RENDER_WORKFLOW_SLUG }
        : null,
    commit: parsed.RENDER_GIT_COMMIT ?? null,
    logLevel: parsed.LOG_LEVEL,
  };
}
