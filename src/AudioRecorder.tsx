import * as React from "react";
import { AudioRecorderProps, APIResponse, APIOptions } from "./types";
import useAudioRecorder from "./hooks/useAudioRecorder";
import useAutoRetry from "./hooks/useAutoRetry";
import { Mic, Square, Loader2, Pause, Play, AlertTriangle } from "lucide-react";
import Toast from "./components/Toast";
import AudioVisualizerImproved from "./components/AudioVisualizerImproved";

// Embedded minimal Tailwind utilities
const tailwindStyles = `
  .space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 1rem; }
  .bg-orange-50 { background-color: rgb(255 247 237); }
  .bg-blue-900 { background-color: rgb(30 58 138); }
  .text-yellow-200 { color: rgb(254 240 138); }
  .hover\\:bg-blue-700:hover { background-color: rgb(29 78 216); }
  .dark .dark\\:bg-orange-900\\/20 { background-color: rgb(194 65 12 / 0.2); }
  .border { border-width: 1px; }
  .border-orange-200 { border-color: rgb(254 215 170); }
  .dark .dark\\:border-orange-800 { border-color: rgb(154 52 18); }
  .rounded-lg { border-radius: 0.5rem; }
  .p-4 { padding: 1rem; }
  .flex { display: flex; }
  .items-start { align-items: flex-start; }
  .items-center { align-items: center; }
  .justify-center { justify-content: center; }
  .flex-shrink-0 { flex-shrink: 0; }
  .h-5 { height: 1.25rem; }
  .w-5 { width: 1.25rem; }
  .text-orange-400 { color: rgb(251 146 60); }
  .ml-3 { margin-left: 0.75rem; }
  .flex-1 { flex: 1 1 0%; }
  .text-sm { font-size: 0.875rem; line-height: 1.25rem; }
  .font-medium { font-weight: 500; }
  .text-orange-800 { color: rgb(154 52 18); }
  .dark .dark\\:text-orange-200 { color: rgb(254 215 170); }
  .mt-2 { margin-top: 0.5rem; }
  .text-orange-700 { color: rgb(194 65 12); }
  .dark .dark\\:text-orange-300 { color: rgb(253 186 116); }
  .list-disc { list-style-type: disc; }
  .list-inside { list-style-position: inside; }
  .bg-red-50 { background-color: rgb(254 242 242); }
  .dark .dark\\:bg-red-900\\/20 { background-color: rgb(127 29 29 / 0.2); }
  .border-red-200 { border-color: rgb(254 202 202); }
  .dark .dark\\:border-red-800 { border-color: rgb(153 27 27); }
  .text-red-400 { color: rgb(248 113 113); }
  .text-red-800 { color: rgb(153 27 27); }
  .dark .dark\\:text-red-200 { color: rgb(254 202 202); }
  .text-red-700 { color: rgb(185 28 28); }
  .dark .dark\\:text-red-300 { color: rgb(252 165 165); }
  .mt-4 { margin-top: 1rem; }
  .bg-red-600 { background-color: rgb(220 38 38); }
  .hover\\:bg-red-700:hover { background-color: rgb(185 28 28); }
  .text-white { color: rgb(255 255 255); }
  .px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
  .py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
  .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
  .px-4 { padding-left: 1rem; padding-right: 1rem; }
  .rounded { border-radius: 0.25rem; }
  .rounded-full { border-radius: 9999px; }
  .transition-colors { transition-property: color, background-color, border-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
  .bg-yellow-50 { background-color: rgb(254 252 232); }
  .dark .dark\\:bg-yellow-900\\/20 { background-color: rgb(133 77 14 / 0.2); }
  .border-yellow-200 { border-color: rgb(254 240 138); }
  .dark .dark\\:border-yellow-800 { border-color: rgb(133 77 14); }
  .text-yellow-400 { color: rgb(250 204 21); }
  .text-yellow-800 { color: rgb(133 77 14); }
  .dark .dark\\:text-yellow-200 { color: rgb(254 240 138); }
  .text-yellow-700 { color: rgb(161 98 7); }
  .dark .dark\\:text-yellow-300 { color: rgb(253 224 71); }
  .space-x-3 > :not([hidden]) ~ :not([hidden]) { margin-left: 0.75rem; }
  .space-x-1 > :not([hidden]) ~ :not([hidden]) { margin-left: 0.25rem; }
  .space-x-2 > :not([hidden]) ~ :not([hidden]) { margin-left: 0.5rem; }
  .bg-yellow-600 { background-color: rgb(202 138 4); }
  .hover\\:bg-yellow-700:hover { background-color: rgb(161 98 7); }
  .disabled\\:opacity-50:disabled { opacity: 0.5; }
  .h-3 { height: 0.75rem; }
  .w-3 { width: 0.75rem; }
  .animate-spin { animation: spin 1s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .bg-gray-600 { background-color: rgb(75 85 99); }
  .hover\\:bg-gray-700:hover { background-color: rgb(55 65 81); }
  .bg-blue-50 { background-color: rgb(239 246 255); }
  .dark .dark\\:bg-blue-900\\/20 { background-color: rgb(30 58 138 / 0.2); }
  .border-blue-200 { border-color: rgb(191 219 254); }
  .dark .dark\\:border-blue-800 { border-color: rgb(30 64 175); }
  .text-blue-600 { color: rgb(37 99 235); }
  .block { display: block; }
  .text-blue-700 { color: rgb(29 78 216); }
  .dark .dark\\:text-blue-300 { color: rgb(147 197 253); }
  .text-xs { font-size: 0.75rem; line-height: 1rem; }
  .dark .dark\\:text-blue-400 { color: rgb(96 165 250); }
  .mt-1 { margin-top: 0.25rem; }
  .bg-teal-600 { background-color: rgb(13 148 136); }
  .hover\\:bg-teal-700:hover { background-color: rgb(15 118 110); }
  .bg-green-600 { background-color: rgb(22 163 74); }
  .hover\\:bg-green-700:hover { background-color: rgb(21 128 61); }
  .bg-yellow-500 { background-color: rgb(234 179 8); }
  .hover\\:bg-yellow-600:hover { background-color: rgb(202 138 4); }
  .bg-gradient-to-r { background-image: linear-gradient(to right, var(--tw-gradient-stops)); }
  .from-orange-400 { --tw-gradient-from: #fb923c; --tw-gradient-to: rgb(251 146 60 / 0); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to); }
  .to-pink-500 { --tw-gradient-to: #ec4899; }
  .hover\\:from-orange-500:hover { --tw-gradient-from: #f97316; --tw-gradient-to: rgb(249 115 22 / 0); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to); }
  .hover\\:to-pink-600:hover { --tw-gradient-to: #db2777; }
  .opacity-50 { opacity: 0.5; }
  .cursor-not-allowed { cursor: not-allowed; }
`;

// Inject styles only once
let stylesInjected = false;
const injectTailwindStyles = () => {
  if (!stylesInjected && typeof document !== 'undefined') {
    const styleElement = document.createElement('style');
    styleElement.textContent = tailwindStyles;
    document.head.appendChild(styleElement);
    stylesInjected = true;
  }
};

const AudioRecorder: React.FC<AudioRecorderProps> = ({
  apiKey,
  apiBaseUrl,
  speciality,
  patientHistory,
  patientDetails,
  selectedFormat = "json",
  onTranscriptionUpdate,
  onTranscriptionComplete,
  onSuccess,
  onError,
  className = "",
  visualizerClassName = "",
  style,
}) => {
  // Inject Tailwind styles on component mount
  React.useEffect(() => {
    injectTailwindStyles();
  }, []);

  // State to track if auto-retry is needed (for showing message)
  const [showAutoRetryMessage, setShowAutoRetryMessage] = React.useState(false);

  // Initialize auto-retry hook for low confidence score handling
  const {
    processAndRetryInBackground,
    isRetrying: isAutoRetrying,
    retryError: autoRetryError,
    resetRetryState,
  } = useAutoRetry({
    apiKey,
    apiBaseUrl,
    speciality,
    patientName: patientDetails?.name,
    doctorName: undefined, // Can be passed from props if needed
    userId: undefined, // Can be passed from props if needed
    patientId: patientDetails?.id,
    onRetryComplete: (result) => {
      // Called when background retry completes successfully
      console.log("[AUTO-RETRY] Background retry complete, updating with new result");
      setShowAutoRetryMessage(false);
      onTranscriptionComplete && onTranscriptionComplete(
        result.transcription,
        result.classifiedInfo,
        result.sessionId
      );
    },
  });

  const {
    mediaStreamRef,
    startRecording: startRecordingInternal,
    stopRecording,
    pauseRecording,
    resumeRecording,
    isRecording,
    isPaused,
    isProcessing,
    error,
    transcriptionDone,
    availableDevices,
    validateMicrophoneAccess,
    audioLevel,
    noAudioDetected,
    // Add recovery properties
    isRetryingSession,
    showRetrySessionPrompt,
    retryFailedSession,
    clearAllSessions,
    // Add FFmpeg processing status
    isConverting,
    progress,
    statusMessage,
  } = useAudioRecorder({
    apiKey: apiKey,
    apiBaseUrl: apiBaseUrl,
    speciality: speciality,
    patientHistory: patientHistory,
    patientDetails: patientDetails,
    selectedFormat: selectedFormat,
    onTranscriptionUpdate: (text, sessionId) => {
      console.log("onTranscriptionUpdate called with text:", text, "sessionId:", sessionId);
      if (text.length > 0) {
        console.log("Transcription update:", text, sessionId);
        onTranscriptionUpdate && onTranscriptionUpdate(text, sessionId);
      }
    },
    onTranscriptionComplete: (text, classification, sessionId) => {
      console.log(
        "onTranscriptionComplete called with text:",
        text,
        "classification:",
        classification,
        "sessionId:",
        sessionId
      );

      // Process and check if retry is needed (non-blocking)
      const result = processAndRetryInBackground(text, classification, sessionId);

      // Show message if retry is being performed in background
      if (result.needsRetry) {
        setShowAutoRetryMessage(true);
        console.log("[AUTO-RETRY] Low confidence detected, retrying in background");
      }

      // Immediately return original result to user
      onTranscriptionComplete && onTranscriptionComplete(
        result.transcription,
        result.classifiedInfo,
        result.sessionId
      );
    },
  });

  // Wrap startRecording to reset retry state for new sessions
  const startRecording = React.useCallback(() => {
    resetRetryState();
    setShowAutoRetryMessage(false);
    startRecordingInternal();
  }, [resetRetryState, startRecordingInternal]);

  const isEmergencyOrInPatient = speciality === "emergency" || speciality === "in_patient";
  const buttonText = isEmergencyOrInPatient ? "Start Recording" : "Start Transcription";

  const errorHandledRef = React.useRef(false);

  const [isDisabled, setIsDisabled] = React.useState(false);

  const [userEmail] = React.useState<string>(localStorage.getItem("userEmail") || "");
  const isKamcUser = userEmail.toLowerCase().endsWith("@kamc.net");

  // Add state for toast notifications
  const [toast, setToast] = React.useState<{
    show: boolean;
    message: string;
    type: "success" | "error";
  }>({
    show: false,
    message: "",
    type: "success",
  });

  const handleStopClick = () => {
    setIsDisabled(true);
    stopRecording();
  };

  const handleStartRecording = () => {
    setIsDisabled(false); // Reset disabled state when starting a new recording
    startRecording();
  };

  React.useEffect(() => {
    if (error) {
      setToast({ show: true, message: error, type: "error" });
    }
  }, [error]);

  React.useEffect(() => {
    if (error && !errorHandledRef.current) {
      errorHandledRef.current = true;
      if (onError) {
        onError(error);
      }
    } else if (!error) {
      errorHandledRef.current = false;
    }
  }, [error, onError]);

  // Enhanced error detection to include no audio detection
  const isMicrophoneError =
    error &&
    (error.toLowerCase().includes("microphone") ||
      error.toLowerCase().includes("not found") ||
      error.toLowerCase().includes("no audio") ||
      error.toLowerCase().includes("devices not found") ||
      error.toLowerCase().includes("access denied") ||
      error.toLowerCase().includes("permission") ||
      error.toLowerCase().includes("not allowed") ||
      error.toLowerCase().includes("busy") ||
      error.toLowerCase().includes("media devices not supported") ||
      availableDevices.length === 0 ||
      noAudioDetected);

  // Show no audio detected error specifically
  if (noAudioDetected || (error && error.includes("No audio input detected"))) {
    return (
      <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <AlertTriangle className="h-5 w-5 text-orange-400" />
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium text-orange-800 dark:text-orange-200">
              No Audio Input Detected
            </h3>
            <div className="mt-2 text-sm text-orange-700 dark:text-orange-300">
              <p>{error}</p>
              <ul className="mt-2 list-disc list-inside">
                <li>Check if your microphone is properly connected</li>
                <li>Ensure you're speaking close enough to the microphone</li>
                <li>Try adjusting your microphone volume settings</li>
                <li>Test your microphone in other applications</li>
                <li>Make sure your browser has microphone permissions</li>
                <li>Please reload the page and try again</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show microphone/audio errors
  if (isMicrophoneError) {
    console.log("🔴 Showing microphone error UI");
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
              Audio Input Issue
            </h3>
            <div className="mt-2 text-sm text-red-700 dark:text-red-300">
              <p>{error}</p>
            </div>
            <div className="mt-4">
              <button
                onClick={() => {
                  console.log("🔄 Check Again button clicked");
                  validateMicrophoneAccess();
                }}
                className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm transition-colors"
              >
                Check Again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // // Show authentication error separately
  // if (error && error.includes("authentication failed")) {
  //   return (
  //     <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
  //       <div className="flex items-start">
  //         <div className="flex-shrink-0">
  //           <AlertTriangle className="h-5 w-5 text-yellow-400" />
  //         </div>
  //         <div className="ml-3">
  //           <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
  //             Service Configuration Required
  //           </h3>
  //           <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
  //             <p>
  //               The transcription service requires proper configuration. Please contact your system
  //               administrator.
  //             </p>
  //           </div>
  //         </div>
  //       </div>
  //     </div>
  //   );
  // }

  const closeToast = () => {
    setToast({ ...toast, show: false });
  };

  return (
    <div className="space-y-4">
      {toast.show && (
        <Toast message={toast.message} type={toast.type} onClose={closeToast} duration={1} />
      )}
      {showRetrySessionPrompt && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                Recording Sessions Available for Retry
              </h3>
              <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
                <p>
                  Recording session failed to complete transcription. Your audio has been saved
                  offline and can be retried.
                </p>
              </div>
              <div className="mt-4 flex space-x-3">
                <button
                  onClick={retryFailedSession}
                  disabled={isRetryingSession}
                  className="flex items-center space-x-1 bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-2 rounded text-sm transition-colors disabled:opacity-50"
                >
                  {isRetryingSession && <Loader2 className="h-3 w-3 animate-spin" />}
                  <span>{isRetryingSession ? "Retrying..." : "Retry Transcription"}</span>
                </button>
                <button
                  onClick={clearAllSessions}
                  className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded text-sm transition-colors"
                >
                  Clear Saved Sessions
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Show retry status */}
      {isRetryingSession && (
        <div className="flex items-center justify-center space-x-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <Loader2 className="animate-spin h-5 w-5 text-blue-600" />
          <div className="text-center">
            <span className="block text-sm font-medium text-blue-700 dark:text-blue-300">
              Retrying transcription with saved audio...
            </span>
            <span className="block text-xs text-blue-600 dark:text-blue-400 mt-1">
              Please wait while we process your recording
            </span>
          </div>
        </div>
      )}
      {/* Show auto-retry message for low confidence */}
      {(showAutoRetryMessage || isAutoRetrying) && (
        <div className="flex items-center justify-center space-x-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <Loader2 className="animate-spin h-5 w-5 text-blue-600" />
          <div className="text-center">
            <span className="block text-sm font-medium text-blue-700 dark:text-blue-300">
              Low confidence score detected. Auto-retrying for better results...
            </span>
            <span className="block text-xs text-blue-600 dark:text-blue-400 mt-1">
              Your initial results are shown. Updated results will appear shortly.
            </span>
          </div>
        </div>
      )}
      {isRecording && !isPaused && mediaStreamRef.current && (
        <div className={`w-full ${visualizerClassName || "max-w-lg"} mx-auto`}>
          <AudioVisualizerImproved
            mediaStream={mediaStreamRef.current}
            isRecording={isRecording && !isPaused}
            forceLight={false}
            className={visualizerClassName}
          />
        </div>
      )}
      <div className="flex justify-center">
        {isProcessing ? (
          <div className="flex items-center justify-center space-x-2 bg-teal-600 hover:bg-teal-700 text-white py-2 px-4 rounded-full">
            <Loader2 className="animate-spin h-5 w-5" />
            <span>Processing...</span>
          </div>
        ) : transcriptionDone ? (
          <div className="flex items-center justify-center space-x-2 bg-green-600 text-white py-2 px-4 rounded-full">
            <span>Transcription Complete</span>
          </div>
        ) : isRecording || isPaused ? (
          <div className="flex space-x-2">
            <button
              className={`flex items-center justify-center space-x-2 bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-full transition-colors ${
                isDisabled ? "opacity-50 cursor-not-allowed" : ""
              }`}
              onClick={handleStopClick}
              disabled={isDisabled}
            >
              <Square className="h-5 w-5" />
              <span>Stop</span>
            </button>
            {!isKamcUser &&
              (!isPaused ? (
                <button
                  className="flex items-center justify-center space-x-2 bg-yellow-500 hover:bg-yellow-600 text-white py-2 px-4 rounded-full transition-colors"
                  onClick={pauseRecording}
                >
                  <Pause className="h-5 w-5" />
                  <span>Pause</span>
                </button>
              ) : (
                <button
                  className="flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-full transition-colors"
                  onClick={resumeRecording}
                >
                  <Play className="h-5 w-5" />
                  <span>Resume</span>
                </button>
              ))}
          </div>
        ) : (
          <button
            className={
              className
                ? `flex items-center justify-center space-x-2 py-2 px-4 rounded-full transition-colors ${className}`
                : "flex items-center justify-center space-x-2 bg-gradient-to-r from-orange-400 to-pink-500 hover:bg-gradient-to-r hover:from-orange-500 hover:to-pink-600 text-white py-2 px-4 rounded-full transition-colors"
            }
            onClick={handleStartRecording}
          >
            <Mic className="h-5 w-5" />
            <span>{buttonText}</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default AudioRecorder;
