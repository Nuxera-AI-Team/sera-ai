import React, { useState } from "react";
import { AudioDictation, AudioRecorder } from "../src";
import useAudioRecorder from "../src/hooks/useAudioRecorder";

const AudioTestPanel = () => {
  const { testAudioCapture, validateMicrophoneAccess, audioLevel, isRecording } = useAudioRecorder({
    apiKey: "test-key",
    speciality: "general_practice",
    onTranscriptionUpdate: () => {},
    onTranscriptionComplete: () => {},
  });

  return (
    <div
      style={{
        backgroundColor: "#e8f4fd",
        padding: "20px",
        borderRadius: "8px",
        marginBottom: "20px",
      }}
    >
      <h3 style={{ margin: "0 0 15px 0", color: "#0366d6" }}>Audio Capture Testing</h3>
      <div style={{ display: "flex", gap: "10px", marginBottom: "15px" }}>
        <button
          onClick={testAudioCapture}
          style={{
            padding: "8px 16px",
            backgroundColor: "#0366d6",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Test Audio Capture
        </button>
        <button
          onClick={validateMicrophoneAccess}
          style={{
            padding: "8px 16px",
            backgroundColor: "#28a745",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Validate Microphone
        </button>
      </div>
      <div style={{ fontSize: "14px", color: "#586069" }}>
        <p>
          Audio Level: <span style={{ fontWeight: "bold" }}>{audioLevel.toFixed(4)}</span>
        </p>
        <p>
          Recording:{" "}
          <span style={{ fontWeight: "bold", color: isRecording ? "green" : "red" }}>
            {isRecording ? "YES" : "NO"}
          </span>
        </p>
        <p style={{ fontSize: "12px", marginTop: "10px" }}>
          Open browser console to see detailed audio capture logs
        </p>
      </div>
    </div>
  );
};

const formatMedicalNote = (classifiedInfo?: Record<string, string[]>): string => {
  if (!classifiedInfo || Object.keys(classifiedInfo).length === 0) {
    return "";
  }

  return Object.entries(classifiedInfo)
    .map(([section, items]) => {
      const safeItems = Array.isArray(items) ? items : [];
      const formattedItems = safeItems.map((item) => `- ${item}`).join("\n");
      return `${section}:\n${formattedItems}`;
    })
    .join("\n\n");
};

const TestApp = () => {
  const [transcriptionResult, setTranscriptionResult] = useState<string>("");
  const [medicalNoteResult, setMedicalNoteResult] = useState<string>("");
  const [dictationResult, setDictationResult] = useState<string>("");
  const [errorResult, setErrorResult] = useState<string>("");

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f5f5" }}>
      <div style={{ padding: "40px", maxWidth: "600px", margin: "0 auto" }}>
        <h1 style={{ color: "#333", marginBottom: "20px" }}>Sera AI Test Example</h1>

        <AudioTestPanel />

        <p style={{ color: "#666", marginBottom: "30px", lineHeight: "1.6" }}>
          This example shows how to use the component with a custom API endpoint and handle
          transcription results.
        </p>

        <div
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: "8px",
            padding: "20px",
            marginBottom: "20px",
            backgroundColor: "#ffffff",
          }}
        >
          <h3 style={{ margin: "0 0 16px 0", color: "#2f3a4f" }}>Transcription</h3>
          <AudioRecorder
            apiBaseUrl="http://localhost:3000"
            apiKey="8f764fec-8fee-4d94-88b2-3486581d6bda"
            speciality="general_practice"
            onTranscriptionComplete={(text, classification) => {
              console.log("Custom API transcription:", text);
              setTranscriptionResult(text);
              setMedicalNoteResult(formatMedicalNote(classification?.classifiedInfo));
              setErrorResult("");
            }}
            onError={(error) => {
              console.error("Custom API error:", error);
              setErrorResult(error);
            }}
          />
        </div>

        <div
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: "8px",
            padding: "20px",
            marginBottom: "30px",
            backgroundColor: "#ffffff",
          }}
        >
          <h3 style={{ margin: "0 0 16px 0", color: "#2f3a4f" }}>Dictation</h3>
          <AudioDictation
            apiKey="8f764fec-8fee-4d94-88b2-3486581d6bda"
            apiBaseUrl="http://localhost:3000"
            doctorName="Dr. Smith"
            onDictationStart={() => {
              console.log("--- Dictation started");
            }}
            onProcessingStart={() => {
              console.log(" --- Processing started");
            }}
            onDictationComplete={(text) => {
              console.log("Dictated:", text);
              setDictationResult(text);
            }}
          />
        </div>

        <div
          style={{
            backgroundColor: "#f8f9fa",
            padding: "16px",
            borderRadius: "8px",
            marginBottom: "16px",
          }}
        >
          <h4 style={{ margin: "0 0 8px 0", color: "#333" }}>Transcription Result:</h4>
          <p
            style={{
              margin: 0,
              fontFamily: "monospace",
              backgroundColor: "#fff",
              padding: "8px",
              borderRadius: "4px",
              border: "1px solid #ddd",
              whiteSpace: "pre-wrap",
            }}
          >
            {transcriptionResult || "(Transcriptions will appear here)"}
          </p>
        </div>

        <div
          style={{
            backgroundColor: "#f3f1ff",
            padding: "16px",
            borderRadius: "8px",
            marginBottom: "16px",
          }}
        >
          <h4 style={{ margin: "0 0 8px 0", color: "#3f2a71" }}>Dictation Result:</h4>
          <p
            style={{
              margin: 0,
              fontFamily: "monospace",
              backgroundColor: "#fff",
              padding: "8px",
              borderRadius: "4px",
              border: "1px solid #ddd",
              whiteSpace: "pre-wrap",
            }}
          >
            {dictationResult || "(Dictation will appear here)"}
          </p>
        </div>

        <div
          style={{
            backgroundColor: "#eef7ff",
            padding: "16px",
            borderRadius: "8px",
            marginBottom: "16px",
          }}
        >
          <h4 style={{ margin: "0 0 8px 0", color: "#1b4a6b" }}>Medical Note:</h4>
          <p
            style={{
              margin: 0,
              fontFamily: "monospace",
              backgroundColor: "#fff",
              padding: "8px",
              borderRadius: "4px",
              border: "1px solid #ddd",
              whiteSpace: "pre-wrap",
            }}
          >
            {medicalNoteResult || "(Medical note will appear here)"}
          </p>
        </div>

        <div
          style={{
            backgroundColor: "#fff3cd",
            padding: "16px",
            borderRadius: "8px",
            marginBottom: "16px",
          }}
        >
          <h4 style={{ margin: "0 0 8px 0", color: "#856404" }}>Error Messages:</h4>
          <p
            style={{
              margin: 0,
              fontFamily: "monospace",
              backgroundColor: "#fff",
              padding: "8px",
              borderRadius: "4px",
              border: "1px solid #ddd",
              whiteSpace: "pre-wrap",
            }}
          >
            {errorResult || "(Errors will appear here)"}
          </p>
        </div>
      </div>
    </div>
  );
};

export default TestApp;
