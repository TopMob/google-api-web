"use client";

import React, { useState } from "react";
import { Check, Copy, ChevronDown, ChevronRight } from "lucide-react";

interface MarkdownContentProps {
  content: string;
  thinkingLabel: string;
  copyLabel: string;
  copiedLabel: string;
}

interface ParsedBlock {
  type: "text" | "code" | "think";
  content: string;
  lang?: string;
}

function splitThinkingAndCode(raw: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const remaining = raw;

  // Extract <think>...</think> (including unclosed trailing <think> during streaming)
  const thinkRegex = /<think>([\s\S]*?)(?:<\/think>|$)/gi;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  const segments: Array<{ kind: "think" | "plain"; text: string }> = [];
  while ((match = thinkRegex.exec(remaining)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ kind: "plain", text: remaining.slice(lastIdx, match.index) });
    }
    if (match[1].trim()) {
      segments.push({ kind: "think", text: match[1].trim() });
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < remaining.length) {
    segments.push({ kind: "plain", text: remaining.slice(lastIdx) });
  }

  const codeRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  for (const seg of segments) {
    if (seg.kind === "think") {
      blocks.push({ type: "think", content: seg.text });
      continue;
    }

    let cLast = 0;
    let cMatch: RegExpExecArray | null;
    codeRegex.lastIndex = 0;
    while ((cMatch = codeRegex.exec(seg.text)) !== null) {
      if (cMatch.index > cLast) {
        const txt = seg.text.slice(cLast, cMatch.index);
        if (txt.trim()) blocks.push({ type: "text", content: txt });
      }
      blocks.push({ type: "code", lang: cMatch[1] || "text", content: cMatch[2].replace(/\n$/, "") });
      cLast = cMatch.index + cMatch[0].length;
    }
    if (cLast < seg.text.length) {
      const txt = seg.text.slice(cLast);
      if (txt.trim()) blocks.push({ type: "text", content: txt });
    }
  }

  return blocks;
}

function renderInlineFormatting(text: string): React.ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return tokens.map((tok, i) => {
    if (tok.startsWith("`") && tok.endsWith("`") && tok.length >= 2) {
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-[#171a22] border border-[#252a38] text-[#9ec2ff] font-mono text-[12px]"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    if (tok.startsWith("**") && tok.endsWith("**") && tok.length >= 4) {
      return (
        <strong key={i} className="font-semibold text-[#eceef4]">
          {tok.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={i}>{tok}</React.Fragment>;
  });
}

function highlightCodeLine(line: string): React.ReactNode[] {
  const tokenRegex =
    /(\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|import|export|from|default|async|await|if|else|for|of|in|while|try|catch|throw|new|class|extends|interface|type|enum|def|elif|pass|with|as|raise|yield|lambda|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|JOIN|true|false|null|undefined|None|True|False)\b|\b\d+(?:\.\d+)?\b)/g;

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<React.Fragment key={keyIdx++}>{line.slice(lastIndex, match.index)}</React.Fragment>);
    }

    const tok = match[0];
    let cls = "text-[#d8dce8]";
    if (tok.startsWith("//") || tok.startsWith("#")) {
      cls = "text-[#6b7394] italic";
    } else if (tok.startsWith('"') || tok.startsWith("'") || tok.startsWith("`")) {
      cls = "text-[#7ee787]";
    } else if (/^\d/.test(tok)) {
      cls = "text-[#f78c6c]";
    } else {
      cls = "text-[#c792ea]";
    }

    nodes.push(
      <span key={keyIdx++} className={cls}>
        {tok}
      </span>
    );
    lastIndex = match.index + tok.length;
  }

  if (lastIndex < line.length) {
    nodes.push(<React.Fragment key={keyIdx++}>{line.slice(lastIndex)}</React.Fragment>);
  }

  return nodes.length > 0 ? nodes : [<React.Fragment key={0}>{line}</React.Fragment>];
}

function CodeBlock({
  code,
  lang,
  copyLabel,
  copiedLabel
}: {
  code: string;
  lang: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const lines = code.split("\n");

  return (
    <div className="my-2.5 rounded-lg border border-[#222633] bg-[#0b0d12] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#111319] border-b border-[#222633] text-[11px] text-[#8e95a8] font-mono">
        <span>{lang || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-[#8e95a8] hover:text-[#eceef4] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f8cff] rounded px-1.5 py-0.5"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          <span>{copied ? copiedLabel : copyLabel}</span>
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-[12.5px] leading-relaxed font-mono text-[#d8dce8] custom-scrollbar">
        <code>
          {lines.map((line, i) => (
            <React.Fragment key={i}>
              {highlightCodeLine(line)}
              {i < lines.length - 1 ? "\n" : null}
            </React.Fragment>
          ))}
        </code>
      </pre>
    </div>
  );
}

function ThinkBlock({ content, label }: { content: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 rounded-lg border border-[#222633] bg-[#111319]/70 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-medium text-[#8e95a8] hover:text-[#eceef4] transition-colors"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{label}</span>
      </button>
      {open ? (
        <div className="px-3 pb-3 pt-1 border-t border-[#222633]/60 text-xs leading-relaxed text-[#8e95a8] whitespace-pre-wrap font-mono">
          {content}
        </div>
      ) : null}
    </div>
  );
}

export default function MarkdownContent({ content, thinkingLabel, copyLabel, copiedLabel }: MarkdownContentProps) {
  const blocks = splitThinkingAndCode(content);

  if (blocks.length === 0) {
    return <span className="whitespace-pre-wrap">{content}</span>;
  }

  return (
    <div className="space-y-2 text-[14px] leading-relaxed text-[#d9dde8]">
      {blocks.map((block, idx) => {
        if (block.type === "think") {
          return <ThinkBlock key={idx} content={block.content} label={thinkingLabel} />;
        }
        if (block.type === "code") {
          return (
            <CodeBlock
              key={idx}
              code={block.content}
              lang={block.lang || "code"}
              copyLabel={copyLabel}
              copiedLabel={copiedLabel}
            />
          );
        }

        const lines = block.content.split("\n");
        return (
          <div key={idx} className="space-y-1.5">
            {lines.map((line, lIdx) => {
              const trimmed = line.trim();
              if (!trimmed) return <div key={lIdx} className="h-1" />;

              if (trimmed.startsWith("### ")) {
                return (
                  <h4 key={lIdx} className="text-sm font-semibold text-[#eceef4] pt-1.5">
                    {renderInlineFormatting(trimmed.slice(4))}
                  </h4>
                );
              }
              if (trimmed.startsWith("## ")) {
                return (
                  <h3 key={lIdx} className="text-base font-semibold text-[#eceef4] pt-2">
                    {renderInlineFormatting(trimmed.slice(3))}
                  </h3>
                );
              }
              if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                return (
                  <div key={lIdx} className="flex items-start gap-2 pl-2">
                    <span className="text-[#4f8cff] mt-1.5 text-[10px]">•</span>
                    <span className="flex-1">{renderInlineFormatting(trimmed.slice(2))}</span>
                  </div>
                );
              }
              return (
                <p key={lIdx} className="whitespace-pre-wrap">
                  {renderInlineFormatting(line)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
