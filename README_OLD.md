# Sera AI Audio Recorder

A React component library for real-time audio recording with AI-powered transcription. Works out of the box with embedded workers and no external dependencies.

## Features

- 🎙️ Real-time audio recording with visualization
- 🤖 AI-powered transcription via secure cloud API
- 🎯 Built-in noise reduction and audio processing
- 📦 Self-contained - no external files required
- 🎨 Built-in styling - no CSS framework needed
- ⚡ Zero configuration setup

## Installation

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
      <h1>My App</h1>
      <AudioRecorder />
    </div>
  );
}

export default App;
```

That's it! No configuration files, no worker files to copy, no CSS frameworks to install.

## Advanced Usage

### Custom API Endpoint

If you want to use your own transcription API:

```tsx
import { AudioRecorder } from 'sera-ai';

function App() {
  return (
    <AudioRecorder apiBaseUrl="https://your-api.com" />
  );
}
```

### Handle Transcription Results

```tsx
import { AudioRecorder } from 'sera-ai';

function App() {
  const handleTranscription = (text: string) => {
    console.log('Transcribed text:', text);
    // Process the transcribed text
  };

  const handleError = (error: string) => {
    console.error('Transcription error:', error);
  };

  return (
    <AudioRecorder 
      onTranscription={handleTranscription}
      onError={handleError}
    />
  );
}
```

## Component Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `apiBaseUrl` | `string` | `"https://nuxera.cloud"` | Base URL for transcription API |
| `onTranscription` | `(text: string) => void` | - | Callback for transcription results |
| `onError` | `(error: string) => void` | - | Callback for errors |

## Browser Requirements

- Modern browsers with Web Audio API support
- HTTPS required for microphone access (except localhost)
- SharedArrayBuffer support for audio processing

## Features in Detail

### Real-time Audio Processing
- Built-in noise reduction
- Automatic silence detection
- Medical-grade audio quality optimization

### AI Transcription
- Secure cloud-based processing
- Real-time streaming transcription
- Multiple language support

### Self-contained Design
- No external worker files to manage
- Embedded CSS styling
- All dependencies bundled

## Support

For issues and feature requests, please visit our [GitHub repository](https://github.com/nuxera/sera-ai).

## License

MIT