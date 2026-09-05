"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normaliseMath } from "@/lib/math";

export interface CodePreview {
  code: string;
  lang: string;
  title: string;
}

const PREVIEWABLE = new Set(["html", "svg", "xml"]);

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

const Markdown = memo(function Markdown({
  content,
  onShowArtifact,
}: {
  content: string;
  onShowArtifact: (a: CodePreview) => void;
}) {
  return (
    <div className="prose-chat text-[15px]">
      <ReactMarkdown
        // singleDollarTextMath: false — in this app a lone $ is a currency sign
        // far more often than a maths delimiter. With it on, '$16.67 million ... to
        // safely draw $500,000' had everything between the two dollars swallowed
        // as a formula. Maths needs $…$; money is left alone.
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        // strict: false so one malformed formula renders as its own source
        // instead of throwing away the whole reply around it.
        rehypePlugins={[rehypeHighlight, [rehypeKatex, { strict: false, throwOnError: false }]]}
        components={{
          pre({ children }) {
            const codeEl = Array.isArray(children) ? children[0] : children;
            const className =
              (codeEl as { props?: { className?: string } })?.props?.className ?? "";
            const lang = className.match(/language-([\w-]+)/)?.[1] ?? "";
            const code = extractText(children).replace(/\n$/, "");
            return (
              <CodeBlock lang={lang} code={code} onShowArtifact={onShowArtifact}>
                {children}
              </CodeBlock>
            );
          },
        }}
      >
        {normaliseMath(content)}
      </ReactMarkdown>
    </div>
  );
});

export default Markdown;

function CodeBlock({
  lang,
  code,
  onShowArtifact,
  children,
}: {
  lang: string;
  code: string;
  onShowArtifact: (a: CodePreview) => void;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const previewable = PREVIEWABLE.has(lang.toLowerCase());

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="flex items-center justify-between bg-surface-2 px-3 py-1 text-xs text-ink-muted">
        <span>{lang || "code"}</span>
        <div className="flex gap-3">
          {previewable && (
            <button
              onClick={() => onShowArtifact({ code, lang, title: `${lang} artifact` })}
              className="hover:text-ink"
            >
              ▶ Preview
            </button>
          )}
          <button
            onClick={() => {
              navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="hover:text-ink"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
      </div>
      <pre className="!mt-0 !rounded-none">{children}</pre>
    </div>
  );
}
