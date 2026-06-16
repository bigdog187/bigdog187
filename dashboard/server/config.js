import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// Load .env from the dashboard root regardless of where node is launched.
dotenv.config({ path: path.join(ROOT, '.env') });

export const config = {
  port: Number(process.env.PORT) || 3000,

  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.CLAUDE_MODEL || 'claude-opus-4-8',
    get enabled() {
      return Boolean(process.env.ANTHROPIC_API_KEY);
    },
  },

  aroflo: {
    enabled: String(process.env.AROFLO_ENABLED).toLowerCase() === 'true',
    baseUrl: process.env.AROFLO_BASE_URL || 'https://api.aroflo.com',
    cuid: process.env.AROFLO_CUID || '',
    orgEncodedKey: process.env.AROFLO_ORG_ENCODED_KEY || '',
    userName: process.env.AROFLO_USER_NAME || '',
    uEncodedKey: process.env.AROFLO_U_ENCODED_KEY || '',
  },
};

export function statusSummary() {
  return {
    claude: config.claude.enabled ? 'live' : 'mock',
    aroflo: config.aroflo.enabled ? 'live' : 'mock',
    model: config.claude.model,
  };
}
