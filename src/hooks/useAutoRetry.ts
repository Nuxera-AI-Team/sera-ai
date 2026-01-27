import { useState, useCallback, useRef } from "react";
import { ClassificationInfoResponse } from "../types";

const CONFIDENCE_THRESHOLD = 0.6;

interface AutoRetryOptions {
  apiKey: string;
  apiBaseUrl?: string;
  speciality: string;
  patientName?: string;
  doctorName?: string;
  userId?: number;
  patientId?: number;
  onRetryComplete?: (result: AutoRetryResult) => void;
}

interface AutoRetryResult {
  transcription: string;
  classifiedInfo: ClassificationInfoResponse;
  sessionId: string;
  wasRetried: boolean;
}

interface ProcessResult {
  transcription: string;
  classifiedInfo: ClassificationInfoResponse;
  sessionId: string;
  needsRetry: boolean;
}

interface UseAutoRetryReturn {
  /**
   * Process transcription result and check if retry is needed.
   * Returns immediately with original result. If confidence is low,
   * triggers background retry and calls onRetryComplete when done.
   */
  processAndRetryInBackground: (
    transcription: string,
    classifiedInfo: ClassificationInfoResponse,
    sessionId: string
  ) => ProcessResult;
  isRetrying: boolean;
  retryError: string | null;
  resetRetryState: () => void;
}

export function useAutoRetry(options: AutoRetryOptions): UseAutoRetryReturn {
  const {
    apiKey,
    apiBaseUrl = "https://nuxera.cloud",
    speciality,
    patientName,
    doctorName,
    userId,
    patientId,
    onRetryComplete,
  } = options;

  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const hasRetriedRef = useRef(false);
  const onRetryCompleteRef = useRef(onRetryComplete);

  // Keep the callback ref updated
  onRetryCompleteRef.current = onRetryComplete;

  const performRetry = useCallback(
    async (
      transcription: string,
      classifiedInfo: ClassificationInfoResponse,
      sessionId: string
    ): Promise<void> => {
      setIsRetrying(true);
      setRetryError(null);

      console.log("[AUTO-RETRY] Starting background retry using sessionId:", sessionId);

      try {
        const formData = new FormData();
        formData.append("sessionId", sessionId);
        formData.append("patientName", patientName || "Unknown Patient");
        formData.append("doctorName", doctorName || "Unknown Doctor");
        formData.append("model", "new-large");
        formData.append("speciality", speciality);
        if (userId !== undefined) {
          formData.append("userId", String(userId));
        }
        if (patientId !== undefined) {
          formData.append("patientId", String(patientId));
        }

        const response = await fetch(`${apiBaseUrl}/api/transcribe/retry`, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
          },
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Retry request failed: ${response.status} - ${errorText}`);
        }

        const retryData = await response.json();

        console.log("[AUTO-RETRY] Retry successful:", {
          newConfidenceScore: retryData.classifiedInfo?.confidenceScore,
          hasTranscription: !!retryData.transcription,
          hasClassifiedInfo: !!retryData.classifiedInfo,
        });

        // Call the completion callback with the new result
        if (onRetryCompleteRef.current) {
          onRetryCompleteRef.current({
            transcription: retryData.transcription || transcription,
            classifiedInfo: retryData.classifiedInfo || classifiedInfo,
            sessionId: retryData.sessionId || sessionId,
            wasRetried: true,
          });
        }
      } catch (error) {
        console.error("[AUTO-RETRY] Retry failed:", error);
        setRetryError(error instanceof Error ? error.message : "Retry failed");
        // Don't call onRetryComplete on failure - keep showing original result
      } finally {
        setIsRetrying(false);
      }
    },
    [apiKey, apiBaseUrl, speciality, patientName, doctorName, userId, patientId]
  );

  const processAndRetryInBackground = useCallback(
    (
      transcription: string,
      classifiedInfo: ClassificationInfoResponse,
      sessionId: string
    ): ProcessResult => {
      // Extract confidence score from classifiedInfo
      // Server response format: classifiedInfo.confidenceScore
      const confidenceScore = (classifiedInfo as any)?.confidenceScore;

      console.log("[AUTO-RETRY] Checking confidence score:", {
        confidenceScore,
        threshold: CONFIDENCE_THRESHOLD,
        sessionId,
        hasAlreadyRetried: hasRetriedRef.current,
      });

      // Check if retry is needed
      const needsRetry =
        confidenceScore !== undefined &&
        confidenceScore < CONFIDENCE_THRESHOLD &&
        !hasRetriedRef.current &&
        !!sessionId;

      if (!needsRetry) {
        console.log("[AUTO-RETRY] No retry needed:", {
          reason:
            confidenceScore === undefined
              ? "No confidence score"
              : confidenceScore >= CONFIDENCE_THRESHOLD
              ? "Confidence above threshold"
              : hasRetriedRef.current
              ? "Already retried once"
              : "No session ID available",
        });

        return {
          transcription,
          classifiedInfo,
          sessionId,
          needsRetry: false,
        };
      }

      // Mark that we're attempting a retry (only once)
      hasRetriedRef.current = true;

      console.log("[AUTO-RETRY] Confidence below threshold, triggering background retry");

      // Start retry in background (non-blocking)
      performRetry(transcription, classifiedInfo, sessionId);

      // Return original result immediately
      return {
        transcription,
        classifiedInfo,
        sessionId,
        needsRetry: true,
      };
    },
    [performRetry]
  );

  // Reset the retry flag when needed (e.g., for a new recording session)
  const resetRetryState = useCallback(() => {
    hasRetriedRef.current = false;
    setRetryError(null);
  }, []);

  return {
    processAndRetryInBackground,
    isRetrying,
    retryError,
    resetRetryState,
  };
}

export default useAutoRetry;
