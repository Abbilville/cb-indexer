'use client';

import React, { useState } from 'react';
import { Copy, Check, Terminal } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  if (!content) return null;

  // Split content into blocks (code blocks vs regular markdown blocks)
  const blocks = parseBlocks(content);

  return (
    <div className="space-y-2 text-xs leading-relaxed text-gray-200">
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return (
            <CodeBlock
              key={`code-${index}`}
              language={block.language}
              code={block.content}
            />
          );
        }
        if (block.type === 'table') {
          return (
            <TableBlock
              key={`table-${index}`}
              rows={block.rows}
            />
          );
        }
        return (
          <TextBlock
            key={`text-${index}`}
            content={block.content}
          />
        );
      })}
    </div>
  );
}

// --- Block Parser ---

type Block =
  | { type: 'code'; language: string; content: string }
  | { type: 'table'; rows: string[][] }
  | { type: 'text'; content: string };

function parseBlocks(raw: string): Block[] {
  const blocks: Block[] = [];
  const lines = raw.split('\n');
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let textLines: string[] = [];
  let inTable = false;
  let tableRows: string[][] = [];

  const flushText = () => {
    if (textLines.length > 0) {
      const joined = textLines.join('\n').trim();
      if (joined) {
        blocks.push({ type: 'text', content: joined });
      }
      textLines = [];
    }
  };

  const flushTable = () => {
    if (tableRows.length > 0) {
      blocks.push({ type: 'table', rows: tableRows });
      tableRows = [];
    }
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for fenced code block toggle
    const codeMatch = line.match(/^```(\w+)?/);
    if (codeMatch && !inCode) {
      flushText();
      flushTable();
      inCode = true;
      codeLang = codeMatch[1] || 'text';
      codeLines = [];
      continue;
    } else if (line.startsWith('```') && inCode) {
      inCode = false;
      blocks.push({
        type: 'code',
        language: codeLang,
        content: codeLines.join('\n'),
      });
      codeLines = [];
      codeLang = '';
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    // Check for markdown table line (e.g. | col | col |)
    const isTableRow = line.trim().startsWith('|') && line.trim().endsWith('|');
    if (isTableRow) {
      // Check if it's separator row like | --- | --- |
      const isSeparator = /^\|(\s*:?-+:?\s*\|)+$/.test(line.trim());
      if (isSeparator) {
        // Skip separator row in data rows
        continue;
      }
      flushText();
      inTable = true;
      const cells = line
        .trim()
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    textLines.push(line);
  }

  // Handle unclosed code block during streaming
  if (inCode) {
    blocks.push({
      type: 'code',
      language: codeLang,
      content: codeLines.join('\n'),
    });
  }

  flushTable();
  flushText();

  return blocks;
}

// --- Code Block Component with Copy Action ---

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="my-2.5 rounded-xl bg-black/70 border border-white/10 overflow-hidden shadow-md">
      {/* Code Header */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-white/5 border-b border-white/10 text-[10.5px] text-gray-400 font-mono">
        <div className="flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-gray-300 font-semibold">{language || 'code'}</span>
        </div>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-gray-400 hover:text-white transition-colors p-0.5 rounded"
          title="Copy Code"
        >
          {isCopied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Content */}
      <pre className="p-3.5 overflow-x-auto text-[11px] font-mono leading-relaxed text-blue-200 selection:bg-blue-600/40">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// --- Table Component ---

function TableBlock({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return null;
  const [header, ...body] = rows;

  return (
    <div className="my-2.5 overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-left text-[11px] border-collapse bg-black/40">
        {header && (
          <thead>
            <tr className="bg-white/5 border-b border-white/10 font-semibold text-gray-200">
              {header.map((cell, idx) => (
                <th key={idx} className="p-2.5 font-bold">
                  {renderInline(cell)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, rIdx) => (
            <tr
              key={rIdx}
              className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors"
            >
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="p-2.5 text-gray-300">
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Text Block Parser (Headers, Lists, Blockquotes, Paragraphs) ---

function TextBlock({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    // Headers
    if (trimmed.startsWith('#### ')) {
      elements.push(
        <h4 key={i} className="text-xs font-bold text-gray-200 mt-2 mb-1">
          {renderInline(trimmed.slice(5))}
        </h4>
      );
      continue;
    }
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="text-xs font-bold text-blue-300 mt-3 mb-1 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
          <span>{renderInline(trimmed.slice(4))}</span>
        </h3>
      );
      continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="text-sm font-bold text-white mt-3.5 mb-1.5 pb-1 border-b border-white/10">
          {renderInline(trimmed.slice(3))}
        </h2>
      );
      continue;
    }
    if (trimmed.startsWith('# ')) {
      elements.push(
        <h1 key={i} className="text-sm font-extrabold text-white mt-4 mb-2 pb-1 border-b border-white/15">
          {renderInline(trimmed.slice(2))}
        </h1>
      );
      continue;
    }

    // Horizontal Rule
    if (/^(\*\*\*|---|___)$/.test(trimmed)) {
      elements.push(<hr key={i} className="my-3 border-white/10" />);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      elements.push(
        <blockquote
          key={i}
          className="border-l-2 border-blue-500/60 pl-3 py-1 my-1.5 bg-blue-500/5 text-gray-300 italic rounded-r-lg"
        >
          {renderInline(trimmed.slice(2))}
        </blockquote>
      );
      continue;
    }

    // Unordered list item (- or *)
    const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bulletMatch) {
      const indent = bulletMatch[1].length;
      elements.push(
        <div
          key={i}
          className="flex items-start gap-2 my-1"
          style={{ paddingLeft: `${Math.min(indent * 8, 32)}px` }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
          <span className="text-gray-300 leading-relaxed">{renderInline(bulletMatch[2])}</span>
        </div>
      );
      continue;
    }

    // Ordered list item (1. )
    const numberedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      const indent = numberedMatch[1].length;
      elements.push(
        <div
          key={i}
          className="flex items-start gap-2 my-1"
          style={{ paddingLeft: `${Math.min(indent * 8, 32)}px` }}
        >
          <span className="text-[10px] font-mono font-bold text-blue-400 min-w-[14px] text-right mt-0.5">
            {numberedMatch[2]}.
          </span>
          <span className="text-gray-300 leading-relaxed">{renderInline(numberedMatch[3])}</span>
        </div>
      );
      continue;
    }

    // Standard Paragraph
    elements.push(
      <p key={i} className="my-1 text-gray-300 leading-relaxed">
        {renderInline(line)}
      </p>
    );
  }

  return <div className="space-y-1">{elements}</div>;
}

// --- Inline Formatter (Bold, Italic, Code, Links) ---

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Regex to match:
  // 1. Inline code: `code`
  // 2. Bold: **text** or __text__
  // 3. Italic: *text* or _text_
  // 4. Strikethrough: ~~text~~
  // 5. Link: [label](url)
  const regex = /(`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const matchIndex = match.index;
    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex));
    }

    const token = match[0];

    // Inline Code: `code`
    if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={matchIndex}
          className="px-1.5 py-0.5 bg-black/60 border border-white/10 rounded-md font-mono text-[11px] text-blue-300"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    // Bold + Italic: ***text***
    else if (token.startsWith('***') && token.endsWith('***')) {
      parts.push(
        <strong key={matchIndex} className="font-bold italic text-white">
          {token.slice(3, -3)}
        </strong>
      );
    }
    // Bold: **text** or __text__
    else if (
      (token.startsWith('**') && token.endsWith('**')) ||
      (token.startsWith('__') && token.endsWith('__'))
    ) {
      parts.push(
        <strong key={matchIndex} className="font-bold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    }
    // Italic: *text* or _text_
    else if (
      (token.startsWith('*') && token.endsWith('*')) ||
      (token.startsWith('_') && token.endsWith('_'))
    ) {
      parts.push(
        <em key={matchIndex} className="italic text-gray-200">
          {token.slice(1, -1)}
        </em>
      );
    }
    // Strikethrough: ~~text~~
    else if (token.startsWith('~~') && token.endsWith('~~')) {
      parts.push(
        <del key={matchIndex} className="line-through text-gray-400">
          {token.slice(2, -2)}
        </del>
      );
    }
    // Link: [label](url)
    else if (token.startsWith('[') && token.includes('](')) {
      const closeBracket = token.indexOf('](');
      const label = token.slice(1, closeBracket);
      const url = token.slice(closeBracket + 2, -1);
      parts.push(
        <a
          key={matchIndex}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors inline-flex items-center gap-0.5"
        >
          <span>{label}</span>
        </a>
      );
    } else {
      parts.push(token);
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}
