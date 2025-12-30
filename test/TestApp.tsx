import React from "react";
import { AudioRecorder } from "../src/index";

function TestApp() {
  return (
    <div style={{ padding: "20px", background: "lightblue" }}>
      <h1>Audio Recorder Test</h1>
      <h2>Simple Test - If you see this, React is working!</h2>
      <p>Now testing the AudioRecorder component:</p>

      <AudioRecorder
        apiKey="8f764fec-8fee-4d94-88b2-3486581d6bda"
        speciality="general_practice"
        apiBaseUrl="http://localhost:3000"
        onTranscriptionUpdate={(text, sessionId) => {
          console.log("Transcription update:", text, sessionId);
        }}
        onTranscriptionComplete={(text, classification, sessionId) => {
          console.log("Transcription complete:", text, classification, sessionId);
        }}
        onSuccess={(response) => {
          console.log("Success:", response);
        }}
        onError={(error) => {
          console.error("Error:", error);
        }}
      />
    </div>
  );
}

export default TestApp;
