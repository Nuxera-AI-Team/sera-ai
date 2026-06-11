import React, { useState, useCallback } from "react";
import { PatientDetails } from "../types";

interface TranscriptionResponse {
  transcription: string;
  classifiedInfo?: any;
  classification?: any;
  sessionId?: string | null;
  model?: string;
  processingTimes?: {
    transcriptionMs?: number;
    finalChunkProcessingMs?: number;
    totalProcessingMs?: number;
  };
  metadata?: {
    originalFormat: "hl7" | "fhir" | "json";
    processedAt: string;
  };
}

interface SpecialitiesResponse {
  specialities?: Array<{
    value: string;
    label: string;
    description: string;
  }>;
  [key: string]: any;
}

interface ApiResponse<T = any> {
  data?: T;
  [key: string]: any;
}

interface HL7Segment {
  type: string;
  fields: string[];
}

interface FHIRResource {
  resourceType: string;
  id?: string;
  text?: {
    status: string;
    div: string;
  };
  [key: string]: any;
}

interface LoginResponse {
  user: {
    id: number;
    username: string;
    user_type: string[];
  };
  token: string;
  expiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt?: string;
}

// Add new interface for transcription request
interface TranscriptionRequest {
  sessionId?: string;
  model: string;
  doctorName: string;
  encounterId?: string;
  patientDetails?: PatientDetails;
  removeSilence: boolean;
  skipDiarization: boolean;
  isFinalChunk: boolean;
  isPaused: boolean;
  userId?: number;
  sequence: number;
  speciality: string;
  retry?: boolean;
}

// Add new interfaces for dictation
interface DictationRequest {
  doctorName?: string;
  patientId?: string;
  sessionId?: string;
  language?: string;
  specialty?: string;
  [key: string]: any;
}

interface DictationResponse {
  dictation: string;
  sessionId?: string | null;
  confidence?: number;
  language?: string;
  processingTimes?: {
    transcriptionMs?: number;
    totalProcessingMs?: number;
    // Add new fields for the dictation response
    audioSizeMB?: number;
    requestTimestamp?: number;
    processedAt?: string;
    dictationType?: string;
  };
  [key: string]: any;
}

// Add new interfaces for API Keys
interface ApiKeyRequest {
  id?: number;
  name?: string;
  type?: string;
  status?: string;
  user_id?: number;
  is_default?: boolean;
  [key: string]: any;
}

interface ApiKeyResponse {
  id: number;
  key: string;
  name?: string;
  type?: string;
  status?: string;
  created_at: string;
  user_id: number;
  is_default: boolean;
  [key: string]: any;
}

interface UseHL7FHIRConverterReturn {
  // Transcription-specific methods (keep as FormData for audio uploads)
  convertTranscriptionResponse: (
    response: any,
    format?: "hl7" | "fhir" | "json"
  ) => TranscriptionResponse;

  // Request formatting methods (audio uploads - keep as FormData)
  createHL7TranscriptionRequest: (audioFile: File, requestData: TranscriptionRequest) => FormData;
  createFHIRTranscriptionRequest: (audioFile: File, requestData: TranscriptionRequest) => FormData;

  // Dictation-specific methods
  createHL7DictationRequest: (audioFile: File, requestData: DictationRequest) => FormData;
  createFHIRDictationRequest: (audioFile: File, requestData: DictationRequest) => FormData;
  convertDictationResponse: (
    response: any,
    format?: "hl7" | "fhir" | "json" | "auto"
  ) => DictationResponse;
  convertHL7DictationToJson: (hl7Data: string) => DictationResponse;
  convertFHIRDictationToJson: (fhirData: any) => DictationResponse;

  isConverting: boolean;
  conversionError: string | null;
  clearError: () => void;
}

export const useHL7FHIRConverter = (): UseHL7FHIRConverterReturn => {
  const [isConverting, setIsConverting] = useState(false);
  const [conversionError, setConversionError] = useState<string | null>(null);

  // Helper function to detect response format
  const detectFormat = useCallback((response: any): "hl7" | "fhir" | "json" => {
    // Check if it's a string that looks like HL7
    if (typeof response === "string") {
      if (
        response.startsWith("MSH|") ||
        response.includes("\rMSH|") ||
        response.includes("\nMSH|") ||
        response.match(/^[A-Z]{3}\|/)
      ) {
        return "hl7";
      }
    }

    // Check if it's FHIR format
    if (typeof response === "object" && response !== null) {
      if (
        response.resourceType ||
        (response.entry && Array.isArray(response.entry)) ||
        (response.resource && response.resource.resourceType)
      ) {
        return "fhir";
      }
    }

    return "json";
  }, []);

  // Helper function to unescape HL7 encoded text
  const unescapeHL7 = useCallback((text: string): string => {
    return text
      .replace(/\\E\\/g, "\\") // Escape character
      .replace(/\\F\\/g, "|") // Field separator
      .replace(/\\C\\/g, "^") // Component separator
      .replace(/\\R\\/g, "~") // Repetition separator
      .replace(/\\S\\/g, "&") // Escape & encoding
      .replace(/\\T\\/g, "\n") // Newline
      .replace(/\\X0A\\/g, "\n") // Hex newline
      .replace(/\\X0D\\/g, "\r"); // Hex carriage return
  }, []);

  // Helper function to escape HL7 text
  const escapeHL7 = useCallback((text: string): string => {
    return text
      .replace(/\\/g, "\\E\\") // Escape character
      .replace(/\|/g, "\\F\\") // Field separator
      .replace(/\^/g, "\\S\\") // Component separator
      .replace(/~/g, "\\R\\") // Repetition separator
      .replace(/&/g, "\\T\\") // Escape & encoding
      .replace(/\n/g, "\\X0A\\") // Newline
      .replace(/\r/g, "\\X0D\\"); // Carriage return
  }, []);

  const formatHL7Date = (date?: Date | string): string => {
    if (!date) return "";
    if (date instanceof Date && !isNaN(date.getTime())) {
      const year = date.getFullYear().toString().padStart(4, "0");
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const day = date.getDate().toString().padStart(2, "0");
      return `${year}${month}${day}`;
    }
    if (typeof date === "string") {
      const trimmed = date.trim();
      if (/^\\d{8}$/.test(trimmed)) return trimmed;
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        const year = parsed.getFullYear().toString().padStart(4, "0");
        const month = (parsed.getMonth() + 1).toString().padStart(2, "0");
        const day = parsed.getDate().toString().padStart(2, "0");
        return `${year}${month}${day}`;
      }
    }
    return "";
  };

  const formatFHIRDate = (date?: Date | string): string | undefined => {
    if (!date) return undefined;
    if (date instanceof Date && !isNaN(date.getTime())) {
      const year = date.getFullYear().toString().padStart(4, "0");
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const day = date.getDate().toString().padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    if (typeof date === "string") {
      const trimmed = date.trim();
      if (/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) return trimmed;
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        const year = parsed.getFullYear().toString().padStart(4, "0");
        const month = (parsed.getMonth() + 1).toString().padStart(2, "0");
        const day = parsed.getDate().toString().padStart(2, "0");
        return `${year}-${month}-${day}`;
      }
    }
    return undefined;
  };

  const mapHL7Gender = (gender?: string): string => {
    if (!gender) return "U";
    const normalized = gender.toLowerCase();
    if (normalized === "male" || normalized === "m") return "M";
    if (normalized === "female" || normalized === "f") return "F";
    if (normalized === "other" || normalized === "o") return "O";
    return "U";
  };

  const mapFHIRGender = (
    gender?: string
  ): "male" | "female" | "other" | "unknown" | undefined => {
    if (!gender) return undefined;
    const normalized = gender.toLowerCase();
    if (normalized === "male" || normalized === "m") return "male";
    if (normalized === "female" || normalized === "f") return "female";
    if (normalized === "other" || normalized === "o") return "other";
    if (normalized === "unknown" || normalized === "u") return "unknown";
    return "unknown";
  };

  // Parse HL7 message into segments
  const parseHL7 = useCallback((hl7String: string): HL7Segment[] => {
    const segments: HL7Segment[] = [];
    const lines = hl7String.split(/[\r\n]+/);

    for (const line of lines) {
      if (line.trim()) {
        const fields = line.split("|");
        if (fields.length > 0) {
          segments.push({
            type: fields[0],
            fields: fields.slice(1),
          });
        }
      }
    }

    return segments;
  }, []);

  // Convert HL7 transcription response to JSON
  const convertHL7TranscriptionToJson = useCallback(
    (hl7Data: string): TranscriptionResponse => {
      try {
        const segments = parseHL7(hl7Data);
        let transcription = "";
        let classifiedInfo: any = {};
        let sessionId = "";
        let metadata: any = {};
        let speciality: string = "";

        console.log(`[SERA] Parsing HL7 transcription | segments=${segments.length}`);

        for (const segment of segments) {
          switch (segment.type) {
            case "MSH": // Message Header
              if (segment.fields.length >= 10) {
                sessionId = segment.fields[9];
              }
              break;

            case "TXA": // Document Header
              if (segment.fields.length >= 2) {
                const docSessionId = segment.fields[1];
                if (docSessionId && docSessionId !== sessionId) {
                  sessionId = docSessionId;
                }
              }
              break;

            case "OBX": // Observation/Result
              if (segment.fields.length >= 5) {
                const observationId = segment.fields[2];
                const observationValue = segment.fields[4];

                // Handle transcription content
                if (observationId?.includes("TRANSCRIPTION^")) {
                  const unescapedTranscription = unescapeHL7(observationValue || "");
                  transcription += (transcription ? "\n" : "") + unescapedTranscription;
                }
                // Handle classification data
                else if (observationId?.includes("^")) {
                  const fieldParts = observationId.split("^");
                  const fieldKey = fieldParts[1] || fieldParts[0];
                  const cleanFieldKey = fieldKey.replace(/Part \d+$/, "").trim();

                  if (!classifiedInfo[cleanFieldKey]) {
                    classifiedInfo[cleanFieldKey] = [];
                  }

                  let processedValue = observationValue || "";
                  if (observationId.includes("ICD10") && processedValue.includes("^")) {
                    processedValue = processedValue.split("^")[0];
                  }

                  processedValue = unescapeHL7(processedValue);
                  classifiedInfo[cleanFieldKey].push(processedValue);
                }
                // Handle direct classification JSON (legacy support)
                else if (observationId === "CLASSIFICATION^Medical Classification") {
                  try {
                    const classificationJson = unescapeHL7(observationValue || "");
                    const parsedClassification = JSON.parse(classificationJson);
                    Object.assign(classifiedInfo, parsedClassification);
                  } catch (e) {
                    console.error("[SERA] Failed to parse HL7 classification JSON:", e);
                  }
                }
              }
              break;

            case "NTE": // Notes and Comments
              if (segment.fields.length >= 3) {
                const noteText = segment.fields[2];

                if (noteText?.startsWith("PROCESSING_METADATA:")) {
                  const metadataText = noteText.substring("PROCESSING_METADATA: ".length);
                  const parts = metadataText.split(", ");
                  for (const part of parts) {
                    const colonIndex = part.indexOf(": ");
                    if (colonIndex > 0) {
                      const key = part.substring(0, colonIndex).trim();
                      const value = part.substring(colonIndex + 2).trim();

                      if (key === "Model") {
                        metadata.model = value;
                      } else if (key === "Transcription") {
                        metadata.transcriptionMs = parseInt(value.replace("ms", ""));
                      } else if (key === "Total") {
                        metadata.totalProcessingMs = parseInt(value.replace("ms", ""));
                      }
                    }
                  }
                }
              }
              break;
          }
        }

        const finalClassifiedInfo = {
          speciality: speciality,
          classifiedInfo: classifiedInfo,
          generatedAt: new Date().toISOString(),
        };

        return {
          transcription: transcription || "No transcription found in HL7 message",
          classifiedInfo: finalClassifiedInfo,
          sessionId: sessionId,
          model: metadata.model,
          processingTimes: {
            transcriptionMs: metadata.transcriptionMs,
            finalChunkProcessingMs: metadata.finalChunkProcessingMs,
            totalProcessingMs: metadata.totalProcessingMs,
          },
          metadata: {
            originalFormat: "hl7",
            processedAt: new Date().toISOString(),
          },
        };
      } catch (error) {
        console.error("[SERA] HL7 transcription conversion error:", error);
        throw new Error(
          `Failed to convert HL7 transcription data: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    },
    [parseHL7, unescapeHL7]
  );

  // Convert HL7 specialities response to JSON
  const convertHL7SpecialitiesToJson = useCallback(
    (hl7Data: string): SpecialitiesResponse => {
      try {
        const segments = parseHL7(hl7Data);
        const specialities: Array<{ value: string; label: string; description: string }> = [];

        console.log(`[SERA] Parsing HL7 specialities | segments=${segments.length}`);

        // Track current speciality being built
        let currentSpeciality: { value: string; label: string; description: string } | null = null;

        for (const segment of segments) {
          switch (segment.type) {
            case "OBX": // Observation/Result
              if (segment.fields.length >= 5) {
                const observationId = segment.fields[2]; // Field 3 (0-indexed as 2)
                const observationValue = segment.fields[4]; // Field 5 (0-indexed as 4)

                // Handle speciality entry: SPECIALITY^Medical Speciality
                if (observationId?.includes("SPECIALITY^Medical Speciality")) {
                  // If we have a previous speciality without description, add it with label as description
                  if (currentSpeciality) {
                    if (!currentSpeciality.description) {
                      currentSpeciality.description = currentSpeciality.label;
                    }
                    specialities.push(currentSpeciality);
                  }

                  // Parse the new speciality from format: value^label^source
                  if (observationValue) {
                    const parts = observationValue.split("^");
                    if (parts.length >= 2) {
                      currentSpeciality = {
                        value: unescapeHL7(parts[0]),
                        label: unescapeHL7(parts[1]),
                        description: "", // Will be filled by next SPEC_DESC segment
                      };
                    }
                  }
                }
                // Handle description entry: SPEC_DESC^Speciality Description
                else if (observationId?.includes("SPEC_DESC^Speciality Description")) {
                  if (currentSpeciality && observationValue) {
                    currentSpeciality.description = unescapeHL7(observationValue);
                    // Add the complete speciality to the array
                    specialities.push(currentSpeciality);
                    currentSpeciality = null; // Reset for next speciality
                  }
                }
                // Handle legacy format (single OBX with JSON data) - keep for backward compatibility
                else if (observationId?.includes("SPECIALITIES^")) {
                  try {
                    const unescapedValue = unescapeHL7(observationValue || "");
                    const specialityData = JSON.parse(unescapedValue);

                    if (Array.isArray(specialityData)) {
                      specialities.push(...specialityData);
                    } else if (specialityData.value && specialityData.label) {
                      specialities.push(specialityData);
                    }
                  } catch (e) {
                    console.error("[SERA] Failed to parse legacy specialities JSON data:", e);
                  }
                }
              }
              break;
          }
        }

        // Add any remaining speciality that didn't have a description
        if (currentSpeciality) {
          if (!currentSpeciality.description) {
            currentSpeciality.description = currentSpeciality.label;
          }
          specialities.push(currentSpeciality);
        }

        console.log(`[SERA] Parsed specialities | count=${specialities.length}`);
        return { specialities };
      } catch (error) {
        console.error("[SERA] HL7 specialities conversion error:", error);
        throw new Error(
          `Failed to convert HL7 specialities data: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    },
    [parseHL7, unescapeHL7]
  );

  // Convert FHIR transcription response to JSON
  const convertFHIRTranscriptionToJson = useCallback((fhirData: any): TranscriptionResponse => {
    try {
      let transcription = "";
      let classification: any = {};
      let classifiedInfo: any = null;
      let sessionId = "";

      // Handle different FHIR structures
      let resources: FHIRResource[] = [];

      if (fhirData.resourceType === "Bundle" && fhirData.entry) {
        resources = fhirData.entry.map((entry: any) => entry.resource);
      } else if (fhirData.resourceType) {
        resources = [fhirData];
      } else if (fhirData.resource) {
        resources = [fhirData.resource];
      }

      for (let i = 0; i < resources.length; i++) {
        const resource = resources[i];

        if (!resource || !resource.resourceType) continue;

        switch (resource.resourceType) {
          case "DocumentReference":
            if (resource.content && resource.content[0]?.attachment?.data) {
              try {
                transcription += atob(resource.content[0].attachment.data);
              } catch {
                transcription += resource.content[0].attachment.url || "";
              }
            }
            if (resource.description) {
              transcription += (transcription ? "\n" : "") + resource.description;
            }
            break;

          case "DiagnosticReport":
            // Extract medical classification from conclusion field
            if (resource.conclusion) {
              try {
                // The conclusion contains JSON string with medical classification
                const conclusionData = JSON.parse(resource.conclusion);

                // Store the full classified info
                classifiedInfo = conclusionData;

                // Also populate classification for backward compatibility
                if (conclusionData.classifiedInfo) {
                  classification = conclusionData.classifiedInfo;
                }
              } catch (parseError) {
                console.error("[SERA] Failed to parse DiagnosticReport conclusion:", parseError);

                // Fallback: store as string if parsing fails
                if (!classification["Clinical Summary"]) {
                  classification["Clinical Summary"] = [];
                }
                classification["Clinical Summary"].push(resource.conclusion);
              }
            }
            break;

          case "Condition":
            if (resource.code?.text || resource.code?.coding?.[0]?.display) {
              if (!classification["Diagnosis"]) {
                classification["Diagnosis"] = [];
              }
              const diagnosis = resource.code.text || resource.code.coding[0].display;
              classification["Diagnosis"].push(diagnosis);
            }
            break;

          case "Composition":
            // Extract transcription text from section array
            if (
              resource.section &&
              Array.isArray(resource.section) &&
              resource.section.length > 0
            ) {
              console.log(`[SERA] Processing FHIR Composition | sections=${resource.section.length}`);
              for (const section of resource.section) {
                // Only extract text from "Transcription" section, not "Medical Classification"
                if (section.title === "Transcription" && section.text?.div) {
                  const textContent = section.text.div.replace(/<[^>]*>/g, "");
                  transcription += (transcription ? "\n" : "") + textContent;
                  console.log(`[SERA] Extracted transcription text | chars=${textContent.length}`);
                } else if (section.title === "Medical Classification") {
                  // Skipped - handled by DiagnosticReport
                }
              }
            }
            // Fallback to resource.text.div if no sections found
            else if (resource.text?.div) {
              const textContent = resource.text.div.replace(/<[^>]*>/g, "");
              transcription += (transcription ? "\n" : "") + textContent;
            }

            if (resource.identifier) {
              // Handle both single identifier object and array of identifiers
              const identifiers = Array.isArray(resource.identifier)
                ? resource.identifier
                : [resource.identifier];

              for (let j = 0; j < identifiers.length; j++) {
                const identifier = identifiers[j];

                if (
                  identifier.system === "http://nuxera.ai/session-identifier" &&
                  identifier.value
                ) {
                  sessionId = identifier.value;
                  break;
                }
              }
            }

            // Fallback to Composition.id if no session identifier found
            if (!sessionId && resource.id) {
              sessionId = resource.id;
              console.log(`[SERA] Using Composition.id as fallback sessionId | sessionId=${sessionId}`);
            }
            break;

          case "Task":
            // Check Task.identifier for session ID (lower priority, for backward compatibility)
            if (!sessionId && resource.identifier && Array.isArray(resource.identifier)) {
              for (const identifier of resource.identifier) {
                if (identifier.system === "http://nuxera.ai/session-id" && identifier.value) {
                  sessionId = identifier.value;
                  console.log(`[SERA] Extracted sessionId from Task.identifier | sessionId=${sessionId}`);
                  break;
                }
              }
            }
            break;
        }
      }

      // Fallback: Check Bundle.identifier
      if (!sessionId && fhirData.resourceType === "Bundle" && fhirData.identifier?.value) {
        sessionId = fhirData.identifier.value;
        console.log(`[SERA] Using Bundle.identifier as fallback sessionId | sessionId=${sessionId}`);
      }

      // Fallback: Use Bundle.id
      if (!sessionId && fhirData.resourceType === "Bundle" && fhirData.id) {
        sessionId = fhirData.id;
        console.log(`[SERA] Using Bundle.id as fallback sessionId | sessionId=${sessionId}`);
      }

      // Final fallback - generate session ID if still empty
      if (!sessionId) {
        sessionId = `session_${Date.now()}`;
        console.warn(`[SERA] No sessionId found in FHIR response, generated | sessionId=${sessionId}`);
      }

      return {
        transcription: transcription || "No transcription found in FHIR data",
        classification,
        classifiedInfo: classifiedInfo,
        sessionId: sessionId,
        metadata: {
          originalFormat: "fhir",
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      console.error("[SERA] FHIR transcription conversion error:", error);
      throw new Error(
        `Failed to convert FHIR transcription data: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }, []);

  // Transcription-specific converter
  const convertTranscriptionResponse = useCallback(
    (response: any, format: "auto" | "hl7" | "fhir" | "json" = "auto"): TranscriptionResponse => {
      setIsConverting(true);
      setConversionError(null);

      try {
        let detectedFormat = format;

        if (format === "auto") {
          detectedFormat = detectFormat(response);
        }

        let result: TranscriptionResponse;

        switch (detectedFormat) {
          case "hl7":
            result = convertHL7TranscriptionToJson(
              typeof response === "string" ? response : JSON.stringify(response)
            );
            break;

          case "fhir":
            result = convertFHIRTranscriptionToJson(response);
            break;

          case "json":
          default:
            const transcription = response.transcription || response.text || "";
            const sessionId = response.sessionId || `session_${Date.now()}`;

            result = {
              transcription: transcription,
              classifiedInfo: response.classifiedInfo,
              sessionId: sessionId,
              model: response.model,
              processingTimes: { ...response.processingTimes },
              metadata: {
                originalFormat: "json",
                processedAt: new Date().toISOString(),
              },
            };
            break;
        }

        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown conversion error";
        setConversionError(errorMessage);
        console.error("[SERA] Transcription conversion failed:", error);

        return {
          transcription: "Conversion failed - see raw response",
          classification: { "Conversion Error": [errorMessage] },
          sessionId: `error_session_${Date.now()}`,
          metadata: {
            originalFormat: "json",
            processedAt: new Date().toISOString(),
          },
        };
      } finally {
        setIsConverting(false);
      }
    },
    [detectFormat, convertHL7TranscriptionToJson, convertFHIRTranscriptionToJson]
  );

  // Create HL7-formatted transcription request
  const createHL7TranscriptionRequest = useCallback(
    (audioFile: File, requestData: TranscriptionRequest): FormData => {
      const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
      const messageControlId = `${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

      // Build HL7 message
      const hl7Lines: string[] = [];

      // MSH - Message Header
      hl7Lines.push(
        `MSH|^~\\&|Nuxera-Client|CLIENT_FACILITY|Nuxera-Transcribe|Nuxera|${timestamp}||ORU^R01^ORU_R01|${messageControlId}|P|2.5`
      );

      // PID - Patient Identification
      const patientId = requestData.patientDetails?.id?.toString() || "";
      const escapedPatientName = escapeHL7(
        requestData.patientDetails?.name || "Unknown Patient"
      );
      const patientDob = formatHL7Date(requestData.patientDetails?.dateOfBirth);
      const patientGender = mapHL7Gender(requestData.patientDetails?.gender);
      hl7Lines.push(
        `PID|1||${patientId}||${escapedPatientName}^||${patientDob}|${patientGender}||||||||||${
          requestData.userId || ""
        }|||||||||||||||`
      );

      // OBR - Observation Request
      hl7Lines.push(
        `OBR|1|${messageControlId}||TRANSCRIPTION^Audio Transcription Request|||${timestamp}||||||||${timestamp}|||F`
      );

      let obxSequence = 1;

      // OBX segments for request parameters
      if (requestData.sessionId) {
        hl7Lines.push(
          `OBX|${obxSequence++}|TX|SESSION_ID^Session Identifier||${escapeHL7(
            requestData.sessionId
          )}|||||F|||${timestamp}`
        );
      }

      if (requestData.encounterId) {
        hl7Lines.push(
          `OBX|${obxSequence++}|TX|ENCOUNTER_ID^Encounter Identifier||${escapeHL7(
            requestData.encounterId
          )}|||||F|||${timestamp}`
        );
      }

      if (requestData.patientDetails?.age !== undefined) {
        hl7Lines.push(
          `OBX|${obxSequence++}|NM|PATIENT_AGE^Patient Age||${requestData.patientDetails.age}|||||F|||${timestamp}`
        );
      }

      hl7Lines.push(
        `OBX|${obxSequence++}|TX|MODEL^Transcription Model||${escapeHL7(
          requestData.model
        )}|||||F|||${timestamp}`
      );

      hl7Lines.push(
        `OBX|${obxSequence++}|TX|DOCTOR_NAME^Doctor Name||${escapeHL7(
          requestData.doctorName
        )}|||||F|||${timestamp}`
      );

      hl7Lines.push(
        `OBX|${obxSequence++}|TX|SPECIALITY^Medical Speciality||${escapeHL7(
          requestData.speciality
        )}|||||F|||${timestamp}`
      );

      hl7Lines.push(
        `OBX|${obxSequence++}|NM|SEQUENCE^Sequence Number||${
          requestData.sequence
        }|||||F|||${timestamp}`
      );

      // Boolean parameters
      hl7Lines.push(
        `OBX|${obxSequence++}|CWE|REMOVE_SILENCE^Remove Silence||${
          requestData.removeSilence ? "Y^Yes" : "N^No"
        }|||||F|||${timestamp}`
      );

      hl7Lines.push(
        `OBX|${obxSequence++}|CWE|SKIP_DIARIZATION^Skip Diarization||${
          requestData.skipDiarization ? "Y^Yes" : "N^No"
        }|||||F|||${timestamp}`
      );

      hl7Lines.push(
        `OBX|${obxSequence++}|CWE|IS_FINAL^Final Chunk||${
          requestData.isFinalChunk ? "Y^Yes" : "N^No"
        }|||||F|||${timestamp}`
      );

      hl7Lines.push(
        `OBX|${obxSequence++}|CWE|IS_PAUSED^Paused Chunk||${
          requestData.isPaused ? "Y^Yes" : "N^No"
        }|||||F|||${timestamp}`
      );

      if (requestData.retry) {
        hl7Lines.push(`OBX|${obxSequence++}|CWE|RETRY^Retry Request||Y^Yes|||||F|||${timestamp}`);
      }

      // Audio file metadata
      hl7Lines.push(
        `OBX|${obxSequence++}|TX|AUDIO_FILENAME^Audio File Name||${escapeHL7(
          audioFile.name
        )}|||||F|||${timestamp}`
      );

      hl7Lines.push(
        `OBX|${obxSequence++}|NM|AUDIO_SIZE^Audio File Size||${audioFile.size}|||||F|||${timestamp}`
      );

      hl7Lines.push(
        `OBX|${obxSequence++}|TX|AUDIO_TYPE^Audio File Type||${escapeHL7(
          audioFile.type
        )}|||||F|||${timestamp}`
      );

      // Join all lines with \r\n for proper HL7 format
      const hl7Message = hl7Lines.join("\r\n") + "\r\n";

      console.log(`[SERA] HL7 transcription request constructed | size=${hl7Message.length}`);

      // Create FormData with HL7 message and audio file
      const formData = new FormData();

      // Add the HL7 message as the request body
      const hl7Blob = new Blob([hl7Message], { type: "text/plain" });
      formData.append("hl7_request", hl7Blob, "transcription_request.hl7");

      // Add the audio file
      formData.append("audio", audioFile);

      return formData;
    },
    [escapeHL7, formatHL7Date, mapHL7Gender]
  );

  // Create FHIR-formatted transcription request
  const createFHIRTranscriptionRequest = useCallback(
    (audioFile: File, requestData: TranscriptionRequest): FormData => {
      const timestamp = new Date().toISOString();
      const requestId = `transcription-request-${Date.now()}`;

      // Build FHIR Bundle
      const fhirBundle = {
        resourceType: "Bundle",
        id: requestId,
        timestamp: timestamp,
        type: "message",
        entry: [
          // MessageHeader
          {
            fullUrl: `urn:uuid:${requestId}-header`,
            resource: {
              resourceType: "MessageHeader",
              id: `${requestId}-header`,
              timestamp: timestamp,
              eventCoding: {
                system: "http://nuxera.ai/events",
                code: "transcription-request",
                display: "Audio Transcription Request",
              },
              source: {
                name: "Nuxera Client",
                endpoint: "http://nuxera.ai/client",
              },
              destination: [
                {
                  name: "Nuxera Transcription Service",
                  endpoint: "http://nuxera.ai/transcription",
                },
              ],
              focus: [
                {
                  reference: `urn:uuid:${requestId}-task`,
                },
              ],
            },
          },

          // Patient
          {
            fullUrl: `urn:uuid:${requestId}-patient`,
            resource: {
              resourceType: "Patient",
              id: `${requestId}-patient`,
              identifier: requestData.patientDetails?.id
                ? [
                    {
                      system: "http://nuxera.ai/patient-id",
                      value: requestData.patientDetails.id.toString(),
                    },
                  ]
                : [],
              name: [
                {
                  family: requestData.patientDetails?.name || "Unknown",
                  given: ["Patient"],
                },
              ],
              gender: mapFHIRGender(requestData.patientDetails?.gender),
              birthDate: formatFHIRDate(requestData.patientDetails?.dateOfBirth),
              extension:
                requestData.patientDetails?.age !== undefined
                  ? [
                      {
                        url: "http://hl7.org/fhir/StructureDefinition/patient-age",
                        valueUnsignedInt: requestData.patientDetails.age,
                      },
                    ]
                  : undefined,
            },
          },

          // Practitioner (Doctor)
          {
            fullUrl: `urn:uuid:${requestId}-practitioner`,
            resource: {
              resourceType: "Practitioner",
              id: `${requestId}-practitioner`,
              name: [
                {
                  family: requestData.doctorName,
                  given: ["Dr."],
                },
              ],
              qualification: [
                {
                  code: {
                    coding: [
                      {
                        system: "http://nuxera.ai/specialities",
                        code: requestData.speciality,
                        display: requestData.speciality.replace(/_/g, " "),
                      },
                    ],
                  },
                },
              ],
            },
          },

          // Task (Transcription Request)
          {
            fullUrl: `urn:uuid:${requestId}-task`,
            resource: {
              resourceType: "Task",
              id: `${requestId}-task`,
              status: "requested",
              intent: "order",
              code: {
                coding: [
                  {
                    system: "http://nuxera.ai/task-codes",
                    code: "audio-transcription",
                    display: "Audio Transcription",
                  },
                ],
              },
              for: {
                reference: `urn:uuid:${requestId}-patient`,
              },
              requester: {
                reference: `urn:uuid:${requestId}-practitioner`,
              },
              authoredOn: timestamp,
              input: [
                {
                  type: {
                    coding: [
                      {
                        system: "http://nuxera.ai/input-types",
                        code: "transcription-model",
                      },
                    ],
                  },
                  valueString: requestData.model,
                },
                {
                  type: {
                    coding: [
                      {
                        system: "http://nuxera.ai/input-types",
                        code: "sequence-number",
                      },
                    ],
                  },
                  valueInteger: requestData.sequence,
                },
                {
                  type: {
                    coding: [
                      {
                        system: "http://nuxera.ai/input-types",
                        code: "remove-silence",
                      },
                    ],
                  },
                  valueBoolean: requestData.removeSilence,
                },
                {
                  type: {
                    coding: [
                      {
                        system: "http://nuxera.ai/input-types",
                        code: "skip-diarization",
                      },
                    ],
                  },
                  valueBoolean: requestData.skipDiarization,
                },
                {
                  type: {
                    coding: [
                      {
                        system: "http://nuxera.ai/input-types",
                        code: "is-final-chunk",
                      },
                    ],
                  },
                  valueBoolean: requestData.isFinalChunk,
                },
                {
                  type: {
                    coding: [
                      {
                        system: "http://nuxera.ai/input-types",
                        code: "is-paused",
                      },
                    ],
                  },
                  valueBoolean: requestData.isPaused,
                },
              ],
            },
          },

          // DocumentReference (Audio File)
          {
            fullUrl: `urn:uuid:${requestId}-audio`,
            resource: {
              resourceType: "DocumentReference",
              id: `${requestId}-audio`,
              status: "current",
              type: {
                coding: [
                  {
                    system: "http://loinc.org",
                    code: "11502-2",
                    display: "Audio recording",
                  },
                ],
              },
              subject: {
                reference: `urn:uuid:${requestId}-patient`,
              },
              date: timestamp,
              content: [
                {
                  attachment: {
                    contentType: audioFile.type,
                    size: audioFile.size,
                    title: audioFile.name,
                    creation: timestamp,
                  },
                },
              ],
            },
          },
        ],
      };

      if (requestData.sessionId) {
        // Add session identifier
        fhirBundle.entry[3].resource.identifier = [
          {
            system: "http://nuxera.ai/session-id",
            value: requestData.sessionId,
          },
        ];
      }

      if (requestData.retry) {
        // Add retry indicator
        const taskEntry = fhirBundle.entry[3];
        if (taskEntry?.resource?.input) {
          taskEntry.resource.input.push({
            type: {
              coding: [
                {
                  system: "http://nuxera.ai/input-types",
                  code: "retry-request",
                },
              ],
            },
            valueBoolean: true,
          });
        }
      }

      console.log(`[SERA] FHIR transcription request constructed | entries=${fhirBundle.entry.length}`);

      // Create FormData with FHIR bundle and audio file
      const formData = new FormData();

      // Add the FHIR bundle as JSON
      const fhirBlob = new Blob([JSON.stringify(fhirBundle, null, 2)], {
        type: "application/fhir+json",
      });
      formData.append("fhir_request", fhirBlob, "transcription_request.json");

      // Add the audio file
      formData.append("audio", audioFile);

      // Add session ID as separate field if it exists (for server compatibility)
      // This ensures the server receives numeric session IDs in the expected location
      if (requestData.sessionId) {
        formData.append("sessionId", requestData.sessionId);
      }

      if (requestData.encounterId) {
        formData.append("encounterId", requestData.encounterId);
      }

      // Add other critical fields to FormData for easier server-side parsing
      formData.append("sequence", requestData.sequence.toString());
      formData.append("isFinalChunk", requestData.isFinalChunk.toString());

      console.log(`[SERA] FHIR FormData created | sessionId=${requestData.sessionId || "none"}`);

      return formData;
    },
    [formatFHIRDate, mapFHIRGender]
  );

  const clearError = useCallback(() => {
    setConversionError(null);
  }, []);

  // Add the dictation request creators (keep as FormData since they include audio files)
  const createHL7DictationRequest = useCallback(
    (audioFile: File, requestData: DictationRequest): FormData => {
      const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
      const messageControlId = `DICTATE_${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

      // Build HL7 message for dictation request
      const hl7Lines: string[] = [];

      // MSH - Message Header
      hl7Lines.push(
        `MSH|^~\\&|Nuxera-Client|CLIENT_FACILITY|Nuxera-Dictation|Nuxera|${timestamp}||MDM^T02^MDM_T02|${messageControlId}|P|2.5`
      );

      // EVN - Event Type
      hl7Lines.push(`EVN|T02|${timestamp}|||SYS^SYSTEM^NUXERA`);

      // PID - Patient Identification (if available)
      const patientId = requestData.patientId || "unknown";
      hl7Lines.push(
        `PID|1||${patientId}||PATIENT^||${timestamp}|U|||unknown||||||||${patientId}|||||||||||||||`
      );

      // TXA - Transcription Document Administration
      hl7Lines.push(
        `TXA|1|CN|TX|||${timestamp}|||${escapeHL7(
          requestData.doctorName || "unknown"
        )}||||||||IP||AV|||${timestamp}`
      );

      let obxSequence = 1;

      // OBX segments for dictation request data
      if (requestData.doctorName) {
        hl7Lines.push(
          `OBX|${obxSequence++}|TX|DOCTOR_NAME^Doctor Name||${escapeHL7(
            requestData.doctorName
          )}|||||F|||${timestamp}`
        );
      }

      if (requestData.sessionId) {
        hl7Lines.push(
          `OBX|${obxSequence++}|TX|SESSION_ID^Session ID||${escapeHL7(
            requestData.sessionId
          )}|||||F|||${timestamp}`
        );
      }

      if (requestData.language) {
        hl7Lines.push(
          `OBX|${obxSequence++}|TX|LANGUAGE^Language||${escapeHL7(
            requestData.language
          )}|||||F|||${timestamp}`
        );
      }

      if (requestData.specialty) {
        hl7Lines.push(
          `OBX|${obxSequence++}|TX|SPECIALTY^Specialty||${escapeHL7(
            requestData.specialty
          )}|||||F|||${timestamp}`
        );
      }

      // Audio file information
      hl7Lines.push(
        `OBX|${obxSequence++}|TX|AUDIO_FILENAME^Audio Filename||${escapeHL7(
          audioFile.name
        )}|||||F|||${timestamp}`
      );

      hl7Lines.push(
        `OBX|${obxSequence++}|NM|AUDIO_SIZE^Audio Size||${audioFile.size}|||||F|||${timestamp}`
      );

      hl7Lines.push(
        `OBX|${obxSequence++}|TX|AUDIO_TYPE^Audio Type||${escapeHL7(
          audioFile.type
        )}|||||F|||${timestamp}`
      );

      hl7Lines.push(
        `OBX|${obxSequence++}|TX|REQUEST_TYPE^Request Type||DICTATION|||||F|||${timestamp}`
      );

      // Join all lines with \r\n for proper HL7 format
      const hl7Message = hl7Lines.join("\r\n") + "\r\n";

      console.log(`[SERA] HL7 dictation request constructed | size=${hl7Message.length}, audioFile=${audioFile.name}, audioSize=${audioFile.size}`);

      // Create FormData with HL7 message and audio file
      const formData = new FormData();

      // Add the audio file
      formData.append("audio", audioFile);

      // Add the HL7 request metadata
      const hl7Blob = new Blob([hl7Message], { type: "text/plain; charset=utf-8" });
      formData.append("hl7_request", hl7Blob, `dictation_request.hl7`);

      return formData;
    },
    [escapeHL7]
  );

  const createFHIRDictationRequest = useCallback(
    (audioFile: File, requestData: DictationRequest): FormData => {
      const timestamp = new Date().toISOString();
      const requestId = `dictation-request-${Date.now()}`;

      // Build FHIR Bundle for dictation
      const fhirBundle = {
        resourceType: "Bundle",
        id: requestId,
        timestamp: timestamp,
        type: "message",
        entry: [
          // MessageHeader
          {
            fullUrl: `urn:uuid:${requestId}-header`,
            resource: {
              resourceType: "MessageHeader",
              id: `${requestId}-header`,
              timestamp: timestamp,
              eventCoding: {
                system: "http://nuxera.ai/events",
                code: "dictation-request",
                display: "Audio Dictation Request",
              },
              source: {
                name: "Nuxera Client",
                endpoint: "http://nuxera.ai/client",
              },
              destination: [
                {
                  name: "Nuxera Dictation Service",
                  endpoint: "http://nuxera.ai/dictation",
                },
              ],
              focus: [
                {
                  reference: `urn:uuid:${requestId}-media`,
                },
              ],
            },
          },

          // Patient (if available)
          {
            fullUrl: `urn:uuid:${requestId}-patient`,
            resource: {
              resourceType: "Patient",
              id: `${requestId}-patient`,
              identifier: [
                {
                  system: "http://nuxera.ai/patient-id",
                  value: requestData.patientId || "unknown",
                },
              ],
              name: [
                {
                  family: "Patient",
                  given: ["Unknown"],
                },
              ],
            },
          },

          // Practitioner (Doctor)
          {
            fullUrl: `urn:uuid:${requestId}-practitioner`,
            resource: {
              resourceType: "Practitioner",
              id: `${requestId}-practitioner`,
              name: [
                {
                  family: requestData.doctorName || "Unknown",
                  given: ["Dr."],
                },
              ],
              qualification: requestData.specialty
                ? [
                    {
                      code: {
                        coding: [
                          {
                            system: "http://snomed.info/sct",
                            code: "specialty",
                            display: requestData.specialty,
                          },
                        ],
                      },
                    },
                  ]
                : undefined,
            },
          },

          // Media (Audio file reference)
          {
            fullUrl: `urn:uuid:${requestId}-media`,
            resource: {
              resourceType: "Media",
              id: `${requestId}-media`,
              status: "completed",
              type: {
                coding: [
                  {
                    system: "http://terminology.hl7.org/CodeSystem/media-type",
                    code: "audio",
                    display: "Audio",
                  },
                ],
              },
              subject: {
                reference: `urn:uuid:${requestId}-patient`,
              },
              operator: {
                reference: `urn:uuid:${requestId}-practitioner`,
              },
              createdDateTime: timestamp,
              content: {
                contentType: audioFile.type || "audio/wav",
                size: audioFile.size,
                title: audioFile.name,
                creation: timestamp,
              },
              extension: [
                {
                  url: "http://nuxera.ai/extensions/dictation-request",
                  extension: [
                    {
                      url: "doctorName",
                      valueString: requestData.doctorName || "",
                    },
                    {
                      url: "sessionId",
                      valueString: requestData.sessionId || "",
                    },
                    {
                      url: "language",
                      valueString: requestData.language || "",
                    },
                    {
                      url: "specialty",
                      valueString: requestData.specialty || "",
                    },
                    {
                      url: "requestType",
                      valueString: "DICTATION",
                    },
                  ],
                },
              ],
            },
          },
        ],
      };

      console.log(`[SERA] FHIR dictation request constructed | entries=${fhirBundle.entry.length}, audioFile=${audioFile.name}, audioSize=${audioFile.size}`);

      // Create FormData with FHIR bundle and audio file
      const formData = new FormData();

      // Add the audio file
      formData.append("audio", audioFile);

      // Add the FHIR request metadata
      const fhirBlob = new Blob([JSON.stringify(fhirBundle, null, 2)], {
        type: "application/fhir+json",
      });
      formData.append("fhir_request", fhirBlob, `dictation_request.json`);

      return formData;
    },
    []
  );

  // Update the convertHL7DictationToJson function
  const convertHL7DictationToJson = useCallback(
    (hl7Data: string): DictationResponse => {
      try {
        const segments = parseHL7(hl7Data);
        let dictationResponse: Partial<DictationResponse> = {};

        console.log(`[SERA] Parsing HL7 dictation | segments=${segments.length}`);

        for (const segment of segments) {
          switch (segment.type) {
            case "MSH": // Message Header
              // Extract message control ID as session ID
              if (segment.fields.length >= 10) {
                dictationResponse.sessionId = segment.fields[9];
              }
              break;

            case "PID": // Patient/User Identification
              // Extract user info if needed
              break;

            case "OBR": // Observation Request
              // Extract request info if needed
              if (segment.fields.length >= 3) {
                // Field 2 contains the request ID which can be used as session ID
                const requestId = segment.fields[1];
                if (requestId && !dictationResponse.sessionId) {
                  dictationResponse.sessionId = requestId;
                }
              }
              break;

            case "OBX": // Observation/Result - contains dictation data
              if (segment.fields.length >= 5) {
                const observationId = segment.fields[2]; // Field 3 (0-indexed as 2)
                const observationValue = segment.fields[4]; // Field 5 (0-indexed as 4)

                if (!observationId || !observationValue) continue;

                // Parse each dictation field - Updated to match actual response format
                if (
                  observationId.includes("DICTATION_TEXT^") ||
                  observationId.includes("DICTATION^Dictation Text")
                ) {
                  dictationResponse.dictation = unescapeHL7(observationValue);
                } else if (observationId.includes("SESSION_ID^Session ID")) {
                  dictationResponse.sessionId = unescapeHL7(observationValue);
                } else if (observationId.includes("CONFIDENCE^Confidence")) {
                  dictationResponse.confidence = parseFloat(unescapeHL7(observationValue)) || 0;
                } else if (observationId.includes("LANGUAGE^Language")) {
                  dictationResponse.language = unescapeHL7(observationValue);
                } else if (observationId.includes("TRANSCRIPTION_MS^Transcription Time")) {
                  if (!dictationResponse.processingTimes) {
                    dictationResponse.processingTimes = {};
                  }
                  dictationResponse.processingTimes.transcriptionMs =
                    parseInt(unescapeHL7(observationValue)) || 0;
                } else if (observationId.includes("TOTAL_PROCESSING_MS^Total Processing Time")) {
                  if (!dictationResponse.processingTimes) {
                    dictationResponse.processingTimes = {};
                  }
                  dictationResponse.processingTimes.totalProcessingMs =
                    parseInt(unescapeHL7(observationValue)) || 0;
                } else if (observationId.includes("AUDIO_SIZE^Audio File Size")) {
                  // Store audio size in a custom field if needed
                  if (!dictationResponse.processingTimes) {
                    dictationResponse.processingTimes = {};
                  }
                  // Extract numeric value from "1.05 MB" format
                  const sizeMatch = observationValue.match(/(\d+(?:\.\d+)?)/);
                  if (sizeMatch) {
                    dictationResponse.processingTimes.audioSizeMB = parseFloat(sizeMatch[1]);
                  }
                }
              }
              break;

            case "NTE": // Notes and Comments - contains processing metadata
              if (segment.fields.length >= 3) {
                const noteText = segment.fields[2];

                if (noteText?.includes("REQUEST_TIMESTAMP:")) {
                  const timestampMatch = noteText.match(/REQUEST_TIMESTAMP:\s*(\d+)/);
                  if (timestampMatch) {
                    const requestTimestamp = parseInt(timestampMatch[1]);
                    if (!dictationResponse.processingTimes) {
                      dictationResponse.processingTimes = {};
                    }
                    dictationResponse.processingTimes.requestTimestamp = requestTimestamp;
                  }
                } else if (noteText?.includes("PROCESSED_AT:")) {
                  const processedMatch = noteText.match(/PROCESSED_AT:\s*(.+)/);
                  if (processedMatch) {
                    if (!dictationResponse.processingTimes) {
                      dictationResponse.processingTimes = {};
                    }
                    dictationResponse.processingTimes.processedAt = processedMatch[1].trim();
                  }
                } else if (noteText?.includes("DICTATION_TYPE:")) {
                  const typeMatch = noteText.match(/DICTATION_TYPE:\s*(.+)/);
                  if (typeMatch) {
                    if (!dictationResponse.processingTimes) {
                      dictationResponse.processingTimes = {};
                    }
                    dictationResponse.processingTimes.dictationType = typeMatch[1].trim();
                  }
                }
              }
              break;
          }
        }

        // Calculate processing times if we have request timestamp and processed at
        if (
          dictationResponse.processingTimes?.requestTimestamp &&
          dictationResponse.processingTimes?.processedAt
        ) {
          try {
            const processedAtMs = new Date(dictationResponse.processingTimes.processedAt).getTime();
            const requestMs = dictationResponse.processingTimes.requestTimestamp;
            if (processedAtMs && requestMs) {
              dictationResponse.processingTimes.totalProcessingMs = Math.round(
                processedAtMs - requestMs
              );
            }
          } catch (e) {
            console.warn("[SERA] Could not calculate processing time:", e);
          }
        }

        // Ensure required fields have default values
        const finalResponse: DictationResponse = {
          dictation: dictationResponse.dictation || "",
          sessionId: dictationResponse.sessionId || null,
          confidence: dictationResponse.confidence,
          language: dictationResponse.language,
          processingTimes: dictationResponse.processingTimes,
        };

        console.log(`[SERA] HL7 dictation converted | sessionId=${finalResponse.sessionId}, dictationLength=${finalResponse.dictation.length}`);
        return finalResponse;
      } catch (error) {
        console.error("[SERA] HL7 dictation conversion error:", error);
        throw new Error(
          `Failed to convert HL7 dictation data: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    },
    [parseHL7, unescapeHL7]
  );

  // Convert FHIR dictation response to JSON
  const convertFHIRDictationToJson = useCallback((fhirData: any): DictationResponse => {
    try {
      let dictationResponse: Partial<DictationResponse> = {};

      let parsedData = fhirData;
      if (typeof fhirData === "string") {
        try {
          parsedData = JSON.parse(fhirData);
        } catch (e) {
          console.error("[SERA] Failed to parse FHIR dictation JSON string:", e);
          throw new Error("Invalid JSON response from server");
        }
      }

      // Handle different FHIR structures
      let resources: FHIRResource[] = [];

      if (parsedData.resourceType === "Bundle" && parsedData.entry) {
        resources = parsedData.entry.map((entry: any) => entry.resource);
      } else if (parsedData.resourceType) {
        resources = [parsedData];
      } else if (parsedData.resource) {
        resources = [parsedData.resource];
      }

      for (let i = 0; i < resources.length; i++) {
        const resource = resources[i];

        if (!resource || !resource.resourceType) continue;

        switch (resource.resourceType) {
          case "MessageHeader":
            dictationResponse.sessionId = resource.id;
            break;

          case "Media":

            // Extract dictation text and metadata from extension
            if (resource.extension && Array.isArray(resource.extension)) {
              for (const ext of resource.extension) {
                switch (ext.url) {
                  case "http://nuxera.ai/extensions/transcription":
                    dictationResponse.dictation = ext.valueString || "";
                    break;

                  case "http://nuxera.ai/extensions/audio-size":
                    if (!dictationResponse.processingTimes) {
                      dictationResponse.processingTimes = {};
                    }
                    // Extract numeric value from "0.61 MB" format
                    const sizeMatch = ext.valueString?.match(/(\d+(?:\.\d+)?)/);
                    if (sizeMatch) {
                      dictationResponse.processingTimes.audioSizeMB = parseFloat(sizeMatch[1]);
                    }
                    break;

                  case "http://nuxera.ai/extensions/processing-timestamp":
                    if (!dictationResponse.processingTimes) {
                      dictationResponse.processingTimes = {};
                    }
                    dictationResponse.processingTimes.requestTimestamp = ext.valueInteger;
                    break;

                  case "http://nuxera.ai/extensions/confidence":
                    dictationResponse.confidence = ext.valueDecimal || ext.valueInteger;
                    break;

                  case "http://nuxera.ai/extensions/language":
                    dictationResponse.language = ext.valueString;
                    break;

                  case "http://nuxera.ai/extensions/transcription-time":
                    if (!dictationResponse.processingTimes) {
                      dictationResponse.processingTimes = {};
                    }
                    dictationResponse.processingTimes.transcriptionMs = ext.valueInteger;
                    break;

                  case "http://nuxera.ai/extensions/total-processing-time":
                    if (!dictationResponse.processingTimes) {
                      dictationResponse.processingTimes = {};
                    }
                    dictationResponse.processingTimes.totalProcessingMs = ext.valueInteger;
                    break;
                }
              }
            }

            // Extract session ID from Media identifier if available
            if (!dictationResponse.sessionId && resource.identifier && resource.identifier[0]) {
              dictationResponse.sessionId = resource.identifier[0].value;
            }

            // Use Media ID as session ID if still not found
            if (!dictationResponse.sessionId && resource.id) {
              dictationResponse.sessionId = resource.id;
            }

            // Extract createdDateTime as processedAt if available
            if (resource.createdDateTime && dictationResponse.processingTimes) {
              dictationResponse.processingTimes.processedAt = resource.createdDateTime;
            }
            break;

          case "DocumentReference":
            // Legacy format - Extract dictation text and metadata
            if (resource.content && resource.content[0] && resource.content[0].attachment) {
              const attachment = resource.content[0].attachment;
              if (attachment.data) {
                // Base64 encoded text
                try {
                  dictationResponse.dictation = atob(attachment.data);
                } catch (e) {
                  dictationResponse.dictation = attachment.data;
                }
              }
            }

            // Extract metadata from extension (legacy)
            if (resource.extension) {
              for (const ext of resource.extension) {
                if (ext.url === "http://nuxera.ai/extensions/dictation-response") {
                  for (const subExt of ext.extension || []) {
                    switch (subExt.url) {
                      case "confidence":
                        dictationResponse.confidence = subExt.valueDecimal || subExt.valueInteger;
                        break;
                      case "language":
                        dictationResponse.language = subExt.valueString;
                        break;
                      case "transcriptionMs":
                        if (!dictationResponse.processingTimes) {
                          dictationResponse.processingTimes = {};
                        }
                        dictationResponse.processingTimes.transcriptionMs = subExt.valueInteger;
                        break;
                      case "totalProcessingMs":
                        if (!dictationResponse.processingTimes) {
                          dictationResponse.processingTimes = {};
                        }
                        dictationResponse.processingTimes.totalProcessingMs = subExt.valueInteger;
                        break;
                    }
                  }
                }
              }
            }
            break;

          case "Observation":
            // Legacy format - Extract dictation data from observation components
            if (resource.component && Array.isArray(resource.component)) {
              for (const component of resource.component) {
                const code = component.code?.coding?.[0]?.code;

                switch (code) {
                  case "dictation-text":
                    dictationResponse.dictation = component.valueString || "";
                    break;
                  case "confidence":
                    dictationResponse.confidence = component.valueDecimal || component.valueInteger;
                    break;
                  case "language":
                    dictationResponse.language = component.valueString;
                    break;
                  case "transcription-time":
                    if (!dictationResponse.processingTimes) {
                      dictationResponse.processingTimes = {};
                    }
                    dictationResponse.processingTimes.transcriptionMs = component.valueInteger;
                    break;
                  case "total-processing-time":
                    if (!dictationResponse.processingTimes) {
                      dictationResponse.processingTimes = {};
                    }
                    dictationResponse.processingTimes.totalProcessingMs = component.valueInteger;
                    break;
                }
              }
            }

            // Extract session ID from identifier (legacy)
            if (!dictationResponse.sessionId && resource.identifier && resource.identifier[0]) {
              dictationResponse.sessionId = resource.identifier[0].value;
            }
            break;
        }
      }

      // Calculate processing times if we have request timestamp and processed at
      if (
        dictationResponse.processingTimes?.requestTimestamp &&
        dictationResponse.processingTimes?.processedAt
      ) {
        try {
          const processedAtMs = new Date(dictationResponse.processingTimes.processedAt).getTime();
          const requestMs = dictationResponse.processingTimes.requestTimestamp;
          if (processedAtMs && requestMs) {
            dictationResponse.processingTimes.totalProcessingMs = Math.round(
              processedAtMs - requestMs
            );
          }
        } catch (e) {
          console.warn("[SERA] Could not calculate FHIR dictation processing time:", e);
        }
      }

      // Ensure required fields have default values
      const finalResponse: DictationResponse = {
        dictation: dictationResponse.dictation || "",
        sessionId: dictationResponse.sessionId || null,
        confidence: dictationResponse.confidence,
        language: dictationResponse.language,
        processingTimes: dictationResponse.processingTimes,
      };

      console.log(`[SERA] FHIR dictation converted | sessionId=${finalResponse.sessionId}, dictationLength=${finalResponse.dictation.length}`);
      return finalResponse;
    } catch (error) {
      console.error("[SERA] FHIR dictation conversion error:", error);
      throw new Error(
        `Failed to convert FHIR dictation data: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }, []);

  // Dictation-specific converter
  const convertDictationResponse = useCallback(
    (response: any, format: "auto" | "hl7" | "fhir" | "json" = "auto"): DictationResponse => {
      setIsConverting(true);
      setConversionError(null);

      try {
        let detectedFormat = format;

        if (format === "auto") {
          detectedFormat = detectFormat(response);
        }

        let result: DictationResponse;

        switch (detectedFormat) {
          case "hl7":
            result = convertHL7DictationToJson(
              typeof response === "string" ? response : JSON.stringify(response)
            );
            break;

          case "fhir":
            result = convertFHIRDictationToJson(response);
            break;

          case "json":
          default:
            // Handle direct JSON response
            result = response as DictationResponse;
            break;
        }

        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown conversion error";
        setConversionError(errorMessage);
        console.error("[SERA] Dictation conversion failed:", error);

        // Return a default dictation object with error indication
        return {
          dictation: "",
          sessionId: null,
          confidence: undefined,
          language: undefined,
          processingTimes: undefined,
        };
      } finally {
        setIsConverting(false);
      }
    },
    [detectFormat, convertHL7DictationToJson, convertFHIRDictationToJson]
  );

  // Update HL7 API Key request creator to remove expiry_at
  const createHL7ApiKeyRequest = useCallback(
    (
      apiKeyData: ApiKeyRequest,
      operation:
        | "create"
        | "update"
        | "setDefault"
        | "removeDefault"
        | "pause"
        | "resume"
        | "delete" = "create"
    ): string => {
      const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
      const messageControlId = `APIKEY_${Date.now()}${Math.random().toString(36).substr(2, 9)}`;

      const hl7Lines: string[] = [];

      // MSH - Message Header
      hl7Lines.push(
        `MSH|^~\\&|Nuxera-Client|CLIENT_FACILITY|Nuxera-ApiKeys|Nuxera|${timestamp}||ADT^A08^ADT_A08|${messageControlId}|P|2.5`
      );

      // EVN - Event Type
      const eventCode = getEventCodeForOperation(operation);
      hl7Lines.push(`EVN|${eventCode}|${timestamp}|||SYS^SYSTEM^NUXERA`);

      // PID - User Identification
      hl7Lines.push(
        `PID|1||${
          apiKeyData.user_id || "unknown"
        }||API_KEY_USER^||${timestamp}|U|||unknown||||||||${
          apiKeyData.user_id || ""
        }|||||||||||||||`
      );

      let obxSequence = 1;

      // OBX segments for API key data (remove expiry_at related fields)
      if (
        apiKeyData.id &&
        (operation === "update" ||
          operation === "setDefault" ||
          operation === "removeDefault" ||
          operation === "pause" ||
          operation === "resume" ||
          operation === "delete")
      ) {
        hl7Lines.push(
          `OBX|${obxSequence++}|NM|API_KEY_ID^API Key ID||${apiKeyData.id}|||||F|||${timestamp}`
        );
      }

      if (apiKeyData.old_id && operation === "setDefault") {
        hl7Lines.push(
          `OBX|${obxSequence++}|NM|OLD_API_KEY_ID^Old API Key ID||${
            apiKeyData.old_id
          }|||||F|||${timestamp}`
        );
      }

      if (apiKeyData.name && (operation === "create" || operation === "update")) {
        hl7Lines.push(
          `OBX|${obxSequence++}|TX|API_KEY_NAME^API Key Name||${escapeHL7(
            apiKeyData.name
          )}|||||F|||${timestamp}`
        );
      }

      if (apiKeyData.type && (operation === "create" || operation === "update")) {
        hl7Lines.push(
          `OBX|${obxSequence++}|TX|API_KEY_TYPE^API Key Type||${escapeHL7(
            apiKeyData.type
          )}|||||F|||${timestamp}`
        );
      }

      if (apiKeyData.status && (operation === "create" || operation === "update")) {
        hl7Lines.push(
          `OBX|${obxSequence++}|TX|API_KEY_STATUS^API Key Status||${escapeHL7(
            apiKeyData.status
          )}|||||F|||${timestamp}`
        );
      }

      if (apiKeyData.user_id && (operation === "create" || operation === "update")) {
        hl7Lines.push(
          `OBX|${obxSequence++}|NM|USER_ID^User ID||${apiKeyData.user_id}|||||F|||${timestamp}`
        );
      }

      if (
        apiKeyData.is_default !== undefined &&
        (operation === "create" || operation === "update")
      ) {
        hl7Lines.push(
          `OBX|${obxSequence++}|CWE|IS_DEFAULT^Is Default||${
            apiKeyData.is_default ? "Y^Yes" : "N^No"
          }|||||F|||${timestamp}`
        );
      }

      // Add operation type
      hl7Lines.push(
        `OBX|${obxSequence++}|TX|OPERATION^Operation Type||${escapeHL7(
          operation.toUpperCase()
        )}|||||F|||${timestamp}`
      );

      const hl7Message = hl7Lines.join("\r\n") + "\r\n";

      console.log(`[SERA] HL7 API key request constructed | operation=${operation}, size=${hl7Message.length}`);

      return hl7Message;
    },
    [escapeHL7]
  );

  // Helper function to get HL7 event codes for different operations
  const getEventCodeForOperation = (operation: string): string => {
    switch (operation) {
      case "create":
        return "A04"; // Register
      case "update":
        return "A08"; // Update
      case "setDefault":
      case "removeDefault":
        return "A31"; // Update person information
      case "pause":
      case "resume":
        return "A37"; // Unlink person information
      case "delete":
        return "A23"; // Delete person information
      default:
        return "A08"; // Default to update
    }
  };

  const createFHIRApiKeyRequest = useCallback(
    (
      apiKeyData: ApiKeyRequest,
      operation:
        | "create"
        | "update"
        | "setDefault"
        | "removeDefault"
        | "pause"
        | "resume"
        | "delete" = "create"
    ): string => {
      const timestamp = new Date().toISOString();
      const requestId = `api-key-${operation}-${Date.now()}`;

      // Build FHIR Bundle for API key
      const fhirBundle = {
        resourceType: "Bundle",
        id: requestId,
        timestamp: timestamp,
        type: "transaction",
        entry: [
          // MessageHeader
          {
            fullUrl: `urn:uuid:${requestId}-header`,
            resource: {
              resourceType: "MessageHeader",
              id: `${requestId}-header`,
              timestamp: timestamp,
              eventCoding: {
                system: "http://nuxera.ai/events",
                code: `api-key-${operation}`,
                display: `API Key ${
                  operation.charAt(0).toUpperCase() + operation.slice(1)
                } Request`,
              },
              source: {
                name: "Nuxera Client",
                endpoint: "http://nuxera.ai/client",
              },
              destination: [
                {
                  name: "Nuxera API Key Service",
                  endpoint: "http://nuxera.ai/api-keys",
                },
              ],
              focus: [
                {
                  reference: `urn:uuid:${requestId}-device`,
                },
              ],
            },
          },

          // Patient (User)
          {
            fullUrl: `urn:uuid:${requestId}-patient`,
            resource: {
              resourceType: "Patient",
              id: `${requestId}-patient`,
              identifier: [
                {
                  system: "http://nuxera.ai/user-id",
                  value: apiKeyData.user_id?.toString() || "unknown",
                },
              ],
              name: [
                {
                  family: "User",
                  given: ["API Key Owner"],
                },
              ],
            },
            request: {
              method: "PUT",
              url: `Patient/${requestId}-patient`,
            },
          },

          // Device (API Key)
          {
            fullUrl: `urn:uuid:${requestId}-device`,
            resource: {
              resourceType: "Device",
              id: `${requestId}-device`,
              status: getDeviceStatusForOperation(operation, apiKeyData.status),
              deviceName: [
                {
                  name: apiKeyData.name || "",
                  type: "user-friendly-name",
                },
              ],
              type: {
                coding: [
                  {
                    system: "http://nuxera.ai/device-types",
                    code: "api-key",
                    display: "API Key",
                  },
                ],
              },
              owner: {
                reference: `urn:uuid:${requestId}-patient`,
              },
              extension: [
                {
                  url: "http://nuxera.ai/extensions/api-key",
                  extension: [
                    {
                      url: "keyType",
                      valueString: apiKeyData.type || "",
                    },
                    {
                      url: "isDefault",
                      valueBoolean: apiKeyData.is_default || false,
                    },
                    {
                      url: "operation",
                      valueString: operation.toUpperCase(),
                    },
                  ] as Array<{
                    url: string;
                    valueString?: string;
                    valueBoolean?: boolean;
                    valueInteger?: number;
                  }>,
                },
              ],
            },
            request: {
              method: getHttpMethodForOperation(operation),
              url: getUrlForOperation(operation, apiKeyData.id, requestId),
            },
          },
        ],
      };

      // Add API key ID for operations that require it
      if (
        apiKeyData.id &&
        (operation === "update" ||
          operation === "setDefault" ||
          operation === "removeDefault" ||
          operation === "pause" ||
          operation === "resume" ||
          operation === "delete")
      ) {
        fhirBundle.entry[2].resource.identifier = [
          {
            system: "http://nuxera.ai/api-key-id",
            value: apiKeyData.id.toString(),
          },
        ];
      }

      // Add old API key ID for setDefault operation
      if (apiKeyData.old_id && operation === "setDefault") {
        const deviceExtension = fhirBundle.entry[2].resource.extension?.[0];
        if (deviceExtension?.extension) {
          deviceExtension.extension.push({
            url: "oldApiKeyId",
            valueInteger: apiKeyData.old_id,
          });
        }
      }

      console.log(`[SERA] FHIR API key request constructed | operation=${operation}, entries=${fhirBundle.entry.length}`);

      return JSON.stringify(fhirBundle);
    },
    []
  );

  // Helper functions for FHIR operations
  const getDeviceStatusForOperation = (operation: string, status?: string): string => {
    switch (operation) {
      case "pause":
        return "inactive";
      case "resume":
        return "active";
      case "delete":
        return "entered-in-error";
      default:
        return status || "active";
    }
  };

  const getHttpMethodForOperation = (operation: string): string => {
    switch (operation) {
      case "create":
        return "POST";
      case "update":
      case "setDefault":
      case "removeDefault":
      case "pause":
      case "resume":
        return "PUT";
      case "delete":
        return "DELETE";
      default:
        return "PUT";
    }
  };

  const getUrlForOperation = (
    operation: string,
    apiKeyId?: number | string,
    requestId?: string
  ): string => {
    switch (operation) {
      case "create":
        return "Device";
      case "update":
      case "setDefault":
      case "removeDefault":
      case "pause":
      case "resume":
      case "delete":
        return `Device/${apiKeyId || requestId + "-device"}`;
      default:
        return "Device";
    }
  };

  return {
    convertTranscriptionResponse,
    createHL7TranscriptionRequest,
    createFHIRTranscriptionRequest,
    createHL7DictationRequest,
    createFHIRDictationRequest,
    convertDictationResponse,
    convertHL7DictationToJson,
    convertFHIRDictationToJson,
    isConverting,
    conversionError,
    clearError,
  };
};

export default useHL7FHIRConverter;
