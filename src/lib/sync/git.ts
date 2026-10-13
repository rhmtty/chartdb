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
    return separatorIndex >= 0 ? userinfo.slice(0, separatorIndex) : userinfo;
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
        } catch {
            // Cloning an empty remote repo (no commits yet) fails. Initialize a
            // local repo and wire the remote so the first push creates the branch.
            await git.init({ fs: fsImpl, dir, defaultBranch: options.branch });
            await git.addRemote({
                fs: fsImpl,
                dir,
                remote: 'origin',
                url: options.gitUrl,
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
            throw new Error('Failed to push to Bitbucket: rejected by remote.');
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
            } catch {
                // Likely a non-fast-forward push (another editor pushed while we
                // were writing). Re-sync to the latest remote and retry once.
                await fetchLatest();
                await writeFile(content);
                return await commitAndPush(message);
            }
        },
    };
};
