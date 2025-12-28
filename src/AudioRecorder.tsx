import * as React from "react";
import { AudioRecorderProps, APIResponse, APIOptions } from "./types";
import useAudioRecorder from "./hooks/useAudioRecorder";
import { Mic, Square, Loader2, Pause, Play, AlertTriangle } from "lucide-react";
import Toast from "./components/Toast";
import AudioVisualizerImproved from "./components/AudioVisualizerImproved";

const AudioRecorder: React.FC<AudioRecorderProps> = ({
  apiKey,
  speciality,
  patientId,
  patientName,
  onTranscriptionUpdate,
  onTranscriptionComplete,
  onSuccess,
  onError,
  className = "",
  style,
}) => {
  const {
    mediaStreamRef,
    startRecording,
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
    speciality: speciality,
    patientName: patientName,
    patientId: patientId,
    onTranscriptionUpdate: (text, sessionId) => {
      console.log("Transcription update:", text, sessionId);
      onTranscriptionUpdate && onTranscriptionUpdate(text, sessionId);
    },
    onTranscriptionComplete: (text, classification, sessionId) => {
      console.log("Transcription complete:", text, classification, sessionId);
      onTranscriptionComplete && onTranscriptionComplete(text, classification, sessionId);
    },
    apiKey: apiKey,
  });

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
      {isRecording && !isPaused && mediaStreamRef.current && (
        <div
          className={`audio-recorder-container ${isRecording && !isPaused ? "glow-active" : ""}`}
        >
          <div className="edge-container">
            <div className="edge edge-top" />
            <div className="edge edge-right" />
            <div className="edge edge-bottom" />
            <div className="edge edge-left" />
          </div>
          <div className="flex justify-center items-center">
            <AudioVisualizerImproved
              mediaStream={mediaStreamRef.current}
              isRecording={isRecording && !isPaused} // Keep running even during FFmpeg processing!
              forceLight={false}
            />
          </div>
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
