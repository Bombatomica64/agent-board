import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('board layout styles', () => {
  it('does not offset sticky column headers inside the board scroll container', () => {
    const styles = readFileSync('src/app/board/board.scss', 'utf8');
    const columnHeader = styles.match(/\.column-header\s*\{([\s\S]*?)\n\}/)?.[1];

    expect(columnHeader).toBeDefined();
    expect(columnHeader).toMatch(/\btop:\s*0\s*;/);
  });
});
