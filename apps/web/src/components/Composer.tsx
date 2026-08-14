import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { t } from "../i18n.js";
import { useStore } from "../store.js";
import type { AttachmentKind } from "../types.js";
import { IconMic, IconPaperclip, IconSend, IconX } from "./Icons.js";

interface PendingAttachment {
  attachmentId: string;
  kind: AttachmentKind;
  name: string;
  url?: string;
  size: number;
}

interface Props {
  conversationId: string;
  busy: boolean;
}

export function Composer({ conversationId, busy }: Props) {
  const sendMessage = useStore((s) => s.sendMessage);
  const uploadFile = useStore((s) => s.uploadFile);
  const lang = useStore((s) => s.lang);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSend = !busy && (text.trim().length > 0 || pending.length > 0);

  const autogrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  };

  const resetHeight = () => {
    const el = textareaRef.current;
    if (el) el.style.height = "auto";
  };

  const submit = async () => {
    const content = text.trim();
    if (busy) return;
    if (!content && pending.length === 0) return;
    const currentPending = [...pending];
    setError(null);
    try {
      setText("");
      setPending([]);
      resetHeight();
      await sendMessage(
        conversationId,
        content,
        currentPending.map((p) => ({ attachmentId: p.attachmentId }))
      );
    } catch (err) {
      setText(content);
      setPending(currentPending);
      setError(err instanceof Error ? err.message : "send failed");
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        setError(`File "${file.name}" exceeds the maximum limit of 50MB`);
        continue;
      }
      try {
        const res = await uploadFile(file);
        setPending((prev) => [
          ...prev,
          {
            attachmentId: res.attachmentId,
            kind: res.kind,
            name: res.name,
            url: res.url,
            size: res.size,
          },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to upload "${file.name}"`);
      }
    }
  };

  const removePending = (attachmentId: string) => {
    setPending((prev) => prev.filter((p) => p.attachmentId !== attachmentId));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer glass">
        {pending.length > 0 && (
          <div className="pending-attachments">
            {pending.map((p) =>
              p.kind === "image" && p.url ? (
                <div key={p.attachmentId} className="pending-img">
                  <img src={p.url} alt={p.name} />
                  <button
                    className="pending-remove"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => removePending(p.attachmentId)}
                  >
                    <IconX size={12} />
                  </button>
                </div>
              ) : (
                <div key={p.attachmentId} className="pending-chip">
                  <IconPaperclip size={12} />
                  <span className="pending-name">{p.name}</span>
                  <button
                    className="pending-remove"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => removePending(p.attachmentId)}
                  >
                    <IconX size={12} />
                  </button>
                </div>
              )
            )}
          </div>
        )}
        <div className="composer-row">
          <button
            className="icon-btn mic-btn"
            disabled
            title="Voice input is not available yet"
            aria-label="Voice input is not available yet"
          >
            <IconMic size={18} />
          </button>
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            placeholder={busy ? "Agent is working…" : "Message…"}
            onChange={(e) => {
              setText(e.target.value);
              autogrow();
            }}
            onKeyDown={handleKeyDown}
            aria-label="Message"
          />
          <button
            className="icon-btn"
            aria-label="Attach file"
            onClick={() => fileRef.current?.click()}
          >
            <IconPaperclip size={18} />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            className="send-btn"
            aria-label={t(lang, "actions.send")}
            disabled={!canSend}
            onClick={() => void submit()}
          >
            <IconSend size={16} />
          </button>
        </div>
        {error && <p className="composer-error">{error}</p>}
      </div>
    </div>
  );
}
