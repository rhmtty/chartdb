import { describe, it, expect } from 'vitest';
import { resolveFilePath, resolveGitUrl, withGitCredentials } from '../config';

describe('sync config', () => {
    it('replaces the {diagramId} placeholder in the file path', () => {
        expect(resolveFilePath('diagrams/{diagramId}.json', 'abc-123')).toBe(
            'diagrams/abc-123.json'
        );
    });

    it('leaves paths without a placeholder unchanged', () => {
        expect(resolveFilePath('erd.json', 'abc-123')).toBe('erd.json');
    });

    it('replaces multiple occurrences', () => {
        expect(resolveFilePath('{diagramId}/{diagramId}.json', 'x')).toBe(
            'x/x.json'
        );
    });

    it('prefers an explicit git url', () => {
        expect(
            resolveGitUrl(
                'https://rhmtty@bitbucket.org/team/erds.git',
                'team',
                'erds'
            )
        ).toBe('https://rhmtty@bitbucket.org/team/erds.git');
    });

    it('derives the git url from workspace and repo when unset', () => {
        expect(resolveGitUrl('', 'team', 'erds')).toBe(
            'https://bitbucket.org/team/erds.git'
        );
    });

    it('embeds credentials into a plain git url', () => {
        expect(
            withGitCredentials(
                'https://bitbucket.org/team/erds.git',
                'rhmtty',
                'secret'
            )
        ).toBe('https://rhmtty:secret@bitbucket.org/team/erds.git');
    });

    it('replaces an existing username in the git url', () => {
        expect(
            withGitCredentials(
                'https://old@bitbucket.org/team/erds.git',
                'rhmtty',
                'secret'
            )
        ).toBe('https://rhmtty:secret@bitbucket.org/team/erds.git');
    });

    it('returns the url unchanged when credentials are missing', () => {
        expect(
            withGitCredentials('https://bitbucket.org/team/erds.git', '', '')
        ).toBe('https://bitbucket.org/team/erds.git');
    });

    it('supports the static x-token-auth username for API tokens', () => {
        expect(
            withGitCredentials(
                'https://rhmtty@bitbucket.org/team/erds.git',
                'x-token-auth',
                'apitoken123'
            )
        ).toBe('https://x-token-auth:apitoken123@bitbucket.org/team/erds.git');
    });

    it('URL-encodes an email username in the git url', () => {
        expect(
            withGitCredentials(
                'https://bitbucket.org/team/erds.git',
                'analyst@example.com',
                'secret'
            )
        ).toBe(
            'https://analyst%40example.com:secret@bitbucket.org/team/erds.git'
        );
    });
});
