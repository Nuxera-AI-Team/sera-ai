import { describe, it, expect } from "vitest";
import {
  parseV2ChunkResponse,
  combineLabeledTranscripts,
  parseClassifiedInfo,
  buildClassification,
} from "./transcribeV2";

describe("parseV2ChunkResponse", () => {
  it("passes through a well-formed response", () => {
    const r = parseV2ChunkResponse({
      labeledTranscript: "Doctor: hi",
      diarizedTranscript: "Speaker 1: hi",
      roles: { "Speaker 1": "Doctor" },
      provider: "elevenlabs",
      model: "scribe",
    });
    expect(r.labeledTranscript).toBe("Doctor: hi");
    expect(r.roles).toEqual({ "Speaker 1": "Doctor" });
    expect(r.provider).toBe("elevenlabs");
  });

  it("defends against missing / malformed fields", () => {
    const r = parseV2ChunkResponse({});
    expect(r.labeledTranscript).toBe("");
    expect(r.diarizedTranscript).toBe("");
    expect(r.roles).toEqual({});
    expect(r.provider).toBeUndefined();
  });

  it("tolerates null / non-object input", () => {
    expect(parseV2ChunkResponse(null).labeledTranscript).toBe("");
    expect(parseV2ChunkResponse(undefined).roles).toEqual({});
  });
});

describe("combineLabeledTranscripts", () => {
  it("joins chunk transcripts in the given order", () => {
    expect(
      combineLabeledTranscripts(["Doctor: one", "Patient: two", "Doctor: three"])
    ).toBe("Doctor: one\nPatient: two\nDoctor: three");
  });

  it("drops blank / whitespace-only / nullish chunks (silence)", () => {
    expect(
      combineLabeledTranscripts(["Doctor: hi", "", "   ", null, undefined, "Patient: bye"])
    ).toBe("Doctor: hi\nPatient: bye");
  });

  it("returns an empty string when nothing was said", () => {
    expect(combineLabeledTranscripts([])).toBe("");
    expect(combineLabeledTranscripts(["", "  ", null])).toBe("");
  });
});

describe("parseClassifiedInfo", () => {
  it("extracts sections from classifiedInfo", () => {
    const raw = {
      classifiedInfo: {
        Subjective: ["c/o headache"],
        Objective: ["BP 120/80"],
        Assessment: ["Tension headache"],
        Plan: ["Rest", "Hydration"],
      },
    };
    expect(parseClassifiedInfo(raw)).toEqual({
      Subjective: ["c/o headache"],
      Objective: ["BP 120/80"],
      Assessment: ["Tension headache"],
      Plan: ["Rest", "Hydration"],
    });
  });

  it("drills through a double-nested classifiedInfo", () => {
    const raw = { classifiedInfo: { classifiedInfo: { Plan: ["Follow up"] } } };
    expect(parseClassifiedInfo(raw)).toEqual({ Plan: ["Follow up"] });
  });

  it("wraps string section values into arrays and drops empties", () => {
    const raw = { classifiedInfo: { Subjective: "just a string", Objective: "", Plan: ["", "x"] } };
    expect(parseClassifiedInfo(raw)).toEqual({ Subjective: ["just a string"], Plan: ["x"] });
  });

  it("returns {} when there is no classifiedInfo", () => {
    expect(parseClassifiedInfo({})).toEqual({});
    expect(parseClassifiedInfo(null)).toEqual({});
    expect(parseClassifiedInfo({ classifiedInfo: "not an object" })).toEqual({});
  });
});

describe("buildClassification", () => {
  it("uses the response speciality/generatedAt when present", () => {
    const c = buildClassification(
      { speciality: "cardiology", generatedAt: "2026-01-01T00:00:00.000Z", classifiedInfo: { Plan: ["x"] } },
      "soap_note"
    );
    expect(c.speciality).toBe("cardiology");
    expect(c.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(c.classifiedInfo).toEqual({ Plan: ["x"] });
  });

  it("falls back to the passed speciality and stamps generatedAt", () => {
    const c = buildClassification({ classifiedInfo: {} }, "soap_note");
    expect(c.speciality).toBe("soap_note");
    expect(typeof c.generatedAt).toBe("string");
    expect(c.generatedAt.length).toBeGreaterThan(0);
  });
});
