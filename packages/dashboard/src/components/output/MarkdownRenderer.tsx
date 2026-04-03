import { useMemo } from 'react';

interface MarkdownRendererProps {
  content: string;
}

/**
 * Lightweight Markdown renderer — no dependencies.
 * Handles: headings, bold, italic, code blocks, inline code, lists, links, horizontal rules.
 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div className="markdown-output space-y-2">
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

// ── Types ──

type BlockNode =
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; lang: string; content: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'hr' }
  | { type: 'blockquote'; text: string };

// ── Parser ──

function parseBlocks(md: string): BlockNode[] {
  const lines = md.split('\n');
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: 'code', lang, content: codeLines.join('\n') });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('> ')) {
        quoteLines.push(lines[i].trimStart().slice(2));
        i++;
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join('\n') });
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s/, ''));
        i++;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s/, ''));
        i++;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].trimStart().startsWith('#') && !lines[i].trimStart().startsWith('```') && !lines[i].trimStart().startsWith('> ') && !/^\s*[-*+]\s/.test(lines[i]) && !/^\s*\d+[.)]\s/.test(lines[i]) && !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim())) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
    }
  }

  return blocks;
}

// ── Renderers ──

function Block({ block }: { block: BlockNode }) {
  switch (block.type) {
    case 'heading':
      return <Heading level={block.level} text={block.text} />;
    case 'code':
      return <CodeBlock lang={block.lang} content={block.content} />;
    case 'paragraph':
      return <Paragraph text={block.text} />;
    case 'list':
      return <List ordered={block.ordered} items={block.items} />;
    case 'hr':
      return <div className="my-2" style={{ borderTop: '1px solid var(--border-muted)' }} />;
    case 'blockquote':
      return <Blockquote text={block.text} />;
  }
}

function Heading({ level, text }: { level: number; text: string }) {
  const sizes: Record<number, string> = {
    1: 'text-base font-bold mt-3 mb-1',
    2: 'text-sm font-bold mt-2.5 mb-1',
    3: 'text-xs font-bold mt-2 mb-0.5',
    4: 'text-xs font-semibold mt-1.5 mb-0.5',
    5: 'text-xs font-medium mt-1',
    6: 'text-xs font-medium mt-1',
  };
  return (
    <div className={sizes[level] || sizes[3]} style={{ color: 'var(--text-primary)' }}>
      <InlineMarkdown text={text} />
    </div>
  );
}

function CodeBlock({ lang, content }: { lang: string; content: string }) {
  return (
    <div
      className="rounded-md overflow-hidden text-[11px] font-code"
      style={{ border: '1px solid var(--border-muted)' }}
    >
      {lang && (
        <div
          className="px-3 py-1 text-[9px] uppercase tracking-wider"
          style={{ backgroundColor: 'var(--bg-overlay)', color: 'var(--text-disabled)', borderBottom: '1px solid var(--border-muted)' }}
        >
          {lang}
        </div>
      )}
      <pre
        className="px-3 py-2 overflow-x-auto leading-relaxed whitespace-pre"
        style={{ backgroundColor: 'var(--bg-inset)', color: 'var(--text-primary)' }}
      >
        {content}
      </pre>
    </div>
  );
}

function Paragraph({ text }: { text: string }) {
  return (
    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
      <InlineMarkdown text={text} />
    </p>
  );
}

function List({ ordered, items }: { ordered: boolean; items: string[] }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={`text-xs leading-relaxed pl-4 space-y-0.5 ${ordered ? 'list-decimal' : 'list-disc'}`} style={{ color: 'var(--text-primary)' }}>
      {items.map((item, i) => (
        <li key={i}><InlineMarkdown text={item} /></li>
      ))}
    </Tag>
  );
}

function Blockquote({ text }: { text: string }) {
  return (
    <div
      className="text-xs leading-relaxed pl-3 py-1"
      style={{ borderLeft: '2px solid var(--border-default)', color: 'var(--text-secondary)' }}
    >
      <InlineMarkdown text={text} />
    </div>
  );
}

// ── Inline markdown ──

function InlineMarkdown({ text }: { text: string }) {
  const parts = useMemo(() => parseInline(text), [text]);
  return <>{parts.map((part, i) => <InlinePart key={i} part={part} />)}</>;
}

type InlinePart =
  | { type: 'text'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'code'; content: string }
  | { type: 'link'; text: string; href: string };

function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  // Match: **bold**, *italic*, `code`, [text](url)
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+?)`)|(\[([^\]]+?)\]\(([^)]+?)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    if (match[1]) {
      parts.push({ type: 'bold', content: match[2] });
    } else if (match[3]) {
      parts.push({ type: 'italic', content: match[4] });
    } else if (match[5]) {
      parts.push({ type: 'code', content: match[6] });
    } else if (match[7]) {
      parts.push({ type: 'link', text: match[8], href: match[9] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', content: text });
  }

  return parts;
}

function InlinePart({ part }: { part: InlinePart }) {
  switch (part.type) {
    case 'text':
      return <>{part.content}</>;
    case 'bold':
      return <strong style={{ color: 'var(--text-primary)' }}>{part.content}</strong>;
    case 'italic':
      return <em style={{ color: 'var(--text-secondary)' }}>{part.content}</em>;
    case 'code':
      return (
        <code
          className="text-[11px] font-code px-1 py-0.5 rounded"
          style={{ backgroundColor: 'var(--bg-overlay)', color: 'var(--accent)' }}
        >
          {part.content}
        </code>
      );
    case 'link':
      return (
        <span style={{ color: 'var(--text-link)' }} className="underline underline-offset-2">
          {part.text}
        </span>
      );
  }
}
