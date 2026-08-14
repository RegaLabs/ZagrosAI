import { describe, expect, it } from "vitest";
import { ModelRouter } from "./routing.js";
import { FakeModelDriver } from "./drivers/fake.js";

describe("Task-Specific Model Routing", () => {
  it("routes task to registered task driver", async () => {
    const defaultDriver = new FakeModelDriver({ driver: "general", model: "gen-1" }, [{ reply: "general response" }]);
    const codeDriver = new FakeModelDriver({ driver: "code", model: "coder-1" }, [{ reply: "code response" }]);

    const router = new ModelRouter(defaultDriver);
    router.registerRule({ task: "code", primary: codeDriver });

    const codeResult = await router.getDriverForTask("code").generate({ messages: [{ role: "user", content: "write code" }] });
    expect(codeResult.text).toBe("code response");

    const generalResult = await router.getDriverForTask("general").generate({ messages: [{ role: "user", content: "hi" }] });
    expect(generalResult.text).toBe("general response");
  });
});
