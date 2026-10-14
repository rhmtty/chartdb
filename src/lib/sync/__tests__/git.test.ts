import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    createServer,
    type Server,
    type IncomingMessage,
    type ServerResponse,
} from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { promises as nodeFs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { createGitWriter, type GitWriterOptions } from '../git';

const GIT_AVAILABLE = (() => {
    try {
        spawn('git', ['--version']);
        return true;
    } catch {
        return false;
    }
})();

const serveGit = async (
    projectRoot: string
): Promise<{ server: Server; baseUrl: string }> => {
    let port = 0;

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const pathInfo = decodeURIComponent(url.pathname);
        const queryString = url.search.slice(1);

        const env = {
            ...process.env,
            GIT_PROJECT_ROOT: projectRoot,
            GIT_HTTP_EXPORT_ALL: '1',
            REQUEST_METHOD: req.method ?? 'GET',
            PATH_INFO: pathInfo,
            QUERY_STRING: queryString,
            CONTENT_TYPE: req.headers['content-type'] ?? '',
            CONTENT_LENGTH: req.headers['content-length'] ?? '',
            REMOTE_ADDR: req.socket.remoteAddress ?? '',
            SERVER_PROTOCOL: 'HTTP/1.1',
            SERVER_NAME: '127.0.0.1',
            SERVER_PORT: String(port),
        };

        const child = spawn('git', ['http-backend'], {
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        const chunks: Buffer[] = [];
        child.stderr.on('data', (d: Buffer) => void d);
        child.stdout.on('data', (d: Buffer) => chunks.push(Buffer.from(d)));

        child.on('close', (code) => {
            const buf = Buffer.concat(chunks);
            const sep = buf.indexOf('\r\n\r\n');
            if (sep === -1) {
                res.statusCode = code === 0 ? 200 : 500;
                res.end(buf);
                return;
            }

            const headerBlock = buf.subarray(0, sep).toString('latin1');
            const body = buf.subarray(sep + 4);
            let statusCode = 200;
            for (const line of headerBlock.split('\r\n')) {
                const idx = line.indexOf(':');
                if (idx <= 0) continue;
                const name = line.slice(0, idx).trim();
                const value = line.slice(idx + 1).trim();
                if (name.toLowerCase() === 'status') {
                    statusCode = parseInt(value, 10) || 200;
                } else if (name.toLowerCase() !== 'content-length') {
                    res.setHeader(name, value);
                }
            }
            res.statusCode = statusCode;
            res.end(body);
        });

        child.on('error', () => {
            res.statusCode = 500;
            res.end('git http-backend failed');
        });

        req.pipe(child.stdin);
    });

    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    port = typeof address === 'object' && address ? address.port : 0;
    return { server, baseUrl: `http://127.0.0.1:${port}/erds.git` };
};

describe.skipIf(!GIT_AVAILABLE)('git writer', () => {
    let server!: Server;
    let projectRoot!: string;
    let repoDir!: string;
    let workDir!: string;
    let baseUrl!: string;

    const makeOptions = (): GitWriterOptions => ({
        gitUrl: baseUrl,
        branch: 'main',
        filePath: 'diagrams/erd-1.json',
        username: 'sync-bot',
        appPassword: 'app-password',
        authorName: 'sync-bot',
        authorEmail: 'sync-bot@example.com',
        fs: nodeFs as unknown as GitWriterOptions['fs'],
        dir: workDir,
        httpClient: http,
    });

    const remoteLog = async () =>
        git.log({ fs: nodeFs, dir: repoDir, gitdir: repoDir, ref: 'main' });

    const readRemoteBlob = async (
        oid: string,
        filepath: string
    ): Promise<string> => {
        const blob = await git.readBlob({
            fs: nodeFs,
            dir: repoDir,
            gitdir: repoDir,
            oid,
            filepath,
        });
        return Buffer.from(blob.blob).toString('utf8');
    };

    beforeAll(async () => {
        projectRoot = await nodeFs.mkdtemp(
            path.join(os.tmpdir(), 'chartdb-git-')
        );
        repoDir = path.join(projectRoot, 'erds.git');
        workDir = path.join(projectRoot, 'work');
        await nodeFs.mkdir(workDir, { recursive: true });
        await git.init({
            fs: nodeFs,
            dir: repoDir,
            bare: true,
            defaultBranch: 'main',
        });
        // `git http-backend` denies receive-pack unless http.receivepack is on.
        const config = spawnSync('git', [
            '-C',
            repoDir,
            'config',
            'http.receivepack',
            'true',
        ]);
        if (config.status !== 0) {
            throw new Error(
                `failed to enable http.receivepack: ${config.stderr}`
            );
        }

        const served = await serveGit(projectRoot);
        server = served.server;
        baseUrl = served.baseUrl;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await nodeFs.rm(projectRoot, { recursive: true, force: true });
    });

    it('creates the file on an empty remote and returns the commit sha', async () => {
        const writer = createGitWriter(makeOptions());

        const oid = await writer.putFile({
            content: '{"diagram":true}',
            message: '[ChartDB] sync first',
        });

        const log = await remoteLog();
        expect(log).toHaveLength(1);
        expect(log[0].oid).toBe(oid);
        expect(await readRemoteBlob(oid, 'diagrams/erd-1.json')).toBe(
            '{"diagram":true}'
        );
    });

    it('updates the file and fast-forwards the remote', async () => {
        const writer = createGitWriter(makeOptions());

        const oid = await writer.putFile({
            content: '{"diagram":false}',
            message: '[ChartDB] sync second',
        });

        const log = await remoteLog();
        expect(log).toHaveLength(2);
        expect(log[0].oid).toBe(oid);
        expect(await readRemoteBlob(oid, 'diagrams/erd-1.json')).toBe(
            '{"diagram":false}'
        );
    });

    it('re-bases on top of a remote commit made by someone else', async () => {
        // Simulate a concurrent editor: clone the remote and push an extra
        // change so our next push is initially non-fast-forward.
        const otherDir = path.join(projectRoot, 'work-other');
        await nodeFs.mkdir(otherDir, { recursive: true });
        await git.clone({
            fs: nodeFs,
            http,
            dir: otherDir,
            url: baseUrl,
            ref: 'main',
            singleBranch: true,
            depth: 1,
        });
        await nodeFs.writeFile(
            path.join(otherDir, 'notes.md'),
            'team note',
            'utf8'
        );
        await git.add({ fs: nodeFs, dir: otherDir, filepath: 'notes.md' });
        await git.commit({
            fs: nodeFs,
            dir: otherDir,
            message: '[ChartDB] team note',
            author: { name: 'other', email: 'other@example.com' },
        });
        await git.push({
            fs: nodeFs,
            http,
            dir: otherDir,
            remote: 'origin',
            ref: 'main',
        });

        const writer = createGitWriter(makeOptions());
        const oid = await writer.putFile({
            content: '{"diagram":"rebase"}',
            message: '[ChartDB] sync rebased',
        });

        const log = await remoteLog();
        expect(log).toHaveLength(4);
        expect(log[0].oid).toBe(oid);

        // The other editor's file must be preserved on the remote.
        expect(await readRemoteBlob(log[0].oid, 'notes.md')).toBe('team note');
        expect(await readRemoteBlob(log[0].oid, 'diagrams/erd-1.json')).toBe(
            '{"diagram":"rebase"}'
        );
    });

    it('propagates failures from the remote as rejected promises', async () => {
        const badWorkDir = path.join(projectRoot, 'work-bad');
        await nodeFs.mkdir(badWorkDir, { recursive: true });
        const writer = createGitWriter({
            ...makeOptions(),
            gitUrl: 'https://invalid.invalid/repo.git',
            dir: badWorkDir,
        });

        await expect(
            writer.putFile({
                content: '{}',
                message: '[ChartDB] should fail',
            })
        ).rejects.toThrow();
    });

    it('reports an unreachable remote instead of silently starting a fresh history', async () => {
        // A CORS block or dead proxy must not be mistaken for "empty repo":
        // doing so builds a local repo with no history and reports a confusing
        // push rejection rather than the real connectivity failure.
        const unreachableDir = path.join(projectRoot, 'work-unreachable');
        await nodeFs.mkdir(unreachableDir, { recursive: true });
        const writer = createGitWriter({
            ...makeOptions(),
            // Port 1 is closed, so the transport fails rather than 404ing.
            gitUrl: 'http://127.0.0.1:1/erds.git',
            dir: unreachableDir,
        });

        await expect(
            writer.putFile({
                content: '{}',
                message: '[ChartDB] unreachable',
            })
        ).rejects.toThrow(/Cannot reach the Bitbucket repository/);
    });

    it('decodes a percent-encoded email username for basic auth', async () => {
        // `withGitCredentials` percent-encodes the username, so the writer must
        // decode it before using it as the git author / auth username.
        const emailDir = path.join(projectRoot, 'work-email');
        await nodeFs.mkdir(emailDir, { recursive: true });
        const encodedUrl = baseUrl.replace(
            /^http:\/\//,
            'http://analyst%40example.com:secret@'
        );

        const writer = createGitWriter({
            gitUrl: encodedUrl,
            branch: 'main',
            filePath: 'diagrams/erd-email.json',
            username: 'analyst@example.com',
            appPassword: 'secret',
            fs: nodeFs as unknown as GitWriterOptions['fs'],
            dir: emailDir,
            httpClient: http,
        });

        const oid = await writer.putFile({
            content: '{"diagram":"email"}',
            message: '[ChartDB] sync email author',
        });

        const commits = await remoteLog();
        const pushed = commits.find((entry) => entry.oid === oid);
        expect(pushed?.commit.author.name).toBe('analyst@example.com');
    });
});
