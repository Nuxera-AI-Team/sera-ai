import React, { useEffect, useState } from "react";
import { AudioDictation, AudioRecorder } from "../src";
import AudioCapture from "../src/AudioCapture";
import useAudioRecorder from "../src/hooks/useAudioRecorder";

const apiKey = "8f764fec-8fee-4d94-88b2-3486581d6bda";

const AudioTestPanel = () => {
  const { testAudioCapture, validateMicrophoneAccess, audioLevel, isRecording } = useAudioRecorder({
    apiKey: apiKey,
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
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [audioPreviewId, setAudioPreviewId] = useState<string | null>(null);
  const [audioPreviewSampleRate, setAudioPreviewSampleRate] = useState<number | null>(null);
  const apiBackend =
    (import.meta as any).env?.VITE_API_BACKEND ||
    ((globalThis as any).process?.env?.NEXT_PUBLIC_API_BACKEND as string | undefined) ||
    "http://localhost:3000";

  const cleanupAudioPreview = () => {
    if (audioPreviewUrl) {
      window.URL.revokeObjectURL(audioPreviewUrl);
      setAudioPreviewUrl(null);
      setAudioPreviewId(null);
      setAudioPreviewSampleRate(null);
    }
  };

  useEffect(() => {
    return () => {
      cleanupAudioPreview();
    };
  }, [audioPreviewUrl]);

  const handleAudioChunk = (
    audioData: Float32Array,
    sequence: number,
    isFinal: boolean,
    sampleRate: number
  ) => {
    console.log(`Received audio chunk ${sequence}:`, {
      length: audioData.length,
      duration: audioData.length / sampleRate,
      isFinal,
    });
  };

  const handleAudioComplete = (finalAudio: Float32Array, sampleRate: number) => {
    console.log("Recording complete! Final audio:", {
      length: finalAudio.length,
      duration: finalAudio.length / sampleRate,
      sizeInMB: (finalAudio.length * 4) / (1024 * 1024),
    });
  };

  const handleAudioFile = (audioFile: File) => {
    console.log("Audio file created:", {
      name: audioFile.name,
      size: audioFile.size,
      type: audioFile.type,
    });
  };

  const downloadLastSessionAudio = async () => {
    if (!lastSessionId || !apiKey) {
      alert("No session available for download yet.");
      return;
    }

    try {
      setIsDownloading(true);
      const res = await fetch(`${apiBackend}/api/transcribe/download-audio/${lastSessionId}`, {
        headers: {
          "x-api-key": String(apiKey),
        },
      });

      if (!res.ok) {
        let errorMsg = "Failed to download audio";
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const error = await res.json();
          errorMsg = error.error || errorMsg;
        } else if (res.status === 404) {
          errorMsg = "Audio file not found. It may still be processing or unavailable.";
        }
        setIsDownloading(false);
        alert(errorMsg);
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `encounter-${lastSessionId}-audio.wav`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setIsDownloading(false);
    } catch (err) {
      setIsDownloading(false);
      alert("Failed to download audio");
      console.error(err);
    }
  };

  const handlePreviewAudio = async () => {
    if (!lastSessionId || !apiKey) {
      alert("No session available for preview yet.");
      return;
    }

    if (audioPreviewId === lastSessionId) {
      cleanupAudioPreview();
      return;
    }

    try {
      setAudioPreviewId(lastSessionId);
      setAudioPreviewUrl(null);
      const res = await fetch(`${apiBackend}/api/transcribe/download-audio/${lastSessionId}`, {
        headers: {
          "x-api-key": String(apiKey),
        },
      });

      if (!res.ok) {
        let errorMsg = "Failed to load audio";
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const error = await res.json();
          errorMsg = error.error || errorMsg;
        } else if (res.status === 404) {
          errorMsg = "Audio file not found. It may still be processing or unavailable.";
        }
        console.error("[Preview] Error response:", errorMsg);
        alert(errorMsg);
        setAudioPreviewId(null);
        return;
      }

      const contentType = res.headers.get("content-type") || "audio/wav";
      const blob = await res.blob();
      let fixedBlob = blob;
      if (!blob.type || blob.type === "" || blob.type === "application/octet-stream") {
        try {
          fixedBlob = new Blob([blob], { type: contentType });
        } catch (e) {
          console.warn("[Preview] Failed to fix blob type for Safari:", e);
        }
      }

      try {
        const buffer = await fixedBlob.arrayBuffer();
        if (buffer.byteLength >= 28) {
          const view = new DataView(buffer);
          const riff = String.fromCharCode(
            view.getUint8(0),
            view.getUint8(1),
            view.getUint8(2),
            view.getUint8(3)
          );
          const wave = String.fromCharCode(
            view.getUint8(8),
            view.getUint8(9),
            view.getUint8(10),
            view.getUint8(11)
          );
          if (riff === "RIFF" && wave === "WAVE") {
            setAudioPreviewSampleRate(view.getUint32(24, true));
          } else {
            setAudioPreviewSampleRate(null);
          }
        }
      } catch (parseError) {
        console.warn("[Preview] Failed to parse WAV header:", parseError);
        setAudioPreviewSampleRate(null);
      }

      const url = window.URL.createObjectURL(fixedBlob);
      setAudioPreviewUrl(url);

      setTimeout(() => {
        const audioElem = document.querySelector(
          'audio[src="' + url + '"]'
        ) as HTMLAudioElement | null;
        if (audioElem) {
          audioElem.load();
          audioElem.pause();
          audioElem.currentTime = 0;
          audioElem.play().catch((err) => {
            console.warn("[Preview] Safari play() error:", err);
          });
        }
      }, 100);
    } catch (err) {
      console.error("[Preview] Exception:", err);
      alert("Failed to load audio");
      setAudioPreviewId(null);
    }
  };

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
            apiKey={apiKey}
            speciality="general_practice"
            patientDetails={{
              id: 122,
              name: "Jane Doe",
              gender: "female",
              dateOfBirth: "11/02/1999",
              age: 26,
            }}
            compressionType="opus"
            onTranscriptionComplete={(text, classification, sessionId) => {
              console.log("Custom API transcription:", text);
              setTranscriptionResult(text);
              setMedicalNoteResult(formatMedicalNote(classification?.classifiedInfo));
              setErrorResult("");
              setLastSessionId(sessionId || null);
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
            apiKey={apiKey}
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
            backgroundColor: "#fdf6f0",
            padding: "16px",
            borderRadius: "8px",
            marginBottom: "16px",
          }}
        >
          <h4 style={{ margin: "0 0 8px 0", color: "#5c3a1e" }}>Audio Download & Preview:</h4>
          <p style={{ margin: "0 0 12px 0", color: "#7a5a3a", fontSize: "14px" }}>
            Session ID: {lastSessionId || "(No transcription yet)"}
          </p>
          <p style={{ margin: "0 0 12px 0", color: "#7a5a3a", fontSize: "14px" }}>
            Preview sample rate:{" "}
            {audioPreviewSampleRate ? `${audioPreviewSampleRate} Hz` : "(Unknown)"}
          </p>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              onClick={downloadLastSessionAudio}
              disabled={!lastSessionId || isDownloading}
              style={{
                padding: "8px 16px",
                backgroundColor: lastSessionId && !isDownloading ? "#9c5c2a" : "#d3c2b4",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: lastSessionId && !isDownloading ? "pointer" : "not-allowed",
              }}
            >
              {isDownloading ? "Downloading..." : "Download Audio"}
            </button>
            <button
              onClick={handlePreviewAudio}
              disabled={!lastSessionId}
              style={{
                padding: "8px 16px",
                backgroundColor: lastSessionId ? "#5d7aa6" : "#c5d0df",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: lastSessionId ? "pointer" : "not-allowed",
              }}
            >
              {audioPreviewId === lastSessionId ? "Stop Preview" : "Preview Audio"}
            </button>
          </div>
          {audioPreviewUrl ? (
            <div style={{ marginTop: "12px" }}>
              <audio controls src={audioPreviewUrl} style={{ width: "100%" }} />
            </div>
          ) : null}
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

        <div
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: "8px",
            padding: "20px",
            marginBottom: "30px",
            backgroundColor: "#ffffff",
          }}
        >
          <h3 style={{ margin: "0 0 16px 0", color: "#2f3a4f" }}>Audio Capture</h3>
          <div style={{ marginBottom: "20px" }}>
            <h4 style={{ margin: "0 0 8px 0", color: "#333" }}>Basic Recording (Raw Audio)</h4>
            <AudioCapture
              onAudioChunk={handleAudioChunk}
              onAudioComplete={handleAudioComplete}
              chunkDuration={30}
              format="raw"
              showDownload={true}
            />
          </div>
          <div>
            <h4 style={{ margin: "0 0 8px 0", color: "#333" }}>
              Recording with Silence Removal (WAV Format)
            </h4>
            <AudioCapture
              onAudioFile={handleAudioFile}
              silenceRemoval={true}
              chunkDuration={15}
              format="wav"
              showDownload={true}
              className="custom-recording-button"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestApp;
