// v2 transcription API client.
//
// The v2 flow is stateless and split across two endpoints (unlike the v1
// session-based POST /api/transcribe):
//
//   POST /api/transcribe/v2         — per chunk: STT + diarization + speaker→role
//                                     labeling. Returns a role-labeled transcript.
//   POST /api/transcribe/medical-note — once on finalize: turn the combined
//                                     labeled transcript into a structured note.
//
// Because v2 keeps no server session, the *client* owns ordering: each chunk's
// labeled transcript is stitched together in sequence, then sent for note
// generation when recording stops. Network + retry live in the hook; the pure
// stitching/parsing helpers here are unit-testable in isolation.

import { ClassificationInfoResponse, MedicalSectionBase } from "../types";

export interface TranscribeV2ChunkResult {
  labeledTranscript: string;
  diarizedTranscript: string;
  roles: Record<string, string>;
  provider?: string;
  model?: string;
}

export interface MedicalNoteOptions {
  speciality: string;
  userId?: number;
  patientName?: string;
  doctorName?: string;
  skipDiarization?: boolean;
}

/**
 * POST one audio chunk to /api/transcribe/v2. The server does STT +
 * diarization + role labeling and returns a role-labeled transcript. Don't set
 * Content-Type — the browser adds the multipart boundary. Throws on non-2xx so
 * the caller (which owns retry) can react.
 */
export async function postTranscribeV2Chunk(
  apiBaseUrl: string,
  apiKey: string,
  audioFile: File,
  speciality: string,
): Promise<TranscribeV2ChunkResult> {
  const form = new FormData();
  form.append("file", audioFile, audioFile.name);
  if (speciality) form.append("speciality", speciality);

  const res = await fetch(`${apiBaseUrl}/api/transcribe/v2`, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: form,
  });

  if (!res.ok) {
    // 401 auth, 400 no file, or an STT-provider status passthrough
    // ({ error, status, body }).
    let msg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      if (err?.error)
        msg = err.status ? `${err.error} (upstream ${err.status})` : err.error;
    } catch {
      /* non-JSON body */
    }
    // Carry the HTTP status so callers can decide whether to retry (5xx) or
    // abort (4xx).
    throw Object.assign(new Error(msg), { status: res.status });
  }

  return parseV2ChunkResponse(await res.json());
}

/** Normalize the /v2 response into a stable shape (defensive against missing keys). */
export function parseV2ChunkResponse(data: unknown): TranscribeV2ChunkResult {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    labeledTranscript: typeof d.labeledTranscript === "string" ? d.labeledTranscript : "",
    diarizedTranscript: typeof d.diarizedTranscript === "string" ? d.diarizedTranscript : "",
    roles: (d.roles as Record<string, string>) ?? {},
    provider: typeof d.provider === "string" ? d.provider : undefined,
    model: typeof d.model === "string" ? d.model : undefined,
  };
}

/**
 * Stitch the per-chunk labeled transcripts into one transcript, in sequence
 * order. Blank chunks (silence / no speech) are dropped so the combined text
 * doesn't accumulate empty gaps.
 */
export function combineLabeledTranscripts(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join("\n");
}

/**
 * POST the combined transcript to /api/transcribe/medical-note and return a
 * ClassificationInfoResponse. The endpoint accepts JSON (form-data is silently
 * dropped → "transcribedText is required"), so send JSON. Throws on non-2xx.
 */
export async function postMedicalNote(
  apiBaseUrl: string,
  apiKey: string,
  transcribedText: string,
  opts: MedicalNoteOptions,
): Promise<ClassificationInfoResponse> {
  const params: Record<string, string> = {
    transcribedText,
    userId: String(opts.userId ?? 115),
    speciality: opts.speciality || "soap_note",
    patientName: opts.patientName ?? "sera-ai",
    doctorName: opts.doctorName ?? "sera-ai",
    skipDiarization: String(opts.skipDiarization ?? false),
  };

  const res = await fetch(`${apiBaseUrl}/api/transcribe/medical-note`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
      "x-response-format": "json",
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Medical note failed: ${res.status} ${body.slice(0, 300)}`);
  }

  return buildClassification(await res.json(), opts.speciality || "soap_note");
}

/**
 * Shape a /medical-note raw response into a ClassificationInfoResponse. The note
 * lives under `classifiedInfo`, sometimes double-nested as
 * classifiedInfo.classifiedInfo, as { Subjective:[…], Objective:[…], … }.
 */
export function buildClassification(
  raw: unknown,
  speciality: string,
): ClassificationInfoResponse {
  const r = (raw ?? {}) as Record<string, unknown>;
  const generatedAt =
    typeof r.generatedAt === "string" ? r.generatedAt : new Date().toISOString();
  return {
    speciality:
      typeof r.speciality === "string" && r.speciality ? r.speciality : speciality,
    generatedAt,
    classifiedInfo: parseClassifiedInfo(raw),
  };
}

/** Drill through wrapper objects that re-nest `classifiedInfo` and normalize to section → string[]. */
export function parseClassifiedInfo(raw: unknown): MedicalSectionBase {
  let node: unknown = (raw as Record<string, unknown> | null | undefined)?.classifiedInfo;
  for (let i = 0; node && typeof node === "object" && !Array.isArray(node) && i < 5; i++) {
    const inner = (node as Record<string, unknown>).classifiedInfo;
    if (inner === undefined) break;
    node = inner;
  }

  const out: MedicalSectionBase = {};
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const [section, v] of Object.entries(node as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        out[section] = v.map((line) => String(line).trim()).filter((s) => s.length > 0);
      } else if (typeof v === "string" && v.trim()) {
        out[section] = [v.trim()];
      }
    }
  }
  return out;
}
