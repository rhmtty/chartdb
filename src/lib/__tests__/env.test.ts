import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `envsubst` in the nginx template emits every key unconditionally, so a
 * variable that was never passed to the container arrives in `window.env` as an
 * empty string rather than `undefined`. These tests pin that an empty value is
 * treated as absent, so the defaults still apply in a deployed container.
 */
const VITE_SYNC_KEYS = [
    'VITE_SYNC_ENABLED',
    'VITE_SYNC_AUTO_SAVE',
    'VITE_BITBUCKET_API_BASE',
    'VITE_BITBUCKET_WORKSPACE',
    'VITE_BITBUCKET_REPO',
    'VITE_BITBUCKET_GIT_URL',
    'VITE_BITBUCKET_BRANCH',
    'VITE_BITBUCKET_FILE_PATH',
    'VITE_BITBUCKET_USERNAME',
    'VITE_BITBUCKET_APP_PASSWORD',
    'VITE_BITBUCKET_API_TOKEN',
    'VITE_SYNC_GIT_CORS_PROXY',
    'VITE_SYNC_POLL_INTERVAL_MS',
] as const;

const loadEnv = async (runtimeEnv: Record<string, string>) => {
    window.env = runtimeEnv;
    vi.resetModules();
    return import('../env');
};

describe('env', () => {
    let originalEnv: Record<string, string> | undefined;

    beforeEach(() => {
        originalEnv = window.env;
        // A developer's local .env supplies these as build-time values, which
        // would otherwise stand in for the runtime values under test.
        for (const key of VITE_SYNC_KEYS) {
            vi.stubEnv(key, '');
        }
    });

    afterEach(() => {
        window.env = originalEnv;
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('falls back to the git proxy default when the value is an empty string', async () => {
        // The bug this guards: an empty corsProxy makes isomorphic-git bypass
        // the proxy and talk to bitbucket.org directly, which the browser
        // blocks because Bitbucket's git endpoints send no CORS headers.
        const env = await loadEnv({ SYNC_GIT_CORS_PROXY: '' });
        expect(env.SYNC_GIT_CORS_PROXY).toBe('/git');
    });

    it('falls back to the Bitbucket API default when the value is an empty string', async () => {
        // An empty apiBase turns the REST reads into same-origin relative URLs,
        // so nginx answers with index.html and the JSON parse fails.
        const env = await loadEnv({ BITBUCKET_API_BASE: '' });
        expect(env.BITBUCKET_API_BASE).toBe('https://api.bitbucket.org/2.0');
    });

    it('treats a whitespace-only value as absent', async () => {
        const env = await loadEnv({ BITBUCKET_BRANCH: '   ' });
        expect(env.BITBUCKET_BRANCH).toBe('main');
    });

    it('keeps an explicitly configured value', async () => {
        const env = await loadEnv({
            SYNC_GIT_CORS_PROXY: 'https://proxy.example.com',
            BITBUCKET_BRANCH: 'develop',
        });
        expect(env.SYNC_GIT_CORS_PROXY).toBe('https://proxy.example.com');
        expect(env.BITBUCKET_BRANCH).toBe('develop');
    });

    it('trims surrounding whitespace from a configured value', async () => {
        const env = await loadEnv({ BITBUCKET_REPO: '  erds  ' });
        expect(env.BITBUCKET_REPO).toBe('erds');
    });

    it('still defaults the file path and poll interval', async () => {
        const env = await loadEnv({
            BITBUCKET_FILE_PATH: '',
            SYNC_POLL_INTERVAL_MS: '',
        });
        expect(env.BITBUCKET_FILE_PATH).toBe('erd.json');
        expect(env.SYNC_POLL_INTERVAL_MS).toBe(15000);
    });

    it('reads booleans only from an exact "true"', async () => {
        const enabled = await loadEnv({ SYNC_ENABLED: 'true' });
        expect(enabled.SYNC_ENABLED).toBe(true);

        const blank = await loadEnv({ SYNC_ENABLED: '' });
        expect(blank.SYNC_ENABLED).toBe(false);
    });
});
