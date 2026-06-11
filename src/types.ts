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

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface APIOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
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
