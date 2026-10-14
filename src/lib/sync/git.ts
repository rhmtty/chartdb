import * as git from 'isomorphic-git';
import type { GitAuth, HttpClient } from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import LightningFS from '@isomorphic-git/lightning-fs';
import type { SyncClient } from './types';

interface GitWriterFs {
    readFile: (path: string, options?: unknown) => Promise<unknown>;
    writeFile: (
        path: string,
        data: unknown,
        options?: unknown
    ) => Promise<void>;
    unlink: (path: string) => Promise<void>;
    readdir: (path: string) => Promise<unknown>;
    mkdir: (path: string, options?: unknown) => Promise<void>;
    rmdir: (path: string) => Promise<void>;
    stat: (path: string) => Promise<unknown>;
    lstat: (path: string) => Promise<unknown>;
    readlink?: (path: string) => Promise<unknown>;
    symlink?: (target: string, path: string) => Promise<void>;
}

export interface GitWriterOptions {
    gitUrl: string;
    branch: string;
    filePath: string;
    username: string;
    appPassword: string;
    authorName?: string;
    authorEmail?: string;
    fsName?: string;
    fs?: GitWriterFs;
    httpClient?: HttpClient;
    corsProxy?: string;
    dir?: string;
}

const extractGitUsername = (gitUrl: string): string | null => {
    const match = /^https?:\/\/([^@/]+)@/.exec(gitUrl);
    if (!match) {
        return null;
    }
    const userinfo = match[1];
    const separatorIndex = userinfo.indexOf(':');
    const username =
        separatorIndex >= 0 ? userinfo.slice(0, separatorIndex) : userinfo;
    // `withGitCredentials` percent-encodes the username when embedding it, so an
    // email login arrives here as `user%40example.com`. The Basic auth header
    // needs the literal value, not the encoded one.
    try {
        return decodeURIComponent(username);
    } catch {
        return username;
    }
};

const mkdirp = async (fs: GitWriterFs, absolutePath: string): Promise<void> => {
    if (absolutePath === '/' || absolutePath === '') {
        return;
    }

    let current = '/';
    for (const segment of absolutePath.split('/').filter(Boolean)) {
        current = current === '/' ? `/${segment}` : `${current}/${segment}`;
        try {
            await fs.mkdir(current);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException | undefined)?.code;
            const message =
                error instanceof Error ? error.message : String(error);
            if (code === 'EEXIST' || message.includes('EEXIST')) {
                continue;
            }
            throw error;
        }
    }
};

/**
 * The only clone failures worth recovering from locally. Everything else -
 * HTTP status errors, a CORS block or dead proxy (a bare `TypeError: Failed to
 * fetch` in the browser), DNS and connection failures (plain `Error`s carrying
 * `ENOTFOUND`/`ECONNREFUSED`) - means the remote was never read. Recovering
 * from those builds a local repo with no history and reports a confusing push
 * rejection instead of the real cause, so they must propagate.
 *
 * Note: cloning an *empty* remote succeeds (it just leaves HEAD on the remote's
 * default branch), so the empty-repo case does not reach this list. What does
 * reach it is a repo whose configured branch does not exist yet.
 */
const RECOVERABLE_CLONE_ERROR_CODES = new Set([
    'NotFoundError',
    'NoRefspecError',
    'RemoteCapabilityError',
    'EmptyServerResponseError',
]);

const describeError = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const isRecoverableCloneError = (error: unknown): boolean => {
    const code = (error as { code?: string } | undefined)?.code;
    return code !== undefined && RECOVERABLE_CLONE_ERROR_CODES.has(code);
};

/**
 * Creates a git-based writer that commits `{diagramId}.json` to the configured
 * Bitbucket Cloud repo over HTTPS (app-password auth). The Bitbucket REST
 * `PUT /src` endpoint does not support token-based authentication, so writes
 * go through git instead; reads still use the REST API.
 */
export const createGitWriter = (
    options: GitWriterOptions
): Pick<SyncClient, 'putFile'> => {
    const fsImpl: GitWriterFs =
        options.fs ??
        (new LightningFS(
            options.fsName ?? 'chartdb-sync'
        ) as unknown as GitWriterFs);
    // isomorphic-git wraps the given fs in a FileSystem that prefers
    // `fs.promises` when present (LightningFS) and otherwise uses the object
    // directly (node's fs/promises). For our own direct operations, resolve the
    // promise-style API the same way.
    const pfs = ((fsImpl as { promises?: GitWriterFs }).promises ??
        fsImpl) as GitWriterFs;
    const dir = options.dir ?? '/';
    const httpClient = options.httpClient ?? http;
    const gitUsername = extractGitUsername(options.gitUrl) ?? options.username;

    const auth = (): GitAuth => ({
        username: gitUsername,
        password: options.appPassword,
    });

    const resolvePath = (filePath: string): string =>
        dir === '/' ? `/${filePath}` : `${dir}/${filePath}`;

    const mkdirForFile = async (filePath: string): Promise<void> => {
        const absolute = resolvePath(filePath);
        const slashIndex = absolute.lastIndexOf('/');
        const parent = slashIndex > 0 ? absolute.slice(0, slashIndex) : '/';
        await mkdirp(pfs, parent);
    };

    const ensureRepo = async (): Promise<void> => {
        let isRepo = true;
        try {
            await git.log({ fs: fsImpl, dir, depth: 1 });
        } catch {
            isRepo = false;
        }
        if (isRepo) {
            return;
        }

        try {
            await git.clone({
                fs: fsImpl,
                http: httpClient,
                dir,
                url: options.gitUrl,
                corsProxy: options.corsProxy,
                ref: options.branch,
                singleBranch: true,
                depth: 1,
                onAuth: auth,
            });
            return;
        } catch (error) {
            if (!isRecoverableCloneError(error)) {
                throw new Error(
                    `Cannot reach the Bitbucket repository: ${describeError(error)}. ` +
                        'Check the credentials and that the git CORS proxy ' +
                        '(SYNC_GIT_CORS_PROXY) is reachable.',
                    { cause: error }
                );
            }

            // The configured branch does not exist on the remote yet. Initialize
            // a local repo and wire the remote so the first push creates it.
            await git.init({ fs: fsImpl, dir, defaultBranch: options.branch });
            // `force` keeps origin pointed at the current credentials: the URL
            // embeds them, so a rotated app password changes the URL and a
            // non-forced addRemote would reject it as an existing remote.
            await git.addRemote({
                fs: fsImpl,
                dir,
                remote: 'origin',
                url: options.gitUrl,
                force: true,
            });
        }
    };

    const fetchLatest = async (): Promise<void> => {
        try {
            await git.fetch({
                fs: fsImpl,
                http: httpClient,
                dir,
                remote: 'origin',
                ref: options.branch,
                corsProxy: options.corsProxy,
                singleBranch: true,
                depth: 1,
                onAuth: auth,
            });
            // Hard-align the worktree and index with the remote tip so a
            // concurrent editor's change is never overwritten without a rebase.
            // This leaves HEAD detached at origin/<branch>; the branch ref is
            // re-pointed at the new commit right before pushing.
            await git.checkout({
                fs: fsImpl,
                dir,
                ref: `origin/${options.branch}`,
                force: true,
            });
        } catch {
            // No remote branch yet (empty repo) - nothing to fast-forward to.
        }
    };

    const writeFile = async (content: string): Promise<void> => {
        await mkdirForFile(options.filePath);
        await pfs.writeFile(resolvePath(options.filePath), content, 'utf8');
    };

    const commitAndPush = async (message: string): Promise<string> => {
        const author = {
            name: options.authorName || gitUsername,
            email: options.authorEmail || options.username,
        };

        await git.add({ fs: fsImpl, dir, filepath: options.filePath });
        const oid = await git.commit({ fs: fsImpl, dir, message, author });

        // HEAD may be detached after fast-forwarding to origin/<branch>;
        // point the local branch at the new commit so the push is a fast-forward.
        await git.branch({
            fs: fsImpl,
            dir,
            ref: options.branch,
            object: oid,
            force: true,
        });

        const result = await git.push({
            fs: fsImpl,
            http: httpClient,
            dir,
            remote: 'origin',
            ref: options.branch,
            corsProxy: options.corsProxy,
            onAuth: auth,
        });

        if (!result.ok) {
            // `result.error` carries the remote's "unpack" failure and
            // `result.refs[ref].error` the per-ref reason (non-fast-forward, a
            // declined pre-receive hook, branch permissions). Reporting the
            // generic message instead hides the only useful detail.
            const refError = Object.entries(result.refs ?? {})
                .filter(([, status]) => !status.ok)
                .map(
                    ([ref, status]) =>
                        `${ref}: ${status.error ?? 'rejected by remote'}`
                )
                .join('; ');
            const detail =
                [result.error, refError].filter(Boolean).join(' ') ||
                'rejected by remote';

            throw new Error(`Failed to push to Bitbucket: ${detail}`);
        }

        return oid;
    };

    return {
        putFile: async ({ content, message }): Promise<string> => {
            await ensureRepo();
            await fetchLatest();
            await writeFile(content);

            try {
                return await commitAndPush(message);
            } catch (firstError) {
                // Likely a non-fast-forward push (another editor pushed while we
                // were writing). Re-sync to the latest remote and retry once.
                await fetchLatest();
                await writeFile(content);
                try {
                    return await commitAndPush(message);
                } catch (retryError) {
                    // Report both attempts: when the retry fails for a different
                    // reason than the first, the original cause is the useful one.
                    const first = describeError(firstError);
                    const second = describeError(retryError);
                    throw new Error(
                        first === second
                            ? second
                            : `${second} (first attempt: ${first})`,
                        { cause: retryError }
                    );
                }
            }
        },
    };
};
