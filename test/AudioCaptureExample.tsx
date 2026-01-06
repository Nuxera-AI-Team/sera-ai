import React from "react";
import AudioCapture from "../src/AudioCapture";

const AudioCaptureExample: React.FC = () => {
  const handleAudioChunk = (audioData: Float32Array, sequence: number, isFinal: boolean) => {
    console.log(`Received audio chunk ${sequence}:`, {
      length: audioData.length,
      duration: audioData.length / 44100,
      isFinal,
    });

    // You can send this audio data to your server here
    // For example:
    // sendAudioToMyServer(audioData, sequence, isFinal);
  };

  const handleAudioComplete = (finalAudio: Float32Array) => {
    console.log("Recording complete! Final audio:", {
      length: finalAudio.length,
      duration: finalAudio.length / 44100,
      sizeInMB: (finalAudio.length * 4) / (1024 * 1024), // Float32 = 4 bytes per sample
    });

    // You can send the complete audio to your server here
    // sendCompleteAudioToMyServer(finalAudio);
  };

  const handleAudioFile = (audioFile: File) => {
    console.log("Audio file created:", {
      name: audioFile.name,
      size: audioFile.size,
      type: audioFile.type,
    });

    // You can send this file to your server
    // uploadAudioFileToMyServer(audioFile);
  };

  return (
    <div style={{ padding: "20px", maxWidth: "600px", margin: "0 auto" }}>
      <h1>Audio Capture Example</h1>

      <h2>Basic Recording (Raw Audio)</h2>
      <AudioCapture
        onAudioChunk={handleAudioChunk}
        onAudioComplete={handleAudioComplete}
        chunkDuration={30} // 30 seconds per chunk
        format="raw"
        showDownload={true}
      />

      <h2>Recording with Silence Removal (WAV Format)</h2>
      <AudioCapture
        onAudioFile={handleAudioFile}
        silenceRemoval={true}
        chunkDuration={15} // 15 seconds per chunk
        format="wav"
        showDownload={true}
        className="custom-recording-button"
      />

      <div
        style={{
          marginTop: "40px",
          padding: "20px",
          backgroundColor: "#f5f5f5",
          borderRadius: "8px",
        }}
      >
        <h3>Usage Instructions:</h3>
        <ul>
          <li>
            <strong>onAudioChunk</strong>: Called for each audio chunk during recording
          </li>
          <li>
            <strong>onAudioComplete</strong>: Called when recording stops with the final combined
            audio
          </li>
          <li>
            <strong>onAudioFile</strong>: Called with a File object (raw or WAV format)
          </li>
          <li>
            <strong>silenceRemoval</strong>: Automatically remove silent parts from audio
          </li>
          <li>
            <strong>chunkDuration</strong>: How often to send audio chunks (in seconds)
          </li>
          <li>
            <strong>format</strong>: "raw" for Float32Array data, "wav" for WAV file format
          </li>
          <li>
            <strong>showDownload</strong>: Show a download button for the recorded audio
          </li>
        </ul>

        <h4>Sending Audio to Your Server:</h4>
        <p>
          You can send the audio data to your own server in the callback functions. Your server can
          then call the Nuxera transcription API with the audio data.
        </p>

        <h4>Example Server Integration:</h4>
        <pre
          style={{
            backgroundColor: "#e5e5e5",
            padding: "10px",
            borderRadius: "4px",
            fontSize: "14px",
          }}
        >
          {`// In your callback function:
const sendToMyServer = async (audioData, sequence, isFinal) => {
  const formData = new FormData();
  
  if (audioData instanceof Float32Array) {
    // Convert Float32Array to WAV file
    const wavFile = createWavFile(audioData);
    formData.append('audio', wavFile);
  } else {
    // Already a File object
    formData.append('audio', audioData);
  }
  
  formData.append('sequence', sequence.toString());
  formData.append('isFinal', isFinal.toString());
  
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    body: formData
  });
  
  const result = await response.json();
  console.log('Transcription result:', result);
};`}
        </pre>
      </div>
    </div>
  );
};

export default AudioCaptureExample;
