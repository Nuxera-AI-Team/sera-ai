export interface PatientDetails {
  id?: number;
  name?: string;
  gender?: string;
  dateOfBirth?: Date | string;
  age?: number;
}

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
   * Place the chunk boundary where the speaker stops, instead of where the
   * interval falls. Off unless `enabled` is set, so existing hosts are
   * unaffected.
   *
   * A boundary that lands mid-word is transcribed as two halves or as nothing,
   * and nothing downstream can tell which happened. Cutting in a gap avoids
   * the problem rather than repairing it.
   *
   * The window is a share of `chunkDurationMs`, not an absolute, so it keeps
   * working whatever interval the host chose: from `windowStartRatio` of the
   * way through, the first `quietMs` of quiet ends the chunk; otherwise the
   * interval still caps it.
   *
   * `ratioEnter`/`ratioExit` are multiples of the tracked room level rather
   * than fixed loudnesses, which is what lets one setting work in a quiet
   * office and a humming clinic. Two of them, because speech dips between
   * syllables and a single bar reads every dip as a pause.
   */
  pauseChunking?: {
    enabled: boolean;
    /** How far through the interval before a cut may be taken. Default 0.55. */
    windowStartRatio?: number;
    /** Quiet needed to end the chunk, in ms. Default 500. */
    quietMs?: number;
    /** Multiple of the room level that counts as speech starting. Default 8. */
    ratioEnter?: number;
    /** …and as speech ending. Default 5. */
    ratioExit?: number;
    /**
     * Floor the room level cannot fall below. Default 0.004. On digitally
     * silent input a purely proportional test would otherwise treat every
     * sample as speech and never find a pause.
     */
    minFloor?: number;
    /** Band the detector listens to. Defaults 300 and 3400 Hz. */
    bandLowHz?: number;
    bandHighHz?: number;
  };

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
