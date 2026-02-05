# Sera AI Audio Recorder

A React component library for real-time audio recording with AI-powered transcription. Works out of the box with embedded workers and no external dependencies.

## Features

- 🎙️ Real-time audio recording with live visualization
- 🤖 AI-powered transcription with medical speciality support
- 🎯 Built-in noise reduction and silence removal
- 📦 Self-contained - no external files or workers required
- 🎨 Built-in styling - no CSS framework dependencies
- 🔄 Automatic session recovery and retry functionality
- 📊 Multiple output formats (JSON, HL7, FHIR)
- 🎚️ Advanced audio controls (pause/resume, device selection)
- ⚡ Zero configuration setup

## Installation

```bash
npm install sera-ai lucide-react
```

**Note**: `lucide-react` is required as a peer dependency for the UI icons. If you already have it installed, you can just install:

```bash
npm install sera-ai
```

## Quick Start

```tsx
import React from 'react';
import { AudioRecorder } from 'sera-ai';

function App() {
  return (
    <div style={{ padding: '20px' }}>
      <h1>My Medical App</h1>
      <AudioRecorder
        apiKey="your-api-key"
        speciality="general_practice"
        onTranscriptionUpdate={(text, sessionId) => {
          console.log('Live transcription:', text);
        }}
        onTranscriptionComplete={(text, classification, sessionId) => {
          console.log('Final result:', text, classification);
        }}
      />
    </div>
  );
}

export default App;
```

No configuration files, no worker files to copy, no CSS frameworks to install.

---

## Components

Sera AI ships three components, each suited to a different use case:

| Component | Use Case |
|-----------|----------|
| [`AudioRecorder`](#audiorecorder) | Full-featured recording with live transcription, pause/resume, session recovery |
| [`AudioDictation`](#audiodictation) | Click-to-dictate button for short dictation tasks |
| [`AudioCapture`](#audiocapture) | Raw audio capture for custom server-side processing |

---

## AudioRecorder

The main component for real-time audio recording with AI-powered transcription. Provides a complete UI with start/stop/pause controls, live audio visualization, session recovery prompts, and error handling.

### Overview

- Records audio from the user's microphone via the Web Audio API
- Streams audio to the Sera AI cloud for real-time transcription
- Supports medical speciality-specific transcription models
- Automatically persists failed sessions to IndexedDB and offers retry
- Renders an animated waveform visualizer during recording
- Outputs results in JSON, HL7 v2.5, or FHIR R4 format

### Basic Usage

```tsx
import { AudioRecorder } from 'sera-ai';

function App() {
  return (
    <AudioRecorder
      apiKey="your-api-key"
      speciality="general_practice"
      onTranscriptionUpdate={(text, sessionId) => {
        console.log('Live transcription:', text);
      }}
      onTranscriptionComplete={(text, classification, sessionId) => {
        console.log('Final result:', text);
        console.log('Classification:', classification);
      }}
    />
  );
}
```

### Advanced Usage

#### With Patient Context and HL7 Output

```tsx
<AudioRecorder
  apiKey="your-api-key"
  apiBaseUrl="https://your-custom-api.com"
  speciality="cardiology"
  patientHistory="Patient has history of atrial fibrillation"
  patientDetails={{
    id: 12345,
    name: "John Doe",
    gender: "male",
    dateOfBirth: "1985-03-15",
    age: 40,
  }}
  selectedFormat="hl7"
  onTranscriptionUpdate={(text, sessionId) => {
    console.log('Real-time update:', text);
  }}
  onTranscriptionComplete={(text, classification, sessionId) => {
    console.log('HL7 result:', text);
  }}
  onSuccess={(data) => console.log('API success:', data)}
  onError={(error) => console.error('Error:', error)}
/>
```

#### Custom Styling

```tsx
<AudioRecorder
  apiKey="your-api-key"
  speciality="general_practice"
  className="my-custom-button-class"
  visualizerClassName="w-full max-w-2xl"
  style={{ margin: '20px auto' }}
/>
```

### Props Reference

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `apiKey` | `string` | **Yes** | — | Your Sera AI API key for authentication |
| `speciality` | `string` | **Yes** | — | Medical speciality for optimized transcription (e.g. `"general_practice"`, `"cardiology"`) |
| `apiBaseUrl` | `string` | No | `"https://nuxera.cloud"` | Base URL for the transcription API |
| `patientHistory` | `string` | No | — | Free-text patient history to provide context for transcription |
| `patientDetails` | [`PatientDetails`](#patientdetails) | No | — | Structured patient information |
| `selectedFormat` | `"json" \| "hl7" \| "fhir"` | No | `"json"` | Output format for the transcription result |
| `onTranscriptionUpdate` | `(text: string, sessionId: string) => void` | No | — | Called with live transcription text as audio is processed in real time |
| `onTranscriptionComplete` | `(text: string, classification: ClassificationInfoResponse, sessionId: string) => void` | No | — | Called when the full transcription and medical classification are ready |
| `onSuccess` | `(data: any) => void` | No | — | Called when the API request succeeds |
| `onError` | `(error: string) => void` | No | — | Called when an error occurs (microphone issues, API failures, etc.) |
| `className` | `string` | No | `""` | CSS class applied to the start recording button |
| `visualizerClassName` | `string` | No | `""` | CSS class applied to the audio visualizer container (defaults to `max-w-lg` if empty) |
| `style` | `React.CSSProperties` | No | — | Inline styles applied to the root container |

### UI States

The component automatically manages these visual states:

| State | UI |
|-------|-----|
| **Idle** | Gradient start button with microphone icon |
| **Recording** | Live waveform visualizer + Stop/Pause buttons |
| **Paused** | Stop/Resume buttons (visualizer hidden) |
| **Processing** | Teal spinner with "Processing..." label |
| **Complete** | Green "Transcription Complete" badge |
| **Session Recovery** | Yellow prompt offering "Retry Transcription" or "Clear Saved Sessions" |
| **Microphone Error** | Red error panel with "Check Again" button |
| **No Audio Detected** | Orange warning with troubleshooting checklist |

### Features

- **Real-time visualization** — Animated waveform with particle effects during recording
- **Pause/Resume** — Pause recording without losing progress
- **Session recovery** — Failed sessions are saved to IndexedDB and can be retried
- **Auto microphone validation** — Detects missing or silent microphones on start
- **Toast notifications** — Shows errors as temporary toast messages
- **Dark mode support** — All error/warning panels support light and dark themes
- **Self-contained styles** — Embeds minimal Tailwind CSS utilities; no framework required

---

## AudioDictation

A click-to-dictate button component for short dictation tasks. Click to start recording, click again to stop — the audio is sent for transcription and the result is returned via callback.

### Overview

- Single-button interface: click to start, click to stop
- Animated gradient button while recording
- Automatic transcription on stop
- Supports JSON, HL7, and FHIR output formats
- Built-in error display with alert panel

### Basic Usage

```tsx
import React, { useState } from 'react';
import { AudioDictation } from 'sera-ai';

function DictationApp() {
  const [dictatedText, setDictatedText] = useState('');

  return (
    <div style={{ padding: '20px' }}>
      <h1>Medical Dictation</h1>

      <AudioDictation
        apiKey="your-api-key"
        doctorName="Dr. Smith"
        patientId="12345"
        specialty="cardiology"
        selectedFormat="json"
        onDictationComplete={(text) => {
          setDictatedText(prev => prev + ' ' + text);
        }}
      />

      <div style={{ marginTop: '20px', padding: '10px', border: '1px solid #ccc' }}>
        <h3>Dictated Text:</h3>
        <p>{dictatedText}</p>
      </div>
    </div>
  );
}
```

### Advanced Usage

#### With All Callbacks and Custom Styling

```tsx
<AudioDictation
  apiKey="your-api-key"
  apiBaseUrl="https://your-custom-api.com"
  appendMode={true}
  doctorName="Dr. Garcia"
  patientId="patient-789"
  sessionId="session-001"
  language="en"
  specialty="radiology"
  selectedFormat="fhir"
  onDictationComplete={(text) => console.log('Dictation:', text)}
  onDictationStart={() => console.log('Started recording')}
  onProcessingStart={() => console.log('Processing audio...')}
  onError={(error) => console.error('Dictation error:', error)}
  className="my-custom-button"
  style={{ display: 'inline-block' }}
  buttonText="Dictate Note"
  placeholder="Click to start dictating"
/>
```

### Props Reference

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `apiKey` | `string` | No | — | Your Sera AI API key |
| `apiBaseUrl` | `string` | No | — | Custom base URL for the transcription API |
| `appendMode` | `boolean` | No | `true` | Whether to append to existing text in the transcription session |
| `doctorName` | `string` | No | `"doctor"` | Doctor's name included in the transcription context |
| `patientId` | `string` | No | — | Patient identifier for the dictation session |
| `sessionId` | `string` | No | — | Session identifier for grouping dictation segments |
| `language` | `string` | No | `"en"` | Language code for dictation |
| `specialty` | `string` | No | `"general"` | Medical specialty for optimized transcription |
| `selectedFormat` | `"json" \| "hl7" \| "fhir"` | No | `"json"` | Output format for the transcription result |
| `onDictationComplete` | `(text: string) => void` | **Yes** | — | Called with the transcribed text when dictation finishes processing |
| `onDictationStart` | `() => void` | No | — | Called when recording begins |
| `onProcessingStart` | `() => void` | No | — | Called when recording stops and processing begins |
| `onError` | `(error: string) => void` | No | — | Called when a dictation error occurs |
| `className` | `string` | No | `""` | CSS class applied to the dictation button (overrides default styling) |
| `style` | `React.CSSProperties` | No | — | Inline styles applied to the root container |
| `buttonText` | `string` | No | — | Custom button text (button shows icons only by default) |
| `placeholder` | `string` | No | `"Click to dictate..."` | Tooltip text shown on hover |

### UI States

| State | UI |
|-------|-----|
| **Idle** | Blue button with microphone icon |
| **Dictating** | Animated gradient button with stop icon and pulse animation |
| **Processing** | Gray button with spinner (disabled) |
| **Error** | Red alert panel with error details |

### Features

- **Click-to-toggle** — Click to start recording, click again to stop and transcribe
- **Visual feedback** — Animated gradient background and pulse effect while recording
- **Lifecycle callbacks** — `onDictationStart`, `onProcessingStart`, and `onDictationComplete` for full control
- **Error display** — Replaces button with an alert panel on errors
- **Multiple formats** — JSON, HL7 v2.5, and FHIR R4 output
- **Self-contained styles** — Embeds its own CSS animations and utilities

---

## AudioCapture

A raw audio capture component for applications that handle transcription on their own servers. Records, processes, and optionally compresses audio, then returns the data via callbacks instead of sending it to the Sera AI cloud.

### Overview

- Captures audio from the user's microphone with configurable chunk duration
- Returns raw `Float32Array` data or processed WAV files
- Optional FFmpeg-based silence removal
- Full recording controls: start, stop, pause, resume
- Microphone device selection UI
- Live waveform visualization
- No API key required — audio stays on your side

### Basic Usage

```tsx
import { AudioCapture } from 'sera-ai';

function AudioCaptureApp() {
  const handleAudioChunk = (
    audioData: Float32Array,
    sequence: number,
    isFinal: boolean,
    sampleRate: number
  ) => {
    console.log(`Chunk ${sequence} (${sampleRate}Hz):`, audioData.length, 'samples');
    sendAudioToMyServer(audioData, sequence, isFinal);
  };

  const handleAudioComplete = (finalAudio: Float32Array, sampleRate: number) => {
    console.log('Recording complete!', finalAudio.length, 'samples at', sampleRate, 'Hz');
  };

  return (
    <AudioCapture
      onAudioChunk={handleAudioChunk}
      onAudioComplete={handleAudioComplete}
      chunkDuration={30}
      format="raw"
    />
  );
}
```

### Advanced Usage

#### WAV Output with Silence Removal and Download

```tsx
<AudioCapture
  onAudioFile={(audioFile) => {
    console.log('Audio file:', audioFile.name, audioFile.size, 'bytes');
    uploadFileToMyServer(audioFile);
  }}
  onAudioChunk={(audioData, sequence, isFinal, sampleRate) => {
    console.log(`Streaming chunk ${sequence} at ${sampleRate}Hz, final=${isFinal}`);
  }}
  onAudioComplete={(finalAudio, sampleRate) => {
    console.log('Complete recording:', finalAudio.length / sampleRate, 'seconds');
  }}
  silenceRemoval={true}
  chunkDuration={15}
  format="wav"
  showDownload={true}
  visualizerClassName="w-full max-w-2xl"
  style={{ padding: '20px' }}
/>
```

### Props Reference

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `onAudioChunk` | `(audioData: Float32Array, sequence: number, isFinal: boolean, sampleRate: number) => void` | No | — | Called for each audio chunk during recording. `sequence` is 0-indexed, `isFinal` is `true` on the last chunk |
| `onAudioComplete` | `(finalAudio: Float32Array, sampleRate: number) => void` | No | — | Called when recording stops with the final combined audio buffer |
| `onAudioFile` | `(audioFile: File) => void` | No | — | Called with a processed audio `File` object (raw or WAV depending on `format`) |
| `silenceRemoval` | `boolean` | No | `false` | Enable FFmpeg-based silence detection and removal |
| `chunkDuration` | `number` | No | `30` | Duration in seconds for each audio chunk |
| `format` | `"raw" \| "wav"` | No | `"raw"` | Output format for the audio file provided to `onAudioFile` |
| `showDownload` | `boolean` | No | `false` | Show a download button in the recording info bar |
| `className` | `string` | No | `""` | CSS class applied to the start recording button |
| `visualizerClassName` | `string` | No | `""` | CSS class applied to the visualizer container (defaults to `max-w-lg` if empty) |
| `style` | `React.CSSProperties` | No | — | Inline styles applied to the root container |

### UI States

| State | UI |
|-------|-----|
| **Idle** | Purple-to-blue gradient start button with microphone icon |
| **Recording** | Live waveform visualizer + recording info bar (duration, chunks, format) + Stop/Pause buttons |
| **Paused** | Stop/Resume buttons (visualizer hidden), recording info bar persists |
| **Processing / Converting** | Blue spinner with progress percentage and status message |
| **Microphone Error** | Red error panel with "Check Again" button |
| **No Audio Detected** | Orange warning with troubleshooting checklist |

### Recording Info Bar

While recording, a status bar displays:
- **Duration** — Current recording time in `M:SS` format
- **Chunks** — Number of audio chunks processed so far
- **Format** — Current output format (RAW or WAV)
- **Silence Removal** — Indicator when enabled
- **Download button** — Appears after recording when `showDownload` is `true`

### Server Integration Example

```tsx
// Client-side: send chunks to your server
const sendAudioToServer = async (
  audioData: Float32Array,
  sequence: number,
  isFinal: boolean,
  sampleRate: number
) => {
  const formData = new FormData();
  formData.append('audio', new Blob([audioData.buffer]), 'chunk.raw');
  formData.append('sequence', sequence.toString());
  formData.append('isFinal', isFinal.toString());
  formData.append('sampleRate', sampleRate.toString());

  const response = await fetch('/api/process-audio', {
    method: 'POST',
    body: formData,
  });

  return response.json();
};
```

```javascript
// Server-side (Node.js example)
app.post('/api/process-audio', upload.single('audio'), async (req, res) => {
  try {
    const { sequence, isFinal, sampleRate } = req.body;
    const audioFile = req.file;

    // Forward to Nuxera API or your own transcription service
    const transcriptionResponse = await fetch('https://nuxera.cloud/v1/transcribe', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${YOUR_API_KEY}` },
      body: createFormData(audioFile, { sequence, isFinal, sampleRate }),
    });

    const transcription = await transcriptionResponse.json();

    res.json({
      success: true,
      transcription: transcription.text,
      sequence: parseInt(sequence),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### Features

- **Chunk-based streaming** — Configurable chunk duration for real-time streaming or batch processing
- **Multiple output formats** — Raw `Float32Array` data or processed WAV files
- **Silence removal** — Optional FFmpeg WASM-based silence detection and removal
- **Pause/Resume** — Pause recording without losing accumulated audio
- **Device selection** — Microphone selector dropdown when multiple devices are available
- **Live visualization** — Animated waveform display during recording
- **Download support** — Optional download button for the recorded audio file
- **Audio level monitoring** — Real-time audio input level detection
- **Self-contained** — Embeds its own styles and audio processing workers

---

## Shared Types

### PatientDetails

```typescript
interface PatientDetails {
  id?: number;
  name?: string;
  gender?: string;
  dateOfBirth?: Date | string;
  age?: number;
}
```

### ClassificationInfoResponse

Returned in the `onTranscriptionComplete` callback of `AudioRecorder`:

```typescript
interface ClassificationInfoResponse {
  speciality: string;
  generatedAt: string;
  classifiedInfo: {
    [sectionName: string]: string[];
  };
}
```

### APIResponse

Generic API response wrapper:

```typescript
interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
```

---

## Medical Specialties Supported

- `general_practice`
- `cardiology`
- `emergency`
- `in_patient`
- `radiology`
- `pathology`
- `surgery`
- `pediatrics`
- `psychiatry`
- And more...

## Browser Requirements

- Modern browsers with Web Audio API support
- HTTPS required for microphone access (except localhost)
- Microphone permissions required
- Recommended: Chrome 88+, Firefox 85+, Safari 14+

## Exports

```typescript
// Components
export { AudioRecorder } from 'sera-ai';
export { AudioDictation } from 'sera-ai';
export { AudioCapture } from 'sera-ai';

// Types
export type { AudioRecorderProps, APIResponse, APIOptions } from 'sera-ai';
export type { AudioDictationProps } from 'sera-ai';
export type { AudioCaptureProps } from 'sera-ai';
```

## Support

For issues and feature requests, please visit our [GitHub repository](https://github.com/Nuxera-AI-Team/sera-ai).

For API keys and enterprise support, contact [support@nuxera.com](mailto:support@nuxera.com).

## License

MIT