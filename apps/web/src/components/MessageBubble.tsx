import { useState } from "react";
import { formatBytes } from "../format.js";
import type { Attachment, Message } from "../types.js";
import { IconChevron, IconPaperclip } from "./Icons.js";

function Attachments({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="attachments">
      {attachments.map((attachment) =>
        attachment.kind === "image" && attachment.url ? (
          <a
            key={attachment.id}
            className="attachment-img"
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
          >
            <img src={attachment.url} alt={attachment.name} loading="lazy" />
          </a>
        ) : (
          <a
            key={attachment.id}
            className="attachment-chip"
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
          >
            <IconPaperclip size={14} />
            <span>{attachment.name}</span>
            <span className="attachment-size">{formatBytes(attachment.size)}</span>
          </a>
        )
      )}
    </div>
  );
}

function ToolMessage({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  const body = message.content;
  const preview =
    body.length > 240 ? `${body.slice(0, 240)}…` : body;
  return (
    <div className="tool-msg">
      <button
        className="tool-msg-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <IconChevron size={12} className={`tool-chevron ${open ? "open" : ""}`} />
        <span className="tool-msg-name">{message.toolName ?? message.toolCallId ?? "tool"}</span>
        <span className="tool-msg-preview">{open ? body : preview || "done"}</span>
      </button>
    </div>
  );
}

export function MessageBubble({ message }: { message: Message }) {
  if (message.role === "tool") return <ToolMessage message={message} />;
  const isUser = message.role === "user";
  return (
    <div className={`bubble-row ${isUser ? "user" : "assistant"}`}>
      <div className={`bubble ${isUser ? "user-bubble" : "assistant-bubble glass"}`}>
        <Attachments attachments={message.attachments} />
        {message.content && <p className="bubble-text">{message.content}</p>}
      </div>
    </div>
  );
}
