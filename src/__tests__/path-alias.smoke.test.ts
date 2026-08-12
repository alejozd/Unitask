import { colors } from "@/theme";

describe("path alias", () => {
  it("resolves @/ to src/", () => {
    expect(colors.primary).toBe("#6366F1");
  });
});
