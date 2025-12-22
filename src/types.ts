export interface AudioRecorderProps {
  /**
   * API key for authentication with YourService
   */
  apiKey: string;

  /**
   * Callback function called when API request succeeds
   */
  onSuccess?: (data: any) => void;

  /**
   * Callback function called when API request fails
   */
  onError?: (error: string) => void;

  /**
   * Base URL for the API (optional, defaults to production)
   */
  baseUrl?: string;

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
