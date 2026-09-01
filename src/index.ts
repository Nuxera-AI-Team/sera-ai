export { default as AudioRecorder } from "./AudioRecorder";
export { default as AudioDictation } from "./AudioDictation";
export { default as AudioCapture } from "./AudioCapture";
export type { AudioRecorderProps, APIResponse, APIOptions } from "./types";
export type { AudioDictationProps } from "./AudioDictation";
export type { AudioCaptureProps } from "./AudioCapture";

// Headless recorder hook — drive the audio→transcript pipeline from a custom UI
// (e.g. a browser-extension side panel). Owns capture, chunking, compression /
// silence removal, upload, and transcript/note assembly. Supports the v1 and v2
// transcription APIs (see the `apiVersion` option).
export { default as useAudioRecorder } from "./hooks/useAudioRecorder";
export type {
  AudioRecorderHookProps,
  UseAudioRecorderReturn,
} from "./hooks/useAudioRecorder";
export type {
  ClassificationInfoResponse,
  MedicalSectionBase,
  PatientDetails,
} from "./types";
