import React, { useState } from "react";
import { AudioRecorder } from "../src";
import useAudioRecorder from "../src/hooks/useAudioRecorder";

const AudioTestPanel = () => {
  const { testAudioCapture, validateMicrophoneAccess, audioLevel, isRecording } = useAudioRecorder({
    apiKey: "test-key",
    speciality: "general_practice",
    onTranscriptionUpdate: () => {},
    onTranscriptionComplete: () => {},
  });

  return (
    <div style={{
      backgroundColor: "#e8f4fd",
      padding: "20px",
      borderRadius: "8px",
      marginBottom: "20px"
    }}>
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
            cursor: "pointer"
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
            cursor: "pointer"
          }}
        >
          Validate Microphone
        </button>
      </div>
      <div style={{ fontSize: "14px", color: "#586069" }}>
        <p>Audio Level: <span style={{ fontWeight: "bold" }}>{audioLevel.toFixed(4)}</span></p>
        <p>Recording: <span style={{ fontWeight: "bold", color: isRecording ? "green" : "red" }}>
          {isRecording ? "YES" : "NO"}
        </span></p>
        <p style={{ fontSize: "12px", marginTop: "10px" }}>
          Open browser console to see detailed audio capture logs
        </p>
      </div>
    </div>
  );
};

const TestApp = () => {
  const [currentView, setCurrentView] = useState<"simple" | "advanced">("simple");

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f5f5" }}>
      {/* Navigation */}
      <nav
        style={{
          backgroundColor: "#fff",
          padding: "16px 20px",
          borderBottom: "1px solid #e0e0e0",
          marginBottom: "0",
        }}
      >
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <h2 style={{ margin: 0, color: "#333" }}>Sera AI Test Examples</h2>
          <button
            onClick={() => setCurrentView("simple")}
            style={{
              padding: "8px 16px",
              backgroundColor: currentView === "simple" ? "#007bff" : "#fff",
              color: currentView === "simple" ? "#fff" : "#007bff",
              border: "1px solid #007bff",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Simple Example
          </button>
          <button
            onClick={() => setCurrentView("advanced")}
            style={{
              padding: "8px 16px",
              backgroundColor: currentView === "advanced" ? "#007bff" : "#fff",
              color: currentView === "advanced" ? "#fff" : "#007bff",
              border: "1px solid #007bff",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Advanced Example
          </button>
        </div>
      </nav>

      {/* Content */}
      {currentView === "simple" ? (
        <div />
      ) : (
        <div style={{ padding: "40px", maxWidth: "600px", margin: "0 auto" }}>
          <h1 style={{ color: "#333", marginBottom: "20px" }}>Advanced Example with Custom API</h1>

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
              marginBottom: "30px",
            }}
          >
            <AudioRecorder
              apiBaseUrl="http://localhost:3000"
              apiKey="8f764fec-8fee-4d94-88b2-3486581d6bda"
              speciality="general_practice"
              onTranscriptionComplete={(text) => {
                console.log("Custom API transcription:", text);
                const resultElement = document.getElementById("transcription-result");
                if (resultElement) {
                  resultElement.innerText = "Latest transcription: " + text;
                }
              }}
              onError={(error) => {
                console.error("Custom API error:", error);
                const errorElement = document.getElementById("error-result");
                if (errorElement) {
                  errorElement.innerText = "Error: " + error;
                }
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
              id="transcription-result"
              style={{
                margin: 0,
                fontFamily: "monospace",
                backgroundColor: "#fff",
                padding: "8px",
                borderRadius: "4px",
                border: "1px solid #ddd",
              }}
            >
              (Transcriptions will appear here)
            </p>
          </div>

          <div
            style={{
              backgroundColor: "#fff3cd",
              padding: "16px",
              borderRadius: "8px",
            }}
          >
            <h4 style={{ margin: "0 0 8px 0", color: "#856404" }}>Error Messages:</h4>
            <p
              id="error-result"
              style={{
                margin: 0,
                fontFamily: "monospace",
                backgroundColor: "#fff",
                padding: "8px",
                borderRadius: "4px",
                border: "1px solid #ddd",
              }}
            >
              (Errors will appear here)
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default TestApp;
