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
  const [recording, setRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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

  const handleFiles = async (files: FileList | File[] | null) => {
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

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Audio recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const file = new File([audioBlob], `voice-note-${Date.now()}.webm`, { type: "audio/webm" });
        await handleFiles([file]);
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone access denied");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
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
            className={`icon-btn mic-btn ${recording ? "active" : ""}`}
            style={{ color: recording ? "var(--color-danger, #ef4444)" : undefined }}
            title={recording ? "Stop recording voice" : "Record voice note"}
            aria-label={recording ? "Stop recording voice" : "Record voice note"}
            onClick={() => (recording ? stopRecording() : void startRecording())}
          >
            <IconMic size={18} />
          </button>
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            placeholder={busy ? "Agent is working…" : recording ? "Recording audio…" : "Message…"}
            onChange={(e) => {
              setText(e.target.value);
              autogrow();
            }}
            onKeyDown={handleKeyDown}
            aria-label="Message"
          />
          <button
            className="icon-btn"
            aria-label="Attach photo, video, audio, or document"
            title="Attach file (image, video, audio, document)"
            onClick={() => fileRef.current?.click()}
          >
            <IconPaperclip size={18} />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept="image/*,video/*,audio/*,.pdf,.txt,.md,.json,.ts,.js,.py,.rs,.go,.cpp,.c,.html,.css"
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
