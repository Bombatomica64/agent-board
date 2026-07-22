import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('chat layout styles', () => {
  it('defines component-local form control styling', () => {
    const styles = readFileSync('src/app/chat/chat/chat.scss', 'utf8');

    expect(styles).toMatch(/select,\s*textarea,\s*button\s*\{/);
    expect(styles).toMatch(/background:\s*var\(--surface-2\)/);
    expect(styles).toMatch(/focus-visible/);
  });

  it('bounds and virtualizes the agent conversation rail', () => {
    const styles = readFileSync('src/app/chat/chat/chat.scss', 'utf8');
    const template = readFileSync('src/app/chat/chat/chat.html', 'utf8');

    expect(template).toContain('cdk-virtual-scroll-viewport');
    expect(template).toContain('*cdkVirtualFor');
    expect(styles).toMatch(/\.agent-viewport\s*\{/);
    expect(styles).toMatch(/overflow:\s*hidden/);
  });
});
