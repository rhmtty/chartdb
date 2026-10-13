import { describe, it, expect } from 'vitest';
import { diagramFromSyncJson, diagramToSyncJson } from '../serialize';
import type { Diagram } from '@/lib/domain/diagram';
import { DatabaseType } from '@/lib/domain/database-type';
import { DBCustomTypeKind } from '@/lib/domain/db-custom-type';

const createDiagram = (): Diagram => ({
    id: 'diagram-1',
    name: 'Analyst ERD',
    databaseType: DatabaseType.POSTGRESQL,
    databaseEdition: undefined,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-02T03:04:05.000Z'),
    tables: [
        {
            id: 'table-1',
            name: 'users',
            schema: 'public',
            x: 10,
            y: 20,
            fields: [
                {
                    id: 'field-1',
                    name: 'id',
                    type: { id: 'bigint', name: 'bigint' },
                    primaryKey: true,
                    unique: true,
                    nullable: false,
                    createdAt: 1700000000000,
                },
            ],
            indexes: [],
            checkConstraints: [],
            color: '#aabbcc',
            isView: false,
            createdAt: 1700000000000,
        },
    ],
    relationships: [
        {
            id: 'rel-1',
            name: 'users_orders_fk',
            sourceSchema: 'public',
            sourceTableId: 'table-1',
            targetSchema: 'public',
            targetTableId: 'table-2',
            sourceFieldId: 'field-1',
            targetFieldId: 'field-2',
            sourceCardinality: 'one',
            targetCardinality: 'many',
            createdAt: 1700000000001,
        },
    ],
    dependencies: [
        {
            id: 'dep-1',
            schema: 'public',
            tableId: 'table-1',
            dependentSchema: 'public',
            dependentTableId: 'table-2',
            createdAt: 1700000000002,
        },
    ],
    areas: [
        {
            id: 'area-1',
            name: 'Core',
            x: 0,
            y: 0,
            width: 400,
            height: 300,
            color: '#ff0000',
        },
    ],
    customTypes: [
        {
            id: 'type-1',
            schema: 'public',
            name: 'mood',
            kind: DBCustomTypeKind.enum,
            values: ['sad', 'ok', 'happy'],
        },
    ],
    notes: [
        {
            id: 'note-1',
            content: 'review before release',
            x: 5,
            y: 6,
            width: 200,
            height: 100,
            color: '#ffe374',
        },
    ],
});

describe('sync serialization', () => {
    it('round-trips a diagram preserving IDs and timestamps', () => {
        const diagram = createDiagram();
        const json = diagramToSyncJson(diagram);
        const restored = diagramFromSyncJson(json);

        expect(restored.id).toBe('diagram-1');
        expect(restored.name).toBe('Analyst ERD');
        expect(restored.databaseType).toBe(DatabaseType.POSTGRESQL);
        expect(restored.createdAt.toISOString()).toBe(
            '2026-01-01T00:00:00.000Z'
        );
        expect(restored.updatedAt.toISOString()).toBe(
            '2026-02-02T03:04:05.000Z'
        );

        expect(restored.tables?.[0].id).toBe('table-1');
        expect(restored.tables?.[0].fields[0].id).toBe('field-1');
        expect(restored.relationships?.[0].id).toBe('rel-1');
        expect(restored.dependencies?.[0].id).toBe('dep-1');
        expect(restored.areas?.[0].id).toBe('area-1');
        expect(restored.customTypes?.[0].id).toBe('type-1');
        expect(restored.notes?.[0].id).toBe('note-1');
    });

    it('rejects JSON with an unsupported version', () => {
        const payload = { version: 999, diagram: createDiagram() };
        expect(() => diagramFromSyncJson(JSON.stringify(payload))).toThrowError(
            'Unsupported or missing sync file version'
        );
    });

    it('rejects JSON without a diagram', () => {
        expect(() =>
            diagramFromSyncJson(JSON.stringify({ version: 1 }))
        ).toThrowError('does not contain a diagram');
    });

    it('falls back to now for missing timestamps', () => {
        const diagram = createDiagram();
        const payload = JSON.parse(diagramToSyncJson(diagram)) as {
            diagram: { createdAt?: unknown; updatedAt?: unknown };
        };
        payload.diagram.createdAt = undefined;
        payload.diagram.updatedAt = undefined;

        const restored = diagramFromSyncJson(JSON.stringify(payload));
        expect(restored.createdAt.getTime()).not.toBeNaN();
        expect(restored.updatedAt.getTime()).not.toBeNaN();
    });
});
