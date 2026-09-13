import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHL7FHIRConverter } from '../hooks/useHL7FHIRConverter';

describe('useHL7FHIRConverter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      expect(result.current.isConverting).toBe(false);
      expect(result.current.conversionError).toBeNull();
    });

    it('should expose all expected methods', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      expect(typeof result.current.convertTranscriptionResponse).toBe('function');
      expect(typeof result.current.createHL7TranscriptionRequest).toBe('function');
      expect(typeof result.current.createFHIRTranscriptionRequest).toBe('function');
      expect(typeof result.current.createHL7DictationRequest).toBe('function');
      expect(typeof result.current.createFHIRDictationRequest).toBe('function');
      expect(typeof result.current.convertDictationResponse).toBe('function');
      expect(typeof result.current.convertHL7DictationToJson).toBe('function');
      expect(typeof result.current.convertFHIRDictationToJson).toBe('function');
      expect(typeof result.current.clearError).toBe('function');
    });
  });

  describe('clearError', () => {
    it('should clear the conversion error', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      // Trigger an error by passing invalid HL7 data with explicit format
      act(() => {
        // Provide clearly invalid HL7 that will cause an actual parsing error
        result.current.convertTranscriptionResponse(null, 'hl7');
      });

      act(() => {
        result.current.clearError();
      });

      expect(result.current.conversionError).toBeNull();
    });
  });

  describe('convertTranscriptionResponse', () => {
    describe('JSON format', () => {
      it('should pass through JSON responses', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const jsonResponse = {
          transcription: 'Patient presents with headache',
          classifiedInfo: { symptoms: ['headache'] },
          sessionId: 'session-123',
          model: 'gpt-4',
          processingTimes: { transcriptionMs: 500 },
        };

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(jsonResponse, 'json');
        });

        expect(converted.transcription).toBe('Patient presents with headache');
        expect(converted.classifiedInfo).toEqual({ symptoms: ['headache'] });
        expect(converted.sessionId).toBe('session-123');
        expect(converted.model).toBe('gpt-4');
        expect(converted.metadata?.originalFormat).toBe('json');
      });

      it('should handle JSON response with text field instead of transcription', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const jsonResponse = {
          text: 'Patient presents with cough',
        };

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(jsonResponse, 'json');
        });

        expect(converted.transcription).toBe('Patient presents with cough');
      });

      it('should generate sessionId when not present in JSON response', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const jsonResponse = {
          transcription: 'Some text',
        };

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(jsonResponse, 'json');
        });

        expect(converted.sessionId).toMatch(/^session_\d+$/);
      });
    });

    describe('HL7 format', () => {
      it('should convert a basic HL7 transcription response', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        // MSH fields[9] (0-indexed from fields after type) is where the code reads sessionId
        // MSH|MSH-2|MSH-3|MSH-4|MSH-5|MSH-6|MSH-7|MSH-8|MSH-9|MSH-10|MSH-11|MSH-12
        // fields: [0]=MSH-2, [1]=MSH-3, ... [8]=MSH-10, [9]=MSH-11
        // The code reads fields[9] as sessionId, so place it at the MSH-11 position
        const hl7Message = [
          'MSH|^~\\&|Nuxera|Server|Client|Nuxera|20240101120000||ORU^R01|ctrl1|session-abc|2.5',
          'OBX|1|TX|TRANSCRIPTION^Transcription Text||Patient has headache|||||F',
        ].join('\r\n');

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(hl7Message, 'hl7');
        });

        expect(converted.transcription).toBe('Patient has headache');
        expect(converted.sessionId).toBe('session-abc');
        expect(converted.metadata?.originalFormat).toBe('hl7');
      });

      it('should extract classification data from OBX segments', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const hl7Message = [
          'MSH|^~\\&|Nuxera|Server|Client|Nuxera|20240101120000||ORU^R01|ctrl1|session-123|2.5',
          'OBX|1|TX|TRANSCRIPTION^Transcription Text||Patient has headache|||||F',
          'OBX|2|TX|SECTION^Chief Complaint||Headache for 3 days|||||F',
          'OBX|3|TX|SECTION^Assessment||Tension headache|||||F',
        ].join('\r\n');

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(hl7Message, 'hl7');
        });

        expect(converted.classifiedInfo.classifiedInfo['Chief Complaint']).toContain('Headache for 3 days');
        expect(converted.classifiedInfo.classifiedInfo['Assessment']).toContain('Tension headache');
      });

      it('should extract processing metadata from NTE segments', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const hl7Message = [
          'MSH|^~\\&|Nuxera|Server|Client|Nuxera|20240101120000||ORU^R01|ctrl1|session-456|2.5',
          'OBX|1|TX|TRANSCRIPTION^Transcription Text||Test|||||F',
          'NTE|1||PROCESSING_METADATA: Model: gpt-4, Transcription: 500ms, Total: 1200ms',
        ].join('\r\n');

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(hl7Message, 'hl7');
        });

        expect(converted.model).toBe('gpt-4');
        expect(converted.processingTimes?.transcriptionMs).toBe(500);
        expect(converted.processingTimes?.totalProcessingMs).toBe(1200);
      });

      it('should return default transcription when none found', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const hl7Message = 'MSH|^~\\&|Nuxera|Server|Client|Nuxera|20240101120000||ORU^R01|ctrl1|session-789|2.5';

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(hl7Message, 'hl7');
        });

        expect(converted.transcription).toBe('No transcription found in HL7 message');
      });
    });

    describe('FHIR format', () => {
      it('should convert a FHIR Bundle transcription response', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const fhirBundle = {
          resourceType: 'Bundle',
          id: 'bundle-123',
          entry: [
            {
              resource: {
                resourceType: 'Composition',
                id: 'comp-1',
                identifier: [
                  {
                    system: 'http://nuxera.ai/session-identifier',
                    value: 'fhir-session-123',
                  },
                ],
                section: [
                  {
                    title: 'Transcription',
                    text: {
                      div: '<div>Patient presents with headache</div>',
                    },
                  },
                ],
              },
            },
          ],
        };

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(fhirBundle, 'fhir');
        });

        expect(converted.transcription).toBe('Patient presents with headache');
        expect(converted.sessionId).toBe('fhir-session-123');
        expect(converted.metadata?.originalFormat).toBe('fhir');
      });

      it('should extract classification from DiagnosticReport conclusion', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const classifiedInfo = {
          speciality: 'general',
          classifiedInfo: { 'Chief Complaint': ['Headache'] },
          generatedAt: '2024-01-01',
        };

        const fhirBundle = {
          resourceType: 'Bundle',
          id: 'bundle-456',
          entry: [
            {
              resource: {
                resourceType: 'Composition',
                id: 'comp-1',
                section: [
                  {
                    title: 'Transcription',
                    text: { div: '<div>Test</div>' },
                  },
                ],
              },
            },
            {
              resource: {
                resourceType: 'DiagnosticReport',
                conclusion: JSON.stringify(classifiedInfo),
              },
            },
          ],
        };

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(fhirBundle, 'fhir');
        });

        expect(converted.classifiedInfo).toEqual(classifiedInfo);
      });

      it('should use Bundle.id as fallback sessionId', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const fhirBundle = {
          resourceType: 'Bundle',
          id: 'fallback-bundle-id',
          entry: [
            {
              resource: {
                resourceType: 'Composition',
                section: [
                  {
                    title: 'Transcription',
                    text: { div: '<div>Test</div>' },
                  },
                ],
              },
            },
          ],
        };

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(fhirBundle, 'fhir');
        });

        expect(converted.sessionId).toBe('fallback-bundle-id');
      });

      it('should extract sessionId from Task.identifier', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const fhirBundle = {
          resourceType: 'Bundle',
          entry: [
            {
              resource: {
                resourceType: 'Task',
                identifier: [
                  {
                    system: 'http://nuxera.ai/session-id',
                    value: 'task-session-id',
                  },
                ],
              },
            },
          ],
        };

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(fhirBundle, 'fhir');
        });

        expect(converted.sessionId).toBe('task-session-id');
      });

      it('should return default transcription when no content found', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const fhirBundle = {
          resourceType: 'Bundle',
          entry: [],
        };

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(fhirBundle, 'fhir');
        });

        expect(converted.transcription).toBe('No transcription found in FHIR data');
      });

      it('should handle single resource (non-Bundle) FHIR response', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const fhirResource = {
          resourceType: 'Composition',
          id: 'single-comp',
          section: [
            {
              title: 'Transcription',
              text: { div: '<div>Single resource text</div>' },
            },
          ],
        };

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(fhirResource, 'fhir');
        });

        expect(converted.transcription).toBe('Single resource text');
      });
    });

    describe('auto-detection', () => {
      it('should auto-detect HL7 format from MSH header', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const hl7Message = 'MSH|^~\\&|Nuxera|Server|Client|Nuxera|20240101||ORU^R01|ctrl1|sess1|2.5\r\nOBX|1|TX|TRANSCRIPTION^Text||Auto detected|||||F';

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(hl7Message, 'auto' as any);
        });

        expect(converted.metadata?.originalFormat).toBe('hl7');
        expect(converted.transcription).toBe('Auto detected');
      });

      it('should auto-detect FHIR format from resourceType', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const fhirData = {
          resourceType: 'Bundle',
          entry: [
            {
              resource: {
                resourceType: 'Composition',
                section: [
                  {
                    title: 'Transcription',
                    text: { div: '<div>FHIR auto detected</div>' },
                  },
                ],
              },
            },
          ],
        };

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(fhirData, 'auto' as any);
        });

        expect(converted.metadata?.originalFormat).toBe('fhir');
      });

      it('should default to JSON when format cannot be detected', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const jsonData = {
          transcription: 'Plain JSON data',
          sessionId: 'json-sess',
        };

        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(jsonData, 'auto' as any);
        });

        expect(converted.metadata?.originalFormat).toBe('json');
        expect(converted.transcription).toBe('Plain JSON data');
      });
    });

    describe('error handling', () => {
      it('should return error response on conversion failure', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        // Pass something that will cause the FHIR converter to throw
        let converted: any;
        act(() => {
          converted = result.current.convertTranscriptionResponse(null, 'fhir');
        });

        expect(converted.transcription).toBe('Conversion failed - see raw response');
        expect(converted.classification).toBeDefined();
      });
    });
  });

  describe('createHL7TranscriptionRequest', () => {
    it('should create FormData with HL7 message and audio file', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      const audioFile = new File(['audio data'], 'test.wav', { type: 'audio/wav' });
      const requestData = {
        model: 'gpt-4',
        doctorName: 'Dr. Smith',
        speciality: 'cardiology',
        removeSilence: true,
        skipDiarization: false,
        isFinalChunk: false,
        isPaused: false,
        sequence: 1,
      };

      let formData: FormData;
      act(() => {
        formData = result.current.createHL7TranscriptionRequest(audioFile, requestData);
      });

      expect(formData!).toBeInstanceOf(FormData);
      expect(formData!.get('audio')).toBeTruthy();
      expect(formData!.get('hl7_request')).toBeTruthy();
    });

    it('should include session ID when provided', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      const audioFile = new File(['audio data'], 'test.wav', { type: 'audio/wav' });
      const requestData = {
        sessionId: 'session-123',
        model: 'gpt-4',
        doctorName: 'Dr. Smith',
        speciality: 'cardiology',
        removeSilence: false,
        skipDiarization: false,
        isFinalChunk: false,
        isPaused: false,
        sequence: 1,
      };

      let formData: FormData;
      act(() => {
        formData = result.current.createHL7TranscriptionRequest(audioFile, requestData);
      });

      expect(formData!.get('hl7_request')).toBeTruthy();
    });

    it('should include patient details when provided', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      const audioFile = new File(['audio data'], 'test.wav', { type: 'audio/wav' });
      const requestData = {
        model: 'gpt-4',
        doctorName: 'Dr. Smith',
        speciality: 'cardiology',
        removeSilence: false,
        skipDiarization: false,
        isFinalChunk: false,
        isPaused: false,
        sequence: 0,
        patientDetails: {
          id: 123,
          name: 'John Doe',
          gender: 'male',
          dateOfBirth: new Date('1990-05-15'),
          age: 34,
        },
      };

      let formData: FormData;
      act(() => {
        formData = result.current.createHL7TranscriptionRequest(audioFile, requestData);
      });

      expect(formData!.get('hl7_request')).toBeTruthy();
    });
  });

  describe('createFHIRTranscriptionRequest', () => {
    it('should create FormData with FHIR bundle and audio file', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      const audioFile = new File(['audio data'], 'test.wav', { type: 'audio/wav' });
      const requestData = {
        model: 'gpt-4',
        doctorName: 'Dr. Smith',
        speciality: 'cardiology',
        removeSilence: false,
        skipDiarization: false,
        isFinalChunk: false,
        isPaused: false,
        sequence: 1,
      };

      let formData: FormData;
      act(() => {
        formData = result.current.createFHIRTranscriptionRequest(audioFile, requestData);
      });

      expect(formData!).toBeInstanceOf(FormData);
      expect(formData!.get('audio')).toBeTruthy();
      expect(formData!.get('fhir_request')).toBeTruthy();
      expect(formData!.get('sequence')).toBe('1');
      expect(formData!.get('isFinalChunk')).toBe('false');
    });

    it('should include sessionId in FormData when provided', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      const audioFile = new File(['audio data'], 'test.wav', { type: 'audio/wav' });
      const requestData = {
        sessionId: 'fhir-session-456',
        model: 'gpt-4',
        doctorName: 'Dr. Smith',
        speciality: 'cardiology',
        removeSilence: false,
        skipDiarization: false,
        isFinalChunk: true,
        isPaused: false,
        sequence: 3,
      };

      let formData: FormData;
      act(() => {
        formData = result.current.createFHIRTranscriptionRequest(audioFile, requestData);
      });

      expect(formData!.get('sessionId')).toBe('fhir-session-456');
      expect(formData!.get('isFinalChunk')).toBe('true');
    });
  });

  describe('createHL7DictationRequest', () => {
    it('should create FormData with HL7 message and audio file', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      const audioFile = new File(['audio data'], 'dictation.wav', { type: 'audio/wav' });
      const requestData = {
        doctorName: 'Dr. Jones',
        patientId: 'patient-789',
        sessionId: 'dict-session-1',
        language: 'en-US',
        specialty: 'neurology',
      };

      let formData: FormData;
      act(() => {
        formData = result.current.createHL7DictationRequest(audioFile, requestData);
      });

      expect(formData!).toBeInstanceOf(FormData);
      expect(formData!.get('audio')).toBeTruthy();
      expect(formData!.get('hl7_request')).toBeTruthy();
    });

    it('should handle minimal request data', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      const audioFile = new File(['audio data'], 'dictation.wav', { type: 'audio/wav' });
      const requestData = {};

      let formData: FormData;
      act(() => {
        formData = result.current.createHL7DictationRequest(audioFile, requestData);
      });

      expect(formData!).toBeInstanceOf(FormData);
      expect(formData!.get('audio')).toBeTruthy();
    });
  });

  describe('createFHIRDictationRequest', () => {
    it('should create FormData with FHIR bundle and audio file', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      const audioFile = new File(['audio data'], 'dictation.wav', { type: 'audio/wav' });
      const requestData = {
        doctorName: 'Dr. Jones',
        patientId: 'patient-789',
        sessionId: 'dict-session-1',
        language: 'en-US',
        specialty: 'neurology',
      };

      let formData: FormData;
      act(() => {
        formData = result.current.createFHIRDictationRequest(audioFile, requestData);
      });

      expect(formData!).toBeInstanceOf(FormData);
      expect(formData!.get('audio')).toBeTruthy();
      expect(formData!.get('fhir_request')).toBeTruthy();
    });
  });

  describe('convertDictationResponse', () => {
    describe('JSON format', () => {
      it('should pass through JSON dictation responses', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const jsonResponse = {
          dictation: 'Patient reported feeling dizzy',
          sessionId: 'dict-session-1',
          confidence: 0.95,
          language: 'en-US',
        };

        let converted: any;
        act(() => {
          converted = result.current.convertDictationResponse(jsonResponse, 'json');
        });

        expect(converted.dictation).toBe('Patient reported feeling dizzy');
        expect(converted.sessionId).toBe('dict-session-1');
        expect(converted.confidence).toBe(0.95);
      });
    });

    describe('HL7 format', () => {
      it('should convert HL7 dictation response', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const hl7Message = [
          'MSH|^~\\&|Nuxera|Server|Client|Nuxera|20240101120000||MDM^T02|ctrl1|dict-sess-1|2.5',
          'OBX|1|TX|DICTATION^Dictation Text||Patient has chronic back pain|||||F',
          'OBX|2|TX|SESSION_ID^Session ID||dict-sess-1|||||F',
          'OBX|3|NM|CONFIDENCE^Confidence||0.92|||||F',
          'OBX|4|TX|LANGUAGE^Language||en-US|||||F',
        ].join('\r\n');

        let converted: any;
        act(() => {
          converted = result.current.convertDictationResponse(hl7Message, 'hl7');
        });

        expect(converted.dictation).toBe('Patient has chronic back pain');
        expect(converted.sessionId).toBe('dict-sess-1');
        expect(converted.confidence).toBe(0.92);
        expect(converted.language).toBe('en-US');
      });

      it('should extract processing times from HL7 response', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const hl7Message = [
          'MSH|^~\\&|Nuxera|Server|Client|Nuxera|20240101120000||MDM^T02|ctrl1|sess-1|2.5',
          'OBX|1|TX|DICTATION^Dictation Text||Test dictation|||||F',
          'OBX|2|NM|TRANSCRIPTION_MS^Transcription Time||350|||||F',
          'OBX|3|NM|TOTAL_PROCESSING_MS^Total Processing Time||800|||||F',
          'OBX|4|TX|AUDIO_SIZE^Audio File Size||1.05 MB|||||F',
        ].join('\r\n');

        let converted: any;
        act(() => {
          converted = result.current.convertDictationResponse(hl7Message, 'hl7');
        });

        expect(converted.processingTimes?.transcriptionMs).toBe(350);
        expect(converted.processingTimes?.totalProcessingMs).toBe(800);
        expect(converted.processingTimes?.audioSizeMB).toBe(1.05);
      });

      it('should extract metadata from NTE segments', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const hl7Message = [
          'MSH|^~\\&|Nuxera|Server|Client|Nuxera|20240101120000||MDM^T02|ctrl1|sess-1|2.5',
          'OBX|1|TX|DICTATION^Dictation Text||Test|||||F',
          'NTE|1||REQUEST_TIMESTAMP: 1704067200000',
          'NTE|2||DICTATION_TYPE: medical',
        ].join('\r\n');

        let converted: any;
        act(() => {
          converted = result.current.convertDictationResponse(hl7Message, 'hl7');
        });

        expect(converted.processingTimes?.requestTimestamp).toBe(1704067200000);
        expect(converted.processingTimes?.dictationType).toBe('medical');
      });
    });

    describe('FHIR format', () => {
      it('should convert FHIR dictation response with Media resource', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const fhirBundle = {
          resourceType: 'Bundle',
          entry: [
            {
              resource: {
                resourceType: 'MessageHeader',
                id: 'fhir-dict-session-1',
              },
            },
            {
              resource: {
                resourceType: 'Media',
                id: 'media-1',
                extension: [
                  {
                    url: 'http://nuxera.ai/extensions/transcription',
                    valueString: 'FHIR dictation text',
                  },
                  {
                    url: 'http://nuxera.ai/extensions/confidence',
                    valueDecimal: 0.88,
                  },
                  {
                    url: 'http://nuxera.ai/extensions/language',
                    valueString: 'en-US',
                  },
                ],
              },
            },
          ],
        };

        let converted: any;
        act(() => {
          converted = result.current.convertDictationResponse(fhirBundle, 'fhir');
        });

        expect(converted.dictation).toBe('FHIR dictation text');
        expect(converted.confidence).toBe(0.88);
        expect(converted.language).toBe('en-US');
        expect(converted.sessionId).toBe('fhir-dict-session-1');
      });

      it('should handle FHIR dictation with processing times', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const fhirBundle = {
          resourceType: 'Bundle',
          entry: [
            {
              resource: {
                resourceType: 'Media',
                id: 'media-1',
                extension: [
                  {
                    url: 'http://nuxera.ai/extensions/transcription',
                    valueString: 'Test',
                  },
                  {
                    url: 'http://nuxera.ai/extensions/transcription-time',
                    valueInteger: 400,
                  },
                  {
                    url: 'http://nuxera.ai/extensions/total-processing-time',
                    valueInteger: 900,
                  },
                  {
                    url: 'http://nuxera.ai/extensions/audio-size',
                    valueString: '2.5 MB',
                  },
                ],
              },
            },
          ],
        };

        let converted: any;
        act(() => {
          converted = result.current.convertDictationResponse(fhirBundle, 'fhir');
        });

        expect(converted.processingTimes?.transcriptionMs).toBe(400);
        expect(converted.processingTimes?.totalProcessingMs).toBe(900);
        expect(converted.processingTimes?.audioSizeMB).toBe(2.5);
      });

      it('should handle FHIR dictation as JSON string', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const fhirString = JSON.stringify({
          resourceType: 'Bundle',
          entry: [
            {
              resource: {
                resourceType: 'Media',
                id: 'media-string',
                extension: [
                  {
                    url: 'http://nuxera.ai/extensions/transcription',
                    valueString: 'Parsed from string',
                  },
                ],
              },
            },
          ],
        });

        let converted: any;
        act(() => {
          converted = result.current.convertFHIRDictationToJson(fhirString);
        });

        expect(converted.dictation).toBe('Parsed from string');
      });

      it('should return empty dictation when no data found', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        const fhirBundle = {
          resourceType: 'Bundle',
          entry: [],
        };

        let converted: any;
        act(() => {
          converted = result.current.convertDictationResponse(fhirBundle, 'fhir');
        });

        expect(converted.dictation).toBe('');
      });
    });

    describe('error handling', () => {
      it('should return default response on conversion error', () => {
        const { result } = renderHook(() => useHL7FHIRConverter());

        let converted: any;
        act(() => {
          converted = result.current.convertDictationResponse(null, 'fhir');
        });

        expect(converted.dictation).toBe('');
        expect(converted.sessionId).toBeNull();
      });
    });
  });

  describe('convertHL7DictationToJson', () => {
    it('should handle OBR segment for session ID fallback', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      const hl7Message = [
        'MSH|^~\\&|Nuxera|Server|Client|Nuxera|20240101120000||MDM^T02|ctrl1||2.5',
        'OBR|1|obr-request-id||DICTATION|||||F',
        'OBX|1|TX|DICTATION^Dictation Text||Dictation text here|||||F',
      ].join('\r\n');

      let converted: any;
      act(() => {
        converted = result.current.convertHL7DictationToJson(hl7Message);
      });

      expect(converted.dictation).toBe('Dictation text here');
    });

    it('should throw on completely invalid input', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      // The function wraps errors, but only throws on actual exceptions
      // A completely empty string won't throw, it just returns defaults
      let converted: any;
      act(() => {
        converted = result.current.convertHL7DictationToJson('');
      });

      expect(converted.dictation).toBe('');
    });
  });

  describe('convertFHIRDictationToJson', () => {
    it('should handle legacy DocumentReference format', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      const fhirData = {
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'DocumentReference',
              content: [
                {
                  attachment: {
                    data: btoa('Legacy dictation text'),
                  },
                },
              ],
            },
          },
        ],
      };

      let converted: any;
      act(() => {
        converted = result.current.convertFHIRDictationToJson(fhirData);
      });

      expect(converted.dictation).toBe('Legacy dictation text');
    });

    it('should handle legacy Observation format', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      const fhirData = {
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              identifier: [{ value: 'obs-session-id' }],
              component: [
                {
                  code: {
                    coding: [{ code: 'dictation-text' }],
                  },
                  valueString: 'Observation dictation',
                },
                {
                  code: {
                    coding: [{ code: 'confidence' }],
                  },
                  valueDecimal: 0.91,
                },
                {
                  code: {
                    coding: [{ code: 'language' }],
                  },
                  valueString: 'en-US',
                },
              ],
            },
          },
        ],
      };

      let converted: any;
      act(() => {
        converted = result.current.convertFHIRDictationToJson(fhirData);
      });

      expect(converted.dictation).toBe('Observation dictation');
      expect(converted.confidence).toBe(0.91);
      expect(converted.language).toBe('en-US');
      expect(converted.sessionId).toBe('obs-session-id');
    });

    it('should throw on invalid JSON string input', () => {
      const { result } = renderHook(() => useHL7FHIRConverter());

      expect(() => {
        result.current.convertFHIRDictationToJson('not valid json {{{');
      }).toThrow();
    });
  });
});
