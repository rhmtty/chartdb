import React, {
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    storageContext,
    type StorageContext,
} from '../storage-context/storage-context';
import {
    syncContext,
    initialSyncState,
    type SyncContext,
} from './sync-context';
import type { Diagram } from '@/lib/domain/diagram';
import type { SyncClient, SyncConfig, SyncState } from '@/lib/sync/types';
import {
    createBitbucketClient,
    type BitbucketReadClient,
} from '@/lib/sync/bitbucket';
import { createGitWriter } from '@/lib/sync/git';
import { diagramFromSyncJson, diagramToSyncJson } from '@/lib/sync/serialize';
import { buildSyncConfig, resolveFilePath } from '@/lib/sync/config';
import { SYNC_AUTO_SAVE } from '@/lib/env';

const DIAGRAM_READ_OPTIONS = {
    includeTables: true,
    includeRelationships: true,
    includeDependencies: true,
    includeAreas: true,
    includeCustomTypes: true,
    includeNotes: true,
} as const;

const WRITE_METHODS = [
    'addDiagram',
    'updateDiagram',
    'deleteDiagram',
    'addTable',
    'updateTable',
    'putTable',
    'deleteTable',
    'deleteDiagramTables',
    'addRelationship',
    'updateRelationship',
    'deleteRelationship',
    'deleteDiagramRelationships',
    'addDependency',
    'updateDependency',
    'deleteDependency',
    'deleteDiagramDependencies',
    'addArea',
    'updateArea',
    'deleteArea',
    'deleteDiagramAreas',
    'addCustomType',
    'updateCustomType',
    'deleteCustomType',
    'deleteDiagramCustomTypes',
    'addNote',
    'updateNote',
    'deleteNote',
    'deleteDiagramNotes',
] as const;

export const SyncProvider: React.FC<React.PropsWithChildren> = ({
    children,
}) => {
    const rawStorage = useContext(storageContext);
    const config = useMemo<SyncConfig | null>(() => buildSyncConfig(), []);
    const enabled = config !== null;

    const [state, setState] = useState<SyncState>(initialSyncState);
    const stateRef = useRef(state);
    stateRef.current = state;

    const [autoSave, setAutoSaveState] = useState(SYNC_AUTO_SAVE);
    const autoSaveRef = useRef(autoSave);
    autoSaveRef.current = autoSave;

    const clientRef = useRef<SyncClient | null>(null);
    const diagramIdRef = useRef<string | null>(null);
    const pollTimerRef = useRef<number | null>(null);
    const pushDebounceRef = useRef<number | null>(null);
    const dirtyRef = useRef(false);
    const busyRef = useRef(false);
    const applyingRemoteRef = useRef(false);
    const pendingApplyRef = useRef<Diagram | null>(null);
    const applierRef = useRef<((diagram: Diagram) => Promise<void>) | null>(
        null
    );

    const buildClientForDiagram = useCallback(
        (diagramId: string): SyncClient | null => {
            if (!config) {
                return null;
            }

            const filePath = resolveFilePath(config.filePath, diagramId);
            const readClient: BitbucketReadClient = createBitbucketClient({
                apiBase: config.apiBase,
                workspace: config.workspace,
                repo: config.repo,
                branch: config.branch,
                filePath,
                username: config.username,
                appPassword: config.appPassword,
            });
            const gitWriter = createGitWriter({
                gitUrl: config.gitUrl,
                branch: config.branch,
                filePath,
                username: config.gitAuthUsername,
                appPassword: config.gitAuthPassword,
                authorName: config.username,
                authorEmail: config.username,
                corsProxy: config.gitCorsProxy,
                fsName: `chartdb-${config.workspace}-${config.repo}-${diagramId}`,
            });

            return { ...readClient, putFile: gitWriter.putFile };
        },
        [config]
    );

    const setPartialState = useCallback((patch: Partial<SyncState>) => {
        setState((prev) => ({ ...prev, ...patch }));
    }, []);

    const push = useCallback(async (): Promise<void> => {
        if (!config || !clientRef.current) {
            return;
        }

        const diagramId = diagramIdRef.current;
        if (!diagramId) {
            return;
        }

        if (busyRef.current) {
            // A pull (or another push) is in flight - retry shortly so local
            // edits are never silently dropped.
            window.setTimeout(() => {
                void pushRef.current();
            }, 500);
            return;
        }

        busyRef.current = true;
        try {
            const diagram = await rawStorage.getDiagram(
                diagramId,
                DIAGRAM_READ_OPTIONS
            );

            if (!diagram) {
                return;
            }

            const content = diagramToSyncJson(diagram);
            const hash = await clientRef.current.putFile({
                content,
                message: `[ChartDB] sync ${diagram.name} ${new Date().toISOString()}`,
            });

            dirtyRef.current = false;
            setPartialState({
                status: 'synced',
                lastSyncAt: new Date(),
                lastPushedCommit: hash,
                lastPulledCommit: hash,
                error: null,
                hasPendingChanges: false,
            });
        } catch (error) {
            setPartialState({
                status: 'error',
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            busyRef.current = false;
        }
    }, [config, rawStorage, setPartialState]);

    const pushRef = useRef(push);
    pushRef.current = push;

    const applyRemote = useCallback(async (remote: Diagram): Promise<void> => {
        applyingRemoteRef.current = true;
        try {
            if (applierRef.current) {
                await applierRef.current(remote);
            } else {
                pendingApplyRef.current = remote;
            }
        } finally {
            applyingRemoteRef.current = false;
        }
    }, []);

    const pull = useCallback(async (): Promise<void> => {
        if (!config || !clientRef.current) {
            return;
        }

        const diagramId = diagramIdRef.current;
        if (!diagramId || busyRef.current) {
            return;
        }

        busyRef.current = true;
        try {
            const remoteHash = await clientRef.current.getFileCommitHash();

            if (remoteHash === null) {
                // No remote file yet. In auto-save mode, create it when the
                // local diagram has content; in manual mode, surface the local
                // content as pending so the user can save it.
                const diagram = await rawStorage.getDiagram(
                    diagramId,
                    DIAGRAM_READ_OPTIONS
                );
                if (diagram && (diagram.tables?.length ?? 0) > 0) {
                    if (autoSaveRef.current) {
                        await pushRef.current();
                    } else {
                        dirtyRef.current = true;
                        setPartialState({
                            status: 'idle',
                            lastSyncAt: new Date(),
                            error: null,
                            hasPendingChanges: true,
                        });
                    }
                } else {
                    setPartialState({
                        status: 'synced',
                        lastSyncAt: new Date(),
                        error: null,
                    });
                }
                return;
            }

            if (
                remoteHash === stateRef.current.lastPushedCommit ||
                remoteHash === stateRef.current.lastPulledCommit
            ) {
                if (remoteHash === stateRef.current.lastPushedCommit) {
                    // Our own push echoed back - nothing pending to send.
                    dirtyRef.current = false;
                }
                setPartialState({
                    status: dirtyRef.current
                        ? autoSaveRef.current
                            ? 'syncing'
                            : 'idle'
                        : 'synced',
                    lastSyncAt: new Date(),
                    error: null,
                });
                return;
            }

            const file = await clientRef.current.getFile();
            if (!file.content) {
                setPartialState({
                    status: 'synced',
                    lastSyncAt: new Date(),
                    error: null,
                });
                return;
            }

            let remote: Diagram;
            try {
                remote = diagramFromSyncJson(file.content);
            } catch {
                setPartialState({
                    status: 'error',
                    error: 'Remote diagram file is invalid or unsupported.',
                });
                return;
            }

            if (dirtyRef.current) {
                // Remote changed while we have unsent local edits.
                setPartialState({
                    status: 'conflict',
                    remoteDiagram: remote,
                    lastPulledCommit: remoteHash,
                    lastSyncAt: new Date(),
                    error: null,
                });
                return;
            }

            await applyRemote(remote);
            setPartialState({
                status: 'synced',
                lastSyncAt: new Date(),
                lastPushedCommit: remoteHash,
                lastPulledCommit: remoteHash,
                remoteDiagram: null,
                error: null,
            });
        } catch (error) {
            setPartialState({
                status: 'error',
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            busyRef.current = false;
        }
    }, [config, rawStorage, setPartialState, applyRemote]);

    const pullRef = useRef(pull);
    pullRef.current = pull;

    const notifyLocalChange = useCallback(() => {
        if (applyingRemoteRef.current || !config || !diagramIdRef.current) {
            return;
        }

        dirtyRef.current = true;
        setState((prev) => {
            if (prev.status === 'conflict') {
                return { ...prev, hasPendingChanges: true };
            }

            return autoSaveRef.current
                ? {
                      ...prev,
                      status: 'syncing',
                      error: null,
                      hasPendingChanges: true,
                  }
                : {
                      ...prev,
                      status: 'idle',
                      error: null,
                      hasPendingChanges: true,
                  };
        });

        if (!autoSaveRef.current) {
            return;
        }

        if (pushDebounceRef.current) {
            window.clearTimeout(pushDebounceRef.current);
        }
        pushDebounceRef.current = window.setTimeout(() => {
            void pushRef.current();
        }, 1500);
    }, [config, setState]);

    const stopSync = useCallback(() => {
        if (pollTimerRef.current) {
            window.clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
        }
        if (pushDebounceRef.current) {
            window.clearTimeout(pushDebounceRef.current);
            pushDebounceRef.current = null;
        }
        diagramIdRef.current = null;
        dirtyRef.current = false;
        pendingApplyRef.current = null;
        clientRef.current = null;
        setState(initialSyncState);
    }, []);

    const startSync = useCallback(
        async (diagramId: string): Promise<void> => {
            if (!config) {
                return;
            }

            stopSync();
            diagramIdRef.current = diagramId;
            clientRef.current = buildClientForDiagram(diagramId);
            setPartialState({ status: 'syncing', error: null });

            await pullRef.current();

            if (pollTimerRef.current) {
                window.clearInterval(pollTimerRef.current);
            }
            pollTimerRef.current = window.setInterval(() => {
                void pullRef.current();
            }, config.pollIntervalMs);
        },
        [config, buildClientForDiagram, stopSync, setPartialState]
    );

    const fetchRemote = useCallback(
        async (diagramId: string): Promise<Diagram | undefined> => {
            if (!config) {
                return undefined;
            }

            const client = buildClientForDiagram(diagramId);
            if (!client) {
                return undefined;
            }

            const file = await client.getFile();
            if (!file.content) {
                return undefined;
            }

            const remote = diagramFromSyncJson(file.content);
            setPartialState({ lastPulledCommit: file.commitHash });

            return remote;
        },
        [config, buildClientForDiagram, setPartialState]
    );

    const takeRemote = useCallback(async (): Promise<void> => {
        const remote = stateRef.current.remoteDiagram;
        if (!remote) {
            return;
        }

        dirtyRef.current = false;
        await applyRemote(remote);
        setPartialState({
            status: 'synced',
            remoteDiagram: null,
            lastSyncAt: new Date(),
            error: null,
            hasPendingChanges: false,
        });
    }, [applyRemote, setPartialState]);

    const pushLocal = useCallback(async (): Promise<void> => {
        dirtyRef.current = false;
        await pushRef.current();
    }, []);

    const saveNow = useCallback(async (): Promise<void> => {
        await pushRef.current();
    }, []);

    const setAutoSave = useCallback((enabled: boolean): void => {
        setAutoSaveState(enabled);
        if (enabled) {
            if (dirtyRef.current) {
                // Auto-save re-enabled with pending local edits - flush them now.
                void pushRef.current();
            }
        } else if (pushDebounceRef.current) {
            // Cancel any scheduled auto push when auto-save is turned off.
            window.clearTimeout(pushDebounceRef.current);
            pushDebounceRef.current = null;
        }
    }, []);

    const registerRemoteApplier = useCallback(
        (fn: (diagram: Diagram) => Promise<void>): void => {
            applierRef.current = fn;
            if (pendingApplyRef.current) {
                const pending = pendingApplyRef.current;
                pendingApplyRef.current = null;
                void applyRemote(pending).then(() => {
                    setPartialState({
                        status: 'synced',
                        lastSyncAt: new Date(),
                        error: null,
                    });
                });
            }
        },
        [applyRemote, setPartialState]
    );

    const wrapWrite = useCallback(
        (fn: (...args: never[]) => Promise<void>) => {
            return async (..._args: never[]): Promise<void> => {
                await fn(..._args);
                notifyLocalChange();
            };
        },
        [notifyLocalChange]
    );

    const wrappedStorage = useMemo<StorageContext>(() => {
        if (!enabled) {
            return rawStorage;
        }

        const wrapped = { ...rawStorage } as StorageContext;
        for (const method of WRITE_METHODS) {
            const original = rawStorage[method] as (
                ...args: never[]
            ) => Promise<void>;
            (wrapped as unknown as Record<string, unknown>)[method] =
                wrapWrite(original);
        }

        return wrapped;
    }, [enabled, rawStorage, wrapWrite]);

    const contextValue = useMemo<SyncContext>(
        () => ({
            enabled,
            config,
            state,
            autoSave,
            setAutoSave,
            saveNow,
            startSync,
            stopSync,
            pushNow: () => pushRef.current(),
            pullNow: () => pullRef.current(),
            fetchRemote,
            takeRemote,
            pushLocal,
            registerRemoteApplier,
        }),
        [
            enabled,
            config,
            state,
            autoSave,
            setAutoSave,
            saveNow,
            startSync,
            stopSync,
            fetchRemote,
            takeRemote,
            pushLocal,
            registerRemoteApplier,
        ]
    );

    return (
        <syncContext.Provider value={contextValue}>
            <storageContext.Provider value={wrappedStorage}>
                {children}
            </storageContext.Provider>
        </syncContext.Provider>
    );
};
