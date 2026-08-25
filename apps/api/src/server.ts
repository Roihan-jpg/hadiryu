import { createApp } from './app.js';
import {
  loadSupabaseAuthConfig,
  SupabaseAuthService,
} from './supabase-auth.js';

const port = Number.parseInt(process.env['API_PORT'] ?? '3000', 10);
const authService = new SupabaseAuthService(
  loadSupabaseAuthConfig(process.env),
);
const secureCookies =
  process.env['SESSION_COOKIE_SECURE'] === undefined
    ? process.env['NODE_ENV'] === 'production'
    : process.env['SESSION_COOKIE_SECURE'] === 'true';

createApp({ authService, secureCookies }).listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
