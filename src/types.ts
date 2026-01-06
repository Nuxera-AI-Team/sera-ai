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
   * Patient ID associated with the recording (optional)
   */
  patientId?: number;

  /**
   * Patient name associated with the recording (optional)
   */
  patientName?: string;

  /**
   * Patient history information (optional)
   */
  patientHistory?: string;

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
