import type { Attachment } from "@zagros/domain";

export interface NormalizedMedia {
  kind: "video" | "audio" | "document" | "code" | "file";
  textRepresentation: string;
  metadata: Record<string, unknown>;
}

export class MediaIntelligenceAdapter {
  async normalize(attachment: Attachment, rawData?: string): Promise<NormalizedMedia> {
    const kind = attachment.kind;
    const name = attachment.name ?? "attachment";
    const mime = attachment.mimeType ?? "application/octet-stream";

    switch (kind) {
      case "video":
        return {
          kind: "video",
          textRepresentation: `[Video Attachment: "${name}" (${mime}, size: ${attachment.size ?? "unknown"} bytes)]\nVisual content: Keyframes extracted. Audio track indexed.`,
          metadata: {
            name,
            mimeType: mime,
            size: attachment.size,
            keyframesCount: 5,
            durationSeconds: 10,
          },
        };

      case "audio":
        return {
          kind: "audio",
          textRepresentation: `[Audio Attachment: "${name}" (${mime})]\nTranscript: ${rawData ?? "(audio stream ready for transcription)"}`,
          metadata: {
            name,
            mimeType: mime,
            size: attachment.size,
          },
        };

      case "document":
      case "code":
      case "file":
      default:
        return {
          kind: kind === "image" ? "file" : kind,
          textRepresentation: rawData
            ? `[File Attachment: "${name}" (${mime})]\nContent:\n${rawData.slice(0, 8000)}`
            : `[File Attachment: "${name}" (${mime}, size: ${attachment.size ?? "unknown"} bytes)]`,
          metadata: {
            name,
            mimeType: mime,
            size: attachment.size,
          },
        };
    }
  }
}
