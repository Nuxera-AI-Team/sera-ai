import * as React from "react";
import { Mic, Square, Loader2, AlertTriangle } from "lucide-react";
import useAudioDictation from "./hooks/useAudioDictation";

export interface AudioDictationProps {
  apiKey?: string;
  apiBaseUrl?: string;
  appendMode?: boolean;
  doctorName?: string;
  patientId?: string;
  sessionId?: string;
  language?: string;
  specialty?: string;
  selectedFormat?: "json" | "hl7" | "fhir";
  onDictationComplete: (message: string) => void;
  onDictationStart?: () => void;
  onProcessingStart?: () => void;
  onError?: (error: string) => void;
  className?: string;
  style?: React.CSSProperties;
  buttonText?: string;
  placeholder?: string;
}

// Embedded minimal Tailwind utilities for dictation component
const dictationStyles = `
  .dictation-button-recording {
    background: linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab);
    background-size: 400% 400%;
    animation: gradientShift 2s ease infinite;
  }
  
  @keyframes gradientShift {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }

  .dictation-pulse {
    animation: dictationPulse 1.5s ease-in-out infinite;
  }

  @keyframes dictationPulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.05); opacity: 0.8; }
  }

  .bg-blue-600 { background-color: rgb(37 99 235); }
  .hover\\:bg-blue-700:hover { background-color: rgb(29 78 216); }
  .bg-red-600 { background-color: rgb(220 38 38); }
  .hover\\:bg-red-700:hover { background-color: rgb(185 28 28); }
  .bg-gray-600 { background-color: rgb(75 85 99); }
  .hover\\:bg-gray-700:hover { background-color: rgb(55 65 81); }
  .text-white { color: rgb(255 255 255); }
  .flex { display: flex; }
  .items-center { align-items: center; }
  .justify-center { justify-content: center; }
  .space-x-2 > :not([hidden]) ~ :not([hidden]) { margin-left: 0.5rem; }
  .px-4 { padding-left: 1rem; padding-right: 1rem; }
  .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
  .rounded-lg { border-radius: 0.5rem; }
  .rounded-full { border-radius: 9999px; }
  .transition-all { transition-property: all; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
  .duration-200 { transition-duration: 200ms; }
  .disabled\\:opacity-50:disabled { opacity: 0.5; }
  .disabled\\:cursor-not-allowed:disabled { cursor: not-allowed; }
  .h-5 { height: 1.25rem; }
  .w-5 { width: 1.25rem; }
  .h-6 { height: 1.5rem; }
  .w-6 { width: 1.5rem; }
  .text-sm { font-size: 0.875rem; line-height: 1.25rem; }
  .font-medium { font-weight: 500; }
  .animate-spin { animation: spin 1s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .bg-red-50 { background-color: rgb(254 242 242); }
  .border { border-width: 1px; }
  .border-red-200 { border-color: rgb(254 202 202); }
  .text-red-800 { color: rgb(153 27 27); }
  .text-red-700 { color: rgb(185 28 28); }
  .p-3 { padding: 0.75rem; }
  .mt-2 { margin-top: 0.5rem; }
  .text-xs { font-size: 0.75rem; line-height: 1rem; }
`;

// Inject dictation styles only once
let dictationStylesInjected = false;
const injectDictationStyles = () => {
  if (!dictationStylesInjected && typeof document !== "undefined") {
    const styleElement = document.createElement("style");
    styleElement.textContent = dictationStyles;
    document.head.appendChild(styleElement);
    dictationStylesInjected = true;
  }
};

const AudioDictation: React.FC<AudioDictationProps> = ({
  apiKey,
  apiBaseUrl,
  appendMode = true,
  doctorName = "doctor",
  patientId,
  sessionId,
  language = "en",
  specialty = "general",
  selectedFormat = "json",
  onDictationComplete,
  onDictationStart,
  onProcessingStart,
  onError,
  className = "",
  style,
  buttonText,
  placeholder = "Click to dictate...",
}) => {
  // Inject styles on component mount
  React.useEffect(() => {
    injectDictationStyles();
  }, []);

  const { startDictating, stopDictating, dictationError, isDictating, isProcessing } = useAudioDictation({
    onDictationComplete,
    onDictationStart,
    onProcessingStart,
    onError,
    apiKey,
    apiBaseUrl,
    appendMode,
    doctorName,
    patientId,
    sessionId,
    language,
    specialty,
    selectedFormat,
  });

  // Handle click to toggle dictation
  const handleToggleDictation = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isProcessing) return;

    if (isDictating) {
      stopDictating();
    } else {
      startDictating();
    }
  };

  const getButtonContent = () => {
    if (isProcessing) {
      return (
        <>
          <Loader2 className="h-5 w-5 animate-spin" />
        </>
      );
    }

    if (isDictating) {
      return (
        <>
          <Square className="h-5 w-5" />
        </>
      );
    }

    return (
      <>
        <Mic className="h-5 w-5" />
      </>
    );
  };

  const getButtonClass = () => {
    const baseClass =
      "flex items-center justify-center space-x-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed";

    if (className) {
      return `${baseClass} ${className}`;
    }

    if (isProcessing) {
      return `${baseClass} bg-gray-600 text-white`;
    }

    if (isDictating) {
      return `${baseClass} dictation-button-recording text-white dictation-pulse`;
    }

    return `${baseClass} bg-blue-600 hover:bg-blue-700 text-white`;
  };

  if (dictationError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
        <div className="flex items-center space-x-2">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <div>
            <p className="text-sm font-medium text-red-800">Dictation Error</p>
            <p className="text-xs text-red-700 mt-1">{dictationError}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={style}>
      <button
        className={getButtonClass()}
        onClick={handleToggleDictation}
        disabled={isProcessing}
        title={isDictating ? "Click to stop dictating" : placeholder}
      >
        {getButtonContent()}
      </button>
    </div>
  );
};

export default AudioDictation;
