import {
    BITBUCKET_API_BASE,
    BITBUCKET_API_TOKEN,
    BITBUCKET_APP_PASSWORD,
    BITBUCKET_BRANCH,
    BITBUCKET_FILE_PATH,
    BITBUCKET_GIT_URL,
    BITBUCKET_REPO,
    BITBUCKET_USERNAME,
    BITBUCKET_WORKSPACE,
    SYNC_ENABLED,
    SYNC_GIT_CORS_PROXY,
    SYNC_POLL_INTERVAL_MS,
} from '@/lib/env';
import type { SyncConfig } from './types';

export const resolveGitUrl = (
    gitUrl: string,
    workspace: string,
    repo: string
): string => {
    if (gitUrl) {
        return gitUrl;
    }
    return `https://bitbucket.org/${workspace}/${repo}.git`;
};

/**
 * Embeds the app-password credentials into the git URL. isomorphic-git only
 * sends an `Authorization` header on the first request when the URL itself
 * carries userinfo; otherwise Bitbucket answers with a 401 challenge and the
 * browser shows a native username/password dialog. Adding the password here
 * authenticates the very first request so that dialog never appears.
 */
export const withGitCredentials = (
    gitUrl: string,
    username: string,
    appPassword: string
): string => {
    if (!username || !appPassword) {
        return gitUrl;
    }
    const cleanUrl = gitUrl.replace(/^(https?:\/\/)[^@/]+@/, '$1');
    return cleanUrl.replace(
        /^(https?:\/\/)/,
        `$1${encodeURIComponent(username)}:${encodeURIComponent(appPassword)}@`
    );
};

/**
 * Bitbucket is replacing app passwords with API tokens, which are rejected for
 * git smart-HTTP on Atlassian accounts. When an API token is configured we
 * authenticate git with the documented static username `x-token-auth` (the
 * token is the password); otherwise we fall back to the app password.
 */
const GIT_TOKEN_USERNAME = 'x-token-auth';

export const buildSyncConfig = (): SyncConfig | null => {
    if (!SYNC_ENABLED) {
        return null;
    }

    const authSecret = BITBUCKET_API_TOKEN || BITBUCKET_APP_PASSWORD;
    const gitAuthUsername = BITBUCKET_API_TOKEN
        ? GIT_TOKEN_USERNAME
        : BITBUCKET_USERNAME;

    if (
        !BITBUCKET_WORKSPACE ||
        !BITBUCKET_REPO ||
        !BITBUCKET_USERNAME ||
        !authSecret
    ) {
        return null;
    }

    return {
        apiBase: BITBUCKET_API_BASE,
        workspace: BITBUCKET_WORKSPACE,
        repo: BITBUCKET_REPO,
        branch: BITBUCKET_BRANCH || 'main',
        filePath: BITBUCKET_FILE_PATH || 'erd.json',
        gitUrl: withGitCredentials(
            resolveGitUrl(
                BITBUCKET_GIT_URL,
                BITBUCKET_WORKSPACE,
                BITBUCKET_REPO
            ),
            gitAuthUsername,
            authSecret
        ),
        gitCorsProxy: SYNC_GIT_CORS_PROXY,
        username: BITBUCKET_USERNAME,
        appPassword: authSecret,
        gitAuthUsername,
        gitAuthPassword: authSecret,
        pollIntervalMs: SYNC_POLL_INTERVAL_MS,
    };
};

export const resolveFilePath = (template: string, diagramId: string): string =>
    template.replaceAll('{diagramId}', diagramId);
