import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../../src/components/agent/Markdown';

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe('assistant markdown links', () => {
  it("makes the developer's feature-request mailto link clickable", () => {
    const out = html('[Email the developer](mailto:rax@vivaanshahani.com?subject=RAX%20feature%20request%3A%20Parlay%20%28EV%29&body=Hi%2C%0A%0Athanks)');
    expect(out).toContain('href="mailto:rax@vivaanshahani.com?subject=RAX%20feature%20request%3A%20Parlay%20%28EV%29&amp;body=Hi%2C%0A%0Athanks"');
    expect(out).toContain('>Email the developer<');
  });
  it('never links other mailto:, javascript: or look-alike addresses', () => {
    for (const bad of ['mailto:evil@example.com', 'mailto:rax@vivaanshahani.com.evil.com', 'mailto:rax@vivaanshahani.com?bcc=evil@example.com', 'javascript:alert(1)']) {
      expect(html(`[click](${bad})`)).not.toContain('<a ');
    }
  });
});
