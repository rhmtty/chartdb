import { useChartDB } from '@/hooks/use-chartdb';
import { useConfig } from '@/hooks/use-config';
import { useDialog } from '@/hooks/use-dialog';
import { useFullScreenLoader } from '@/hooks/use-full-screen-spinner';
import { useRedoUndoStack } from '@/hooks/use-redo-undo-stack';
import { useStorage } from '@/hooks/use-storage';
import { useSync } from '@/hooks/use-sync';
import type { Diagram } from '@/lib/domain/diagram';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

export const useDiagramLoader = () => {
    const [initialDiagram, setInitialDiagram] = useState<Diagram | undefined>();
    const { diagramId } = useParams<{ diagramId: string }>();
    const { config } = useConfig();
    const { loadDiagram, updateDiagramData, currentDiagram } = useChartDB();
    const { resetRedoStack, resetUndoStack } = useRedoUndoStack();
    const { showLoader, hideLoader } = useFullScreenLoader();
    const { openCreateDiagramDialog, openOpenDiagramDialog } = useDialog();
    const navigate = useNavigate();
    const { listDiagrams } = useStorage();
    const sync = useSync();

    const currentDiagramLoadingRef = useRef<string | undefined>(undefined);
    const syncRef = useRef(sync);
    syncRef.current = sync;

    useEffect(() => {
        if (!config) {
            return;
        }

        if (currentDiagram?.id === diagramId) {
            return;
        }

        const loadDefaultDiagram = async () => {
            if (diagramId) {
                setInitialDiagram(undefined);
                showLoader();
                resetRedoStack();
                resetUndoStack();

                let remote: Diagram | undefined;
                if (syncRef.current.enabled) {
                    try {
                        remote = await syncRef.current.fetchRemote(diagramId);
                    } catch {
                        // Fall back to the local copy when the remote is unreachable.
                        remote = undefined;
                    }
                }

                const local = await loadDiagram(diagramId);

                let diagram: Diagram | undefined;
                if (remote && !local) {
                    // Fresh machine: bootstrap from the shared Bitbucket file.
                    await updateDiagramData(remote, {
                        forceUpdateStorage: true,
                    });
                    diagram = remote;
                } else if (remote && local) {
                    // Prefer the newer version when both exist.
                    diagram =
                        remote.updatedAt > local.updatedAt ? remote : local;
                    if (diagram === remote) {
                        await updateDiagramData(remote, {
                            forceUpdateStorage: true,
                        });
                    }
                } else {
                    diagram = local;
                }

                if (!diagram) {
                    openOpenDiagramDialog({ canClose: false });
                    hideLoader();
                    return;
                }

                setInitialDiagram(diagram);
                hideLoader();

                if (syncRef.current.enabled) {
                    await syncRef.current.startSync(diagramId);
                }

                return;
            } else if (!diagramId && config.defaultDiagramId) {
                const diagram = await loadDiagram(config.defaultDiagramId);
                if (diagram) {
                    navigate(`/diagrams/${config.defaultDiagramId}`);

                    return;
                }
            }
            const diagrams = await listDiagrams();

            if (diagrams.length > 0) {
                openOpenDiagramDialog({ canClose: false });
            } else {
                openCreateDiagramDialog();
            }
        };

        if (
            currentDiagramLoadingRef.current === (diagramId ?? '') &&
            currentDiagramLoadingRef.current !== undefined
        ) {
            return;
        }
        currentDiagramLoadingRef.current = diagramId ?? '';

        loadDefaultDiagram();
    }, [
        diagramId,
        openCreateDiagramDialog,
        config,
        navigate,
        listDiagrams,
        loadDiagram,
        updateDiagramData,
        resetRedoStack,
        resetUndoStack,
        hideLoader,
        showLoader,
        currentDiagram?.id,
        openOpenDiagramDialog,
    ]);

    useEffect(() => {
        return () => {
            syncRef.current.stopSync();
        };
    }, []);

    return { initialDiagram };
};
