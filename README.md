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

That's it! No configuration files, no worker files to copy, no CSS frameworks to install.

## Audio Dictation Component

For shorter dictation tasks, use the `AudioDictation` component which provides push-to-talk functionality:

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

### AudioDictation Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `apiKey` | `string` | - | Your Sera AI API key |
| `appendMode` | `boolean` | `true` | Whether to append to existing text |
| `doctorName` | `string` | `"doctor"` | Doctor's name for the dictation |
| `patientId` | `string` | - | Patient identifier |
| `sessionId` | `string` | - | Session identifier |
| `language` | `string` | `"en"` | Language code for dictation |
| `specialty` | `string` | `"general"` | Medical specialty |
| `selectedFormat` | `"json" \| "hl7" \| "fhir"` | `"json"` | Output format |
| `onDictationComplete` | `(text: string) => void` | **Required** | Callback when dictation is complete |
| `className` | `string` | - | Custom CSS classes |
| `style` | `CSSProperties` | - | Inline styles |
| `buttonText` | `string` | `"Hold to Dictate"` | Custom button text |
| `placeholder` | `string` | `"Click and hold to dictate..."` | Tooltip text |

### AudioDictation Features

- **Push-to-talk**: Hold mouse button or spacebar to dictate
- **Mobile support**: Touch and hold on mobile devices
- **Visual feedback**: Button animates while recording
- **Error handling**: Built-in error display and recovery
- **Multiple formats**: Support for JSON, HL7, and FHIR output
- **Real-time processing**: Immediate transcription after release

## Advanced Usage

### Medical Specialties

The component supports various medical specialties for optimized transcription:

```tsx
<AudioRecorder
  apiKey="your-api-key"
  speciality="cardiology" // or "emergency", "radiology", "pathology", etc.
  patientId={123}
  patientName="John Doe"
/>
```

### Custom API Endpoint

```tsx
<AudioRecorder
  apiKey="your-api-key"
  apiBaseUrl="https://your-custom-api.com"
  speciality="general_practice"
/>
```

### Multiple Output Formats

```tsx
<AudioRecorder
  apiKey="your-api-key"
  speciality="general_practice"
  selectedFormat="hl7" // "json", "hl7", or "fhir"
/>
```

### Advanced Audio Settings

```tsx
<AudioRecorder
  apiKey="your-api-key"
  speciality="general_practice"
  silenceRemoval={true}
  skipDiarization={false}
  onTranscriptionUpdate={(text, sessionId) => {
    console.log('Real-time updates:', text);
  }}
  onTranscriptionComplete={(text, classification, sessionId) => {
    console.log('Complete transcription:', text);
    console.log('Medical classification:', classification);
  }}
/>
```

## Component Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `apiKey` | `string` | **Required** | Your Sera AI API key |
| `apiBaseUrl` | `string` | `"https://nuxera.cloud"` | Base URL for transcription API |
| `speciality` | `string` | **Required** | Medical speciality for optimized transcription |
| `patientId` | `number` | - | Optional patient identifier |
| `patientName` | `string` | - | Optional patient name |
| `selectedFormat` | `"json" \| "hl7" \| "fhir"` | `"json"` | Output format for transcription |
| `skipDiarization` | `boolean` | `true` | Skip speaker identification |
| `silenceRemoval` | `boolean` | `true` | Enable automatic silence removal |
| `onTranscriptionUpdate` | `(text: string, sessionId: string) => void` | **Required** | Real-time transcription updates |
| `onTranscriptionComplete` | `(text: string, classification: any, sessionId: string) => void` | **Required** | Final transcription with medical classification |
| `className` | `string` | - | Custom CSS classes |
| `style` | `CSSProperties` | - | Inline styles |

## Features in Detail

### Real-time Audio Processing
- Advanced noise reduction and echo cancellation
- Automatic silence detection and removal
- Medical-grade audio quality optimization
- Live audio level visualization
- Automatic microphone validation

### AI Transcription
- Medical speciality-specific models
- Real-time streaming transcription
- Automatic session recovery on failures
- Support for multiple output formats (JSON, HL7, FHIR)
- Medical terminology classification

### Self-contained Design
- No external worker files to manage
- Embedded CSS styling (no framework required)
- All audio processing workers bundled
- Zero configuration setup

### Session Recovery
- Automatic offline storage of audio data
- Retry failed transcriptions
- Resume interrupted sessions
- Network failure resilience

## Browser Requirements

- Modern browsers with Web Audio API support
- HTTPS required for microphone access (except localhost)
- Microphone permissions required
- Recommended: Chrome 88+, Firefox 85+, Safari 14+

## Medical Specialties Supported

- `general_practice`
- `cardiology`
- `emergency`
- `radiology`
- `pathology`
- `surgery`
- `pediatrics`
- `psychiatry`
- And more...

## Error Handling

The component includes comprehensive error handling:

```tsx
<AudioRecorder
  apiKey="your-api-key"
  speciality="general_practice"
  onTranscriptionUpdate={(text, sessionId) => {
    // Handle real-time updates
  }}
  onTranscriptionComplete={(text, classification, sessionId) => {
    // Handle completion
  }}
  onError={(error) => {
    console.error('Transcription error:', error);
  }}
/>
```

## Audio Controls

The component provides built-in controls for:
- Start/Stop recording
- Pause/Resume functionality
- Microphone device selection
- Audio level monitoring
- Session retry management

## API Integration

Works seamlessly with the Sera AI cloud platform:
- Secure API key authentication
- Encrypted audio transmission
- HIPAA-compliant processing
- Real-time streaming protocols

## Support

For issues and feature requests, please visit our [GitHub repository](https://github.com/nuxera/sera-ai).

For API keys and enterprise support, contact [support@nuxera.com](mailto:support@nuxera.com).

## License

MIT