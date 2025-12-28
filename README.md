# Sera AI Audio Recorder

Nuxera ambient scribing audio recorder component for React applications.

## Installation

```bash
npm install sera-ai
```

## Peer Dependencies

This package requires the following peer dependencies to be installed in your project:

```bash
npm install react react-dom lucide-react
```

**Supported versions:**
- **React:** 16.8.0+, 17.x, 18.x, 19.x
- **Lucide React:** 0.500.0+

## Usage

```tsx
import React from 'react';
import { AudioRecorder } from 'sera-ai';

function App() {
  return (
    <AudioRecorder
      apiKey="your-api-key"
      speciality="general"
      patientId={123}
      patientName="John Doe"
      onTranscriptionUpdate={(text, sessionId) => {
        console.log('Transcription update:', text);
      }}
      onTranscriptionComplete={(text, classification, sessionId) => {
        console.log('Transcription complete:', text, classification);
      }}
      onSuccess={(response) => {
        console.log('Success:', response);
      }}
      onError={(error) => {
        console.error('Error:', error);
      }}
    />
  );
}

export default App;
```

## Troubleshooting

### Invalid Hook Call Error

If you encounter "Invalid hook call" errors, this is typically due to:

1. **Multiple React versions**: Ensure only one version of React is installed
   ```bash
   npm ls react
   ```

2. **Bundling issues**: Make sure your bundler (Webpack, Vite, etc.) treats React as an external dependency for this package

3. **Version mismatch**: Ensure your React version is compatible with the supported versions listed above

### Checking for Multiple React Versions

```bash
# Check for duplicate React installations
npm ls react
npm ls react-dom

# If duplicates exist, try:
npm dedupe
```

## Features

- Audio recording with real-time transcription
- Multiple audio format support
- Session recovery and retry functionality
- Audio visualization
- Microphone access validation
- Customizable UI styling

## API Reference

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `apiKey` | `string` | Yes | Your API key for the transcription service |
| `speciality` | `string` | Yes | Medical speciality context |
| `patientId` | `number` | No | Patient identifier |
| `patientName` | `string` | No | Patient name |
| `onTranscriptionUpdate` | `function` | No | Callback for real-time transcription updates |
| `onTranscriptionComplete` | `function` | No | Callback when transcription is complete |
| `onSuccess` | `function` | No | Success callback |
| `onError` | `function` | No | Error callback |
| `className` | `string` | No | CSS class name for styling |
| `style` | `object` | No | Inline styles |

## License

ISC
Nuxera ambiant scribing
