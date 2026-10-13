import { describe, it, expect, vi } from 'vitest';
import {
    buildBasicAuthHeader,
    createBitbucketClient,
    encodeFilePath,
    type BitbucketApiError,
} from '../bitbucket';

type FakeResponse = {
    status: number;
    ok: boolean;
    text?: () => Promise<string>;
    json?: () => Promise<unknown>;
};

const createFetchMock = (responses: FakeResponse[]) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const response = responses.shift() ?? { status: 404, ok: false };
        return {
            status: response.status,
            ok: response.ok,
            text: async () => (response.text ? response.text() : ''),
            json: async () => (response.json ? response.json() : {}),
        } as unknown as Response;
    }) as unknown as typeof fetch;

    return { fetchImpl, calls };
};

const clientOptions = {
    apiBase: 'https://api.bitbucket.org/2.0',
    workspace: 'team',
    repo: 'erds',
    branch: 'main',
    filePath: 'diagrams/erd-1.json',
    username: 'sync-bot',
    appPassword: 'app-password',
};

describe('bitbucket client', () => {
    it('builds a basic auth header', () => {
        expect(buildBasicAuthHeader('user', 'pass')).toBe(
            `Basic ${btoa('user:pass')}`
        );
    });

    it('encodes nested file paths', () => {
        expect(encodeFilePath('diagrams/erd 1.json')).toBe(
            'diagrams/erd%201.json'
        );
    });

    it('fetches the latest commit hash for the file path', async () => {
        const { fetchImpl, calls } = createFetchMock([
            {
                status: 200,
                ok: true,
                json: async () => ({ values: [{ hash: 'abc123' }] }),
            },
        ]);

        const client = createBitbucketClient(clientOptions, fetchImpl);
        const hash = await client.getFileCommitHash();

        expect(hash).toBe('abc123');
        expect(calls[0].url).toContain(
            '/repositories/team/erds/commits?path=diagrams/erd-1.json'
        );
        expect(calls[0].init?.headers).toEqual(
            expect.objectContaining({
                Authorization: `Basic ${btoa('sync-bot:app-password')}`,
            })
        );
    });

    it('returns null when the file has no commits (404)', async () => {
        const { fetchImpl } = createFetchMock([{ status: 404, ok: false }]);

        const client = createBitbucketClient(clientOptions, fetchImpl);
        expect(await client.getFileCommitHash()).toBeNull();
    });

    it('fetches file content and its commit hash', async () => {
        const { fetchImpl } = createFetchMock([
            { status: 200, ok: true, text: async () => '{ "diagram": true }' },
            {
                status: 200,
                ok: true,
                json: async () => ({ values: [{ hash: 'def456' }] }),
            },
        ]);

        const client = createBitbucketClient(clientOptions, fetchImpl);
        const file = await client.getFile();

        expect(file.content).toBe('{ "diagram": true }');
        expect(file.commitHash).toBe('def456');
    });

    it('returns content null when the file is missing', async () => {
        const { fetchImpl } = createFetchMock([
            { status: 404, ok: false },
            { status: 200, ok: true, json: async () => ({ values: [] }) },
        ]);

        const client = createBitbucketClient(clientOptions, fetchImpl);
        const file = await client.getFile();

        expect(file.content).toBeNull();
    });

    it('throws a typed error on rate limit (429)', async () => {
        const { fetchImpl } = createFetchMock([{ status: 429, ok: false }]);

        const client = createBitbucketClient(clientOptions, fetchImpl);
        await expect(client.getFileCommitHash()).rejects.toMatchObject({
            status: 429,
            name: 'BitbucketApiError',
        } satisfies Partial<BitbucketApiError>);
    });
});
