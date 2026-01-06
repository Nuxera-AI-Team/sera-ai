import * as React from "react";
import useAudioCapture from "./hooks/useAudioCapture";
import { Mic, Square, Loader2, Pause, Play, AlertTriangle, Download } from "lucide-react";
import Toast from "./components/Toast";
import AudioVisualizerImproved from "./components/AudioVisualizerImproved";

// Embedded minimal Tailwind utilities (reusing from AudioRecorder)
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
  .justify-between { justify-content: space-between; }
  .flex-shrink-0 { flex-shrink: 0; }
  .h-5 { height: 1.25rem; }
  .w-5 { width: 1.25rem; }
  .text-orange-400 { color: rgb(251 146 60); }
  .ml-3 { margin-left: 0.75rem; }
  .mr-2 { margin-right: 0.5rem; }
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
  .from-purple-400 { --tw-gradient-from: #c084fc; --tw-gradient-to: rgb(192 132 252 / 0); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to); }
  .to-blue-500 { --tw-gradient-to: #3b82f6; }
  .hover\\:from-purple-500:hover { --tw-gradient-from: #a855f7; --tw-gradient-to: rgb(168 85 247 / 0); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to); }
  .hover\\:to-blue-600:hover { --tw-gradient-to: #2563eb; }
  .opacity-50 { opacity: 0.5; }
  .cursor-not-allowed { cursor: not-allowed; }
  .text-gray-600 { color: rgb(75 85 99); }
  .dark .dark\\:text-gray-300 { color: rgb(209 213 219); }
  .bg-gray-100 { background-color: rgb(243 244 246); }
  .dark .dark\\:bg-gray-800 { background-color: rgb(31 41 55); }
  .border-gray-200 { border-color: rgb(229 231 235); }
  .dark .dark\\:border-gray-700 { border-color: rgb(55 65 81); }
  .cursor-pointer { cursor: pointer; }
  .hover\\:bg-gray-200:hover { background-color: rgb(229 231 235); }
  .dark .dark\\:hover\\:bg-gray-700:hover { background-color: rgb(55 65 81); }
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

export interface AudioCaptureProps {
  /**
   * Callback function called when an audio chunk is processed
   */
  onAudioChunk?: (audioData: Float32Array, sequence: number, isFinal: boolean) => void;

  /**
   * Callback function called when recording is complete with the final audio
   */
  onAudioComplete?: (finalAudio: Float32Array) => void;

  /**
   * Callback function called with the processed audio file
   */
  onAudioFile?: (audioFile: File) => void;

  /**
   * Enable silence removal processing (optional, defaults to false)
   */
  silenceRemoval?: boolean;

  /**
   * Duration in seconds for each audio chunk (optional, defaults to 30)
   */
  chunkDuration?: number;

  /**
   * Output format for audio file (optional, defaults to "raw")
   */
  format?: "raw" | "wav";

  /**
   * Show download button for audio file (optional, defaults to false)
   */
  showDownload?: boolean;

  /**
   * Additional CSS class names
   */
  className?: string;

  /**
   * Custom styles
   */
  style?: React.CSSProperties;
}

const AudioCapture: React.FC<AudioCaptureProps> = ({
  onAudioChunk,
  onAudioComplete,
  onAudioFile,
  silenceRemoval = false,
  chunkDuration = 30,
  format = "raw",
  showDownload = false,
  className = "",
  style,
}) => {
  // Inject Tailwind styles on component mount
  React.useEffect(() => {
    injectTailwindStyles();
  }, []);

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
    availableDevices,
    currentDeviceId,
    selectMicrophone,
    validateMicrophoneAccess,
    audioLevel,
    noAudioDetected,
    isConverting,
    progress,
    statusMessage,
    recordingDuration,
    totalChunks,
  } = useAudioCapture({
    onAudioChunk,
    onAudioComplete,
    onAudioFile,
    silenceRemoval,
    chunkDuration,
    format,
  });

  const [isDisabled, setIsDisabled] = React.useState(false);
  const [lastAudioFile, setLastAudioFile] = React.useState<File | null>(null);

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

  // Handle audio file callback
  React.useEffect(() => {
    if (onAudioFile) {
      const originalCallback = onAudioFile;
      onAudioFile = (file: File) => {
        setLastAudioFile(file);
        originalCallback(file);
      };
    }
  }, [onAudioFile]);

  const handleStopClick = () => {
    setIsDisabled(true);
    stopRecording();
  };

  const handleStartRecording = () => {
    setIsDisabled(false);
    setLastAudioFile(null);
    startRecording();
  };

  const handleDownload = () => {
    if (lastAudioFile) {
      const url = URL.createObjectURL(lastAudioFile);
      const a = document.createElement('a');
      a.href = url;
      a.download = lastAudioFile.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setToast({
        show: true,
        message: `Downloaded ${lastAudioFile.name}`,
        type: "success"
      });
    }
  };

  React.useEffect(() => {
    if (error) {
      setToast({ show: true, message: error, type: "error" });
    }
  }, [error]);

  const closeToast = () => {
    setToast({ ...toast, show: false });
  };

  // Format duration
  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

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

  return (
    <div className="space-y-4">
      {toast.show && (
        <Toast message={toast.message} type={toast.type} onClose={closeToast} duration={3} />
      )}

      {/* Recording Info Display */}
      {(isRecording || isPaused || recordingDuration > 0) && (
        <div className="bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              <div className="flex space-x-4">
                <span>Duration: {formatDuration(recordingDuration)}</span>
                <span>Chunks: {totalChunks}</span>
                <span>Format: {format.toUpperCase()}</span>
                {silenceRemoval && <span>Silence Removal: ON</span>}
              </div>
            </div>
            {showDownload && lastAudioFile && (
              <button
                onClick={handleDownload}
                className="flex items-center space-x-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm transition-colors"
              >
                <Download className="h-3 w-3" />
                <span>Download</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Processing Status */}
      {(isProcessing || isConverting) && (
        <div className="flex items-center justify-center space-x-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <Loader2 className="animate-spin h-5 w-5 text-blue-600" />
          <div className="text-center">
            <span className="block text-sm font-medium text-blue-700 dark:text-blue-300">
              {isConverting ? `Processing Audio... ${Math.round(progress)}%` : "Processing audio chunk..."}
            </span>
            {statusMessage && (
              <span className="block text-xs text-blue-600 dark:text-blue-400 mt-1">
                {statusMessage}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Audio Visualizer */}
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
              isRecording={isRecording && !isPaused}
              forceLight={false}
            />
          </div>
        </div>
      )}

      {/* Control Buttons */}
      <div className="flex justify-center">
        {isProcessing ? (
          <div className="flex items-center justify-center space-x-2 bg-teal-600 hover:bg-teal-700 text-white py-2 px-4 rounded-full">
            <Loader2 className="animate-spin h-5 w-5" />
            <span>Processing...</span>
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
            {!isPaused ? (
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
            )}
          </div>
        ) : (
          <button
            className={
              className
                ? `flex items-center justify-center space-x-2 py-2 px-4 rounded-full transition-colors ${className}`
                : "flex items-center justify-center space-x-2 bg-gradient-to-r from-purple-400 to-blue-500 hover:bg-gradient-to-r hover:from-purple-500 hover:to-blue-600 text-white py-2 px-4 rounded-full transition-colors"
            }
            onClick={handleStartRecording}
          >
            <Mic className="h-5 w-5" />
            <span>Start Recording</span>
          </button>
        )}
      </div>

      {/* Microphone Selection */}
      {availableDevices.length > 1 && (
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Select Microphone:
          </label>
          <select
            value={currentDeviceId || ""}
            onChange={(e) => selectMicrophone(e.target.value)}
            className="w-full p-2 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            disabled={isRecording}
          >
            {availableDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};

export default AudioCapture;