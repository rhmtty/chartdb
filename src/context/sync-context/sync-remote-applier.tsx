import { useEffect, type FC } from 'react';
import { useSync } from '@/hooks/use-sync';
import { useChartDB } from '@/hooks/use-chartdb';

/**
 * Registers the ChartDB diagram applier with the sync engine. Rendered inside
 * the ChartDB provider so it can apply remote diagrams into live editor state.
 */
export const SyncRemoteApplier: FC = () => {
    const { registerRemoteApplier } = useSync();
    const { updateDiagramData } = useChartDB();

    useEffect(() => {
        registerRemoteApplier(async (diagram) => {
            await updateDiagramData(diagram, { forceUpdateStorage: true });
        });
    }, [registerRemoteApplier, updateDiagramData]);

    return null;
};
