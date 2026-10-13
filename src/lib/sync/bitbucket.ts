import type {
    BitbucketClientOptions,
    FileWithCommit,
    SyncClient,
} from './types';

export class BitbucketApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.name = 'BitbucketApiError';
        this.status = status;
    }
}

export const buildBasicAuthHeader = (
    username: string,
    appPassword: string
): string => {
    return `Basic ${btoa(`${username}:${appPassword}`)}`;
};

export const encodeFilePath = (filePath: string): string => {
    return filePath
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
};

export const createBitbucketClient = (
    options: BitbucketClientOptions,
    fetchImpl: typeof fetch = fetch
) => {
    const authHeader = buildBasicAuthHeader(
        options.username,
        options.appPassword
    );

    const request = async (
        url: string,
        init?: RequestInit
    ): Promise<Response> => {
        const response = await fetchImpl(url, {
            ...init,
            headers: {
                Authorization: authHeader,
                ...(init?.headers ?? {}),
            },
        });

        if (response.status === 429) {
            throw new BitbucketApiError(
                429,
                'Bitbucket API rate limit exceeded. Retrying later.'
            );
        }

        return response;
    };

    return {
        /**
         * Returns the hash of the latest commit touching the synced file path,
         * or null when the file does not exist yet.
         */
        getFileCommitHash: async (): Promise<string | null> => {
            const url =
                `${options.apiBase}/repositories/${options.workspace}/${options.repo}` +
                `/commits?path=${encodeFilePath(options.filePath)}&pagelen=1&fields=values.hash`;
            const response = await request(url);

            if (response.status === 404) {
                return null;
            }

            if (!response.ok) {
                throw new BitbucketApiError(
                    response.status,
                    `Failed to read remote commit hash: ${response.status}`
                );
            }

            const data = (await response.json()) as {
                values?: { hash?: string }[];
            };
            const hash = data.values?.[0]?.hash;

            return hash ?? null;
        },

        /**
         * Returns the current file content plus the commit hash of the file's
         * latest commit. Returns `{ content: null }` when the file is missing.
         */
        getFile: async (): Promise<FileWithCommit> => {
            const contentResponse = await request(
                `${options.apiBase}/repositories/${options.workspace}/${options.repo}` +
                    `/src/${options.branch}/${encodeFilePath(options.filePath)}`
            );

            if (contentResponse.status === 404) {
                return { content: null, commitHash: '' };
            }

            if (!contentResponse.ok) {
                throw new BitbucketApiError(
                    contentResponse.status,
                    `Failed to read remote file: ${contentResponse.status}`
                );
            }

            const content = await contentResponse.text();

            // Latest commit hash for the file path.
            const commitResponse = await fetchImpl(
                `${options.apiBase}/repositories/${options.workspace}/${options.repo}` +
                    `/commits?path=${encodeFilePath(options.filePath)}&pagelen=1&fields=values.hash`,
                { headers: { Authorization: authHeader } }
            );

            let commitHash = '';
            if (commitResponse.ok) {
                const data = (await commitResponse.json()) as {
                    values?: { hash?: string }[];
                };
                commitHash = data.values?.[0]?.hash ?? '';
            }

            return { content, commitHash };
        },
    };
};

export type BitbucketReadClient = Pick<
    SyncClient,
    'getFileCommitHash' | 'getFile'
>;
