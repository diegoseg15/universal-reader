import { Fragment, type ReactNode } from "react";

import type { EpubInlineNode, EpubTextBlock } from "./EpubSource";

type EpubRichTextProps = {
  blocks: EpubTextBlock[];
};

function renderInline(nodes: EpubInlineNode[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.kind === "text") {
      return <Fragment key={index}>{node.text}</Fragment>;
    }

    if (node.kind === "break") {
      return <br key={index} />;
    }

    const children = renderInline(node.children);

    switch (node.kind) {
      case "strong":
        return <strong key={index}>{children}</strong>;

      case "emphasis":
        return <em key={index}>{children}</em>;

      case "code":
        return (
          <code
            key={index}
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.9em",
              overflowWrap: "anywhere",
            }}
          >
            {children}
          </code>
        );

      case "sup":
        return <sup key={index}>{children}</sup>;

      case "sub":
        return <sub key={index}>{children}</sub>;
    }
  });
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

function renderBlock(
  block: EpubTextBlock,
  index: number,
  insideList = false,
): ReactNode {
  switch (block.kind) {
    case "heading": {
      const level = Math.max(1, Math.min(6, block.level));

      const Heading = HEADING_TAGS[level - 1] ?? "h2";

      return (
        <Heading
          key={index}
          style={{
            margin: index === 0 ? "0.2em 0 0.55em" : "1.2em 0 0.55em",
            fontSize: `${Math.max(1.1, 1.7 - (level - 1) * 0.12)}em`,
            lineHeight: 1.3,
            breakAfter: "avoid",
            overflowWrap: "anywhere",
          }}
        >
          {renderInline(block.content)}
        </Heading>
      );
    }

    case "paragraph":
      return (
        <p
          key={index}
          style={{
            margin: insideList ? "0 0 0.35em" : "0 0 1em",
          }}
        >
          {renderInline(block.content)}
        </p>
      );

    case "quote":
      return (
        <blockquote
          key={index}
          style={{
            margin: "1em 0",
            paddingInlineStart: "1em",
            borderInlineStart: "3px solid var(--reader-border)",
            fontStyle: "italic",
          }}
        >
          {block.blocks.map((child, childIndex) =>
            renderBlock(child, childIndex),
          )}
        </blockquote>
      );

    case "list": {
      const List = block.ordered ? "ol" : "ul";

      return (
        <List
          key={index}
          style={{
            margin: "0 0 1em",
            paddingInlineStart: "1.5em",
          }}
        >
          {block.items.map((item, itemIndex) => (
            <li
              key={itemIndex}
              style={{
                marginBottom: "0.4em",
              }}
            >
              {item.map((child, childIndex) =>
                renderBlock(child, childIndex, true),
              )}
            </li>
          ))}
        </List>
      );
    }

    case "pre":
      return (
        <pre
          key={index}
          style={{
            margin: "1em 0",
            padding: "0.75em",
            borderRadius: "6px",
            background: "rgba(44, 59, 77, 0.06)",
            fontFamily: "ui-monospace, monospace",
            fontSize: "0.85em",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {block.text}
        </pre>
      );

    case "rule":
      return (
        <hr
          key={index}
          style={{
            margin: "1.5em 0",
            border: 0,
            borderTop: "1px solid var(--reader-border)",
          }}
        />
      );
  }
}

export function EpubRichText({ blocks }: EpubRichTextProps) {
  return <>{blocks.map((block, index) => renderBlock(block, index))}</>;
}
