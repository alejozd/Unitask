import { PLACEHOLDER_TOKEN } from "@/theme";

describe("path alias", () => {
  it("resolves @/ to src/", () => {
    expect(PLACEHOLDER_TOKEN).toBe("unitask");
  });
});
