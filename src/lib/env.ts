export const OPENAI_API_KEY: string = import.meta.env.VITE_OPENAI_API_KEY;
export const OPENAI_API_ENDPOINT: string = import.meta.env
    .VITE_OPENAI_API_ENDPOINT;
export const LLM_MODEL_NAME: string = import.meta.env.VITE_LLM_MODEL_NAME;
export const IS_CHARTDB_IO: boolean =
    import.meta.env.VITE_IS_CHARTDB_IO === 'true';
export const APP_URL: string = import.meta.env.VITE_APP_URL;
export const HOST_URL: string = import.meta.env.VITE_HOST_URL ?? '';
export const HIDE_CHARTDB_CLOUD: boolean =
    (window?.env?.HIDE_CHARTDB_CLOUD ??
        import.meta.env.VITE_HIDE_CHARTDB_CLOUD) === 'true';
export const DISABLE_ANALYTICS: boolean =
    (window?.env?.DISABLE_ANALYTICS ??
        import.meta.env.VITE_DISABLE_ANALYTICS) === 'true';

/**
 * Reads a runtime (`window.env`, injected by nginx) or build-time (`VITE_*`)
 * value. `envsubst` always emits every key in the nginx template, so an unset
 * variable arrives as an empty string rather than `undefined` - treat those as
 * absent so the defaults below actually apply in a deployed container.
 */
const getEnv = (key: string): string | undefined => {
    const candidates = [window?.env?.[key], import.meta.env[`VITE_${key}`]];
    for (const value of candidates) {
        if (typeof value === 'string' && value.trim() !== '') {
            return value.trim();
        }
    }
    return undefined;
};

export const SYNC_ENABLED: boolean = getEnv('SYNC_ENABLED') === 'true';
export const SYNC_AUTO_SAVE: boolean = getEnv('SYNC_AUTO_SAVE') === 'true';
export const BITBUCKET_API_BASE: string =
    getEnv('BITBUCKET_API_BASE') ?? 'https://api.bitbucket.org/2.0';
export const BITBUCKET_WORKSPACE: string = getEnv('BITBUCKET_WORKSPACE') ?? '';
export const BITBUCKET_REPO: string = getEnv('BITBUCKET_REPO') ?? '';
export const BITBUCKET_GIT_URL: string = getEnv('BITBUCKET_GIT_URL') ?? '';
export const BITBUCKET_BRANCH: string = getEnv('BITBUCKET_BRANCH') ?? 'main';
export const BITBUCKET_FILE_PATH: string =
    getEnv('BITBUCKET_FILE_PATH') ?? 'erd.json';
export const BITBUCKET_USERNAME: string = getEnv('BITBUCKET_USERNAME') ?? '';
export const BITBUCKET_APP_PASSWORD: string =
    getEnv('BITBUCKET_APP_PASSWORD') ?? '';
export const BITBUCKET_API_TOKEN: string = getEnv('BITBUCKET_API_TOKEN') ?? '';
export const SYNC_POLL_INTERVAL_MS: number =
    Number(getEnv('SYNC_POLL_INTERVAL_MS')) || 15000;
export const SYNC_GIT_CORS_PROXY: string =
    getEnv('SYNC_GIT_CORS_PROXY') ?? '/git';
