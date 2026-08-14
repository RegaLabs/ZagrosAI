import { describe, expect, it } from "vitest";
import { adaptRequestForCapabilities, negotiateCapabilities } from "./capability.js";
import { FakeModelDriver } from "./drivers/fake.js";

describe("Capability Negotiation & Adaptation", () => {
  it("evaluates required capabilities against driver capabilities", async () => {
    const driver = new FakeModelDriver({ driver: "fake", model: "fake-1" });
    const result = await negotiateCapabilities(driver, {
      textInput: true,
      imageInput: true,
      audioInput: true, // missing on FakeModelDriver
    });
    expect(result.compatible).toBe(false);
    expect(result.missing).toContain("audioInput");
  });

  it("adapts requests for missing image capabilities", () => {
    const request = {
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "Look at this:" },
            { type: "image" as const, data: "data:image/png;base64,..." },
          ],
        },
      ],
    };

    const adapted = adaptRequestForCapabilities(
      {
        textInput: true,
        imageInput: false,
        audioInput: false,
        videoInput: false,
        toolCalling: true,
        parallelTools: false,
        structuredOutput: false,
        supportsFiles: false,
      },
      request
    );

    expect(typeof adapted.messages[0]!.content).toBe("string");
    expect(adapted.messages[0]!.content as string).toContain("[Image omitted");
  });
});
