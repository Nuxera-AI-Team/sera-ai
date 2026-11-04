export interface PatientDetails {
  id?: number;
  name?: string;
  gender?: string;
  dateOfBirth?: Date | string;
  age?: number;
}

/**
 * What the recorder is doing, as passed to `onRecordingStateChange`.
 * - "recording": capturing audio.
 * - "paused": a recording is open but paused; the microphone is still held.
 * - "processing": stopped, and the final chunk is still on its way or its
 *   note is being made; or a saved recording is being retried.
 * - "idle": nothing is being captured or sent. A failed recording waiting for
 *   the user to retry it is idle too.
 */
export type RecordingState = "idle" | "recording" | "paused" | "processing";

export interface AudioRecorderProps {
  /**
   * Speciality of the medical professional using the service
   */
  speciality: string;

  /**
   * API key for authentication with YourService
   */
  apiKey: string;

  /**
   * Base URL for the API endpoints (optional, defaults to production)
   */
  apiBaseUrl?: string;

  /**
   * Encounter ID to associate the transcription with a specific encounter (optional)
   */
  encounterId?: string;

  /**
   * Template ID to use for shaping the transcription output (optional)
   */
  template?: string;

  /**
   * Patient history information (optional)
   */
  patientHistory?: string;

  /**
   * Patient details information (optional)
   */
  patientDetails?: PatientDetails;

  /**
   * Format for API requests and responses (optional, defaults to "json")
   * - "json": Standard JSON format
   * - "hl7": HL7 v2.5 message format
   * - "fhir": FHIR R4 Bundle format
   */
  selectedFormat?: "json" | "hl7" | "fhir";

  /**
   * How often a chunk is cut and uploaded, in milliseconds (optional, defaults
   * to 47000). Clamped to [30000, 120000].
   *
   * The server accepts at most 120 chunks per v1 session, so this value times
   * 120 is the longest recording that is fully captured.
   *
   * The server receives whatever this timer produced and cannot ask for audio
   * sooner, so this is the only place the cadence can be set. See
   * `chunkDurationMs` on AudioRecorderHookProps for the trade-offs.
   */
  chunkDurationMs?: number;

  /**
   * Callback function called on transcription updates (optional)
   */
  onTranscriptionUpdate?: (text: string, sessionId: string) => void;

  /**
   * Callback function called when transcription is completed (optional)
   */
  onTranscriptionComplete?: (
    text: string,
    classification: ClassificationInfoResponse,
    sessionId: string
  ) => void;

  /**
   * Called when the recording state changes, so the host can tell whether a
   * recording is live (optional). Not called on mount: the recorder starts
   * "idle". If it isn't idle when it unmounts, it reports "idle" then.
   *
   * Unmounting mid-recording stops it and sends nothing more; a recording
   * already stopped still finishes. See `onRecordingStateChange` on
   * AudioRecorderHookProps.
   */
  onRecordingStateChange?: (state: RecordingState) => void;

  /**
   * Callback function called when API request succeeds
   */
  // Published API: narrowing this would break consumers that read arbitrary
  // response fields off the callback payload.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSuccess?: (data: any) => void;

  /**
   * Callback function called when API request fails
   */
  onError?: (error: string) => void;

  /**
   * Additional CSS class names
   */
  className?: string;

  /**
   * Additional CSS class names for the audio visualizer
   */
  visualizerClassName?: string;

  /**
   * Custom styles
   */
  style?: React.CSSProperties;
}

// Published API: the default type parameter is part of the surface, and
// `unknown` would reject existing consumer code that indexes into a response.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface APIOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  // Published API.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: any;
  headers?: Record<string, string>;
}

export interface MedicalSectionBase {
  [sectionName: string]: string[];
}
// API response type
export interface ClassificationInfoResponse {
  speciality: string;
  generatedAt: string;
  classifiedInfo: MedicalSectionBase;
}
